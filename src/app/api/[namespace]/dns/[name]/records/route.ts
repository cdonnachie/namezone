import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { createRecordSchema, deleteRecordSchema } from "@/lib/api-schemas";
import { getRequestMeta, recordAuditLog } from "@/lib/audit";
import { getSession } from "@/lib/auth/session";
import { checkStepUpForWrite } from "@/lib/auth/step-up";
import { prisma } from "@/lib/db";
import { FIXED_TTL } from "@/lib/dns/constants";
import { checkRecordLimits, type ExistingBasicRecordSummary } from "@/lib/dns/limits";
import {
  authorizeFqdnForName,
  relativeHostToFqdn,
  validateCnameTarget,
  validateFqdnLength,
  validateRecordType,
  validateRecordValue,
  validateRelativeHost,
  validateTypeForHost,
  wouldCreateCnameLoop,
} from "@/lib/dns/validation";
import { getNamespace, type NamespaceConfig } from "@/lib/namespaces";
import { requireClaimedNameOwnership } from "@/lib/ownership/sync";
import { getPowerDnsClient } from "@/lib/powerdns/client";
import { checkRateLimit } from "@/lib/rate-limit";

async function buildCnameResolver(namespace: NamespaceConfig): Promise<(name: string) => string | undefined> {
  const allCnames = await prisma.dnsRecord.findMany({
    where: { namespace: namespace.key, type: "CNAME", status: "ACTIVE" },
    select: { fqdn: true, value: true },
  });
  const byFqdn = new Map(allCnames.map((r) => [r.fqdn, r.value]));
  return (name: string) => byFqdn.get(name);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ namespace: string; name: string }> },
) {
  try {
    const { namespace: key, name: rawName } = await params;
    const ns = getNamespace(key);

    const session = await getSession(ns.key);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const auth = await requireClaimedNameOwnership(ns, decodeURIComponent(rawName), session.address);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Opt-in step-up: addresses with requireSignedWrites need a fresh
    // wallet signature (step-up cookie) on top of the session for writes.
    const stepUp = await checkStepUpForWrite(ns.key, session.address);
    if (!stepUp.ok) {
      return NextResponse.json({ error: stepUp.error }, { status: stepUp.status });
    }

    const rateLimit = await checkRateLimit(`dns-write:${ns.key}:${session.address}`);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${rateLimit.retryAfterSeconds}s.` },
        { status: 429 },
      );
    }

    const body = createRecordSchema.parse(await req.json());

    const hostResult = validateRelativeHost(body.hostname);
    if (!hostResult.ok) {
      return NextResponse.json({ error: hostResult.error }, { status: 400 });
    }

    const typeResult = validateRecordType(body.type);
    if (!typeResult.ok) {
      return NextResponse.json({ error: typeResult.error }, { status: 400 });
    }
    const type = typeResult.value as "A" | "AAAA" | "CNAME";

    const typeForHostResult = validateTypeForHost(hostResult.value, type);
    if (!typeForHostResult.ok) {
      return NextResponse.json({ error: typeForHostResult.error }, { status: 400 });
    }

    const fqdn = relativeHostToFqdn(hostResult.value, auth.name, ns);

    const lengthResult = validateFqdnLength(fqdn);
    if (!lengthResult.ok) {
      return NextResponse.json({ error: lengthResult.error }, { status: 400 });
    }

    const authFqdn = authorizeFqdnForName(fqdn, auth.name, ns);
    if (!authFqdn.ok) {
      return NextResponse.json({ error: authFqdn.error }, { status: 403 });
    }

    const valueResult =
      type === "CNAME"
        ? validateCnameTarget(body.value, fqdn, auth.name, ns)
        : validateRecordValue(type, body.value);
    if (!valueResult.ok) {
      return NextResponse.json({ error: valueResult.error }, { status: 400 });
    }

    if (type === "CNAME") {
      const resolveCname = await buildCnameResolver(ns);
      if (wouldCreateCnameLoop(fqdn, valueResult.value, resolveCname)) {
        return NextResponse.json(
          { error: "This CNAME would create a loop with an existing record." },
          { status: 400 },
        );
      }
    }

    // The `type: { in: [...] }` filter guarantees only A/AAAA/CNAME rows come back;
    // Prisma's types don't narrow on that filter, so assert the already-guaranteed shape.
    const existingForName = (await prisma.dnsRecord.findMany({
      where: { namespace: ns.key, claimedName: auth.name, status: "ACTIVE", type: { in: ["A", "AAAA", "CNAME"] } },
      select: { relativeHost: true, type: true },
    })) as ExistingBasicRecordSummary[];
    const limitResult = checkRecordLimits(existingForName, {
      relativeHost: hostResult.value,
      type,
    });
    if (!limitResult.ok) {
      return NextResponse.json({ error: limitResult.error }, { status: 400 });
    }

    // Look up regardless of status: a DISABLED row at this exact (fqdn, type)
    // - e.g. left over from a prior ownership transfer - gets reactivated in
    // place rather than blocked by the (namespace, fqdn, type, value) unique constraint.
    const existingRecord = await prisma.dnsRecord.findFirst({ where: { namespace: ns.key, fqdn, type } });
    const isFreshFromUserPerspective = !existingRecord || existingRecord.status === "DISABLED";

    const pdns = getPowerDnsClient();
    await pdns.upsertRecord(ns.dnsZone, fqdn, type, valueResult.value, FIXED_TTL);
    await pdns.notify(ns.dnsZone);

    const saved = existingRecord
      ? await prisma.dnsRecord.update({
          where: { id: existingRecord.id },
          data: { value: valueResult.value, ttl: FIXED_TTL, status: "ACTIVE", disabledReason: null },
        })
      : await prisma.dnsRecord.create({
          data: {
            namespace: ns.key,
            claimedName: auth.name,
            fqdn,
            relativeHost: hostResult.value,
            type,
            value: valueResult.value,
            ttl: FIXED_TTL,
          },
        });

    const { ipAddress, userAgent } = getRequestMeta(req);
    await recordAuditLog({
      namespace: ns.key,
      address: session.address,
      claimedName: auth.name,
      action: isFreshFromUserPerspective ? "CREATE" : "UPDATE",
      fqdn,
      type,
      oldValue: !isFreshFromUserPerspective ? (existingRecord?.value ?? null) : null,
      newValue: valueResult.value,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ record: saved }, { status: isFreshFromUserPerspective ? 201 : 200 });
  } catch (err) {
    return handleApiError(err, "Failed to save DNS record.");
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ namespace: string; name: string }> },
) {
  try {
    const { namespace: key, name: rawName } = await params;
    const ns = getNamespace(key);

    const session = await getSession(ns.key);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const auth = await requireClaimedNameOwnership(ns, decodeURIComponent(rawName), session.address);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Opt-in step-up: addresses with requireSignedWrites need a fresh
    // wallet signature (step-up cookie) on top of the session for writes.
    const stepUp = await checkStepUpForWrite(ns.key, session.address);
    if (!stepUp.ok) {
      return NextResponse.json({ error: stepUp.error }, { status: stepUp.status });
    }

    const rateLimit = await checkRateLimit(`dns-write:${ns.key}:${session.address}`);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${rateLimit.retryAfterSeconds}s.` },
        { status: 429 },
      );
    }

    const body = deleteRecordSchema.parse(await req.json());

    const hostResult = validateRelativeHost(body.hostname);
    if (!hostResult.ok) {
      return NextResponse.json({ error: hostResult.error }, { status: 400 });
    }
    const typeResult = validateRecordType(body.type);
    if (!typeResult.ok) {
      return NextResponse.json({ error: typeResult.error }, { status: 400 });
    }
    const type = typeResult.value as "A" | "AAAA" | "CNAME";

    const fqdn = relativeHostToFqdn(hostResult.value, auth.name, ns);

    const authFqdn = authorizeFqdnForName(fqdn, auth.name, ns);
    if (!authFqdn.ok) {
      return NextResponse.json({ error: authFqdn.error }, { status: 403 });
    }

    const existingRecord = await prisma.dnsRecord.findFirst({
      where: { namespace: ns.key, fqdn, type, status: "ACTIVE" },
    });
    if (!existingRecord) {
      return NextResponse.json({ error: "Record not found." }, { status: 404 });
    }

    const pdns = getPowerDnsClient();
    await pdns.deleteRecord(ns.dnsZone, fqdn, type);
    await pdns.notify(ns.dnsZone);

    await prisma.dnsRecord.delete({ where: { id: existingRecord.id } });

    const { ipAddress, userAgent } = getRequestMeta(req);
    await recordAuditLog({
      namespace: ns.key,
      address: session.address,
      claimedName: auth.name,
      action: "DELETE",
      fqdn,
      type,
      oldValue: existingRecord.value,
      newValue: null,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "Failed to delete DNS record.");
  }
}
