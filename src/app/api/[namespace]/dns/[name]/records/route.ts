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
  isAcmeChallengeHost,
  relativeHostToFqdn,
  validateCnameTarget,
  validateFqdnLength,
  validateRecordType,
  validateRecordValue,
  validateRelativeHost,
  validateTypeForHost,
  wouldCreateCnameLoop,
} from "@/lib/dns/validation";
import {
  isDkimHost,
  isDmarcHost,
  isEmailEnabledName,
  validateEmailTxtValue,
  validateMxValue,
} from "@/lib/dns/email";
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

    const typeResult = validateRecordType(body.type);
    if (!typeResult.ok) {
      return NextResponse.json({ error: typeResult.error }, { status: 400 });
    }
    const type = typeResult.value;

    // MX and email-shaped TXT (SPF/DKIM/DMARC) are allowlist-gated per name.
    const emailEnabled = isEmailEnabledName(auth.name);
    const isEmailType = type === "MX" || type === "TXT";
    if (isEmailType && !emailEnabled) {
      return NextResponse.json(
        { error: "Email records (MX, SPF, DKIM, DMARC) are not enabled for this name." },
        { status: 403 },
      );
    }

    // Email needs its two underscore host shapes (_dmarc, *._domainkey);
    // permit them only for allowlisted names.
    const hostResult = validateRelativeHost(body.hostname, { allowEmailLabels: emailEnabled });
    if (!hostResult.ok) {
      return NextResponse.json({ error: hostResult.error }, { status: 400 });
    }
    const host = hostResult.value;

    const fqdn = relativeHostToFqdn(host, auth.name, ns, { allowEmailLabels: emailEnabled });

    const lengthResult = validateFqdnLength(fqdn);
    if (!lengthResult.ok) {
      return NextResponse.json({ error: lengthResult.error }, { status: 400 });
    }

    const authFqdn = authorizeFqdnForName(fqdn, auth.name, ns);
    if (!authFqdn.ok) {
      return NextResponse.json({ error: authFqdn.error }, { status: 403 });
    }

    // Validate the value per type and produce the exact string stored in both
    // the DB mirror and PowerDNS (for MX that's the "<priority> <target>." rdata).
    let storedValue: string;
    if (type === "MX") {
      if (isAcmeChallengeHost(host) || isDmarcHost(host) || isDkimHost(host)) {
        return NextResponse.json({ error: "MX records cannot be set at that hostname." }, { status: 400 });
      }
      const mx = validateMxValue(body.value, auth.name, ns);
      if (!mx.ok) return NextResponse.json({ error: mx.error }, { status: 400 });
      storedValue = mx.value.content;
    } else if (type === "TXT") {
      if (isAcmeChallengeHost(host)) {
        return NextResponse.json(
          { error: 'Use "Add SSL Challenge" for _acme-challenge TXT records.' },
          { status: 400 },
        );
      }
      const txt = validateEmailTxtValue(host, body.value);
      if (!txt.ok) return NextResponse.json({ error: txt.error }, { status: 400 });
      storedValue = txt.value;
    } else {
      // A / AAAA / CNAME: the original path, incl. TXT-only-under-ACME guard.
      const typeForHostResult = validateTypeForHost(host, type);
      if (!typeForHostResult.ok) {
        return NextResponse.json({ error: typeForHostResult.error }, { status: 400 });
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
      storedValue = valueResult.value;
    }

    // Limits/exclusivity run over all non-ACME records (A/AAAA/CNAME/MX and
    // email TXT); ACME TXT lives under its own hosts and its own limit.
    const existingForName = (await prisma.dnsRecord.findMany({
      where: { namespace: ns.key, claimedName: auth.name, status: "ACTIVE", isAcmeChallenge: false },
      select: { relativeHost: true, type: true },
    })) as ExistingBasicRecordSummary[];
    const limitResult = checkRecordLimits(existingForName, {
      relativeHost: host,
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
    if (type === "TXT") {
      // Single email TXT value; upsertTxtRecords handles the quoted/chunked
      // rdata format (DKIM keys can exceed one 255-byte string).
      await pdns.upsertTxtRecords(ns.dnsZone, fqdn, [storedValue], FIXED_TTL);
    } else {
      await pdns.upsertRecord(ns.dnsZone, fqdn, type, storedValue, FIXED_TTL);
    }
    await pdns.notify(ns.dnsZone);

    const saved = existingRecord
      ? await prisma.dnsRecord.update({
          where: { id: existingRecord.id },
          data: { value: storedValue, ttl: FIXED_TTL, status: "ACTIVE", disabledReason: null },
        })
      : await prisma.dnsRecord.create({
          data: {
            namespace: ns.key,
            claimedName: auth.name,
            fqdn,
            relativeHost: host,
            type,
            value: storedValue,
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
      newValue: storedValue,
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

    const typeResult = validateRecordType(body.type);
    if (!typeResult.ok) {
      return NextResponse.json({ error: typeResult.error }, { status: 400 });
    }
    const type = typeResult.value;

    // Allow email hosts (_dmarc/_domainkey) so email records stay deletable
    // even if the name is later removed from the allowlist.
    const hostResult = validateRelativeHost(body.hostname, { allowEmailLabels: true });
    if (!hostResult.ok) {
      return NextResponse.json({ error: hostResult.error }, { status: 400 });
    }

    const fqdn = relativeHostToFqdn(hostResult.value, auth.name, ns, { allowEmailLabels: true });

    const authFqdn = authorizeFqdnForName(fqdn, auth.name, ns);
    if (!authFqdn.ok) {
      return NextResponse.json({ error: authFqdn.error }, { status: 403 });
    }

    // Never delete ACME TXT here - that's the ACME route's job (and this
    // route's TXT is always a single-value email record).
    const existingRecord = await prisma.dnsRecord.findFirst({
      where: { namespace: ns.key, fqdn, type, status: "ACTIVE", isAcmeChallenge: false },
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
