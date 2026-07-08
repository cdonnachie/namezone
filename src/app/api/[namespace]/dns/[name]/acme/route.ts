import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { createAcmeChallengeSchema, deleteAcmeChallengeSchema } from "@/lib/api-schemas";
import { getRequestMeta, recordAuditLog } from "@/lib/audit";
import { getSession } from "@/lib/auth/session";
import { checkStepUpForWrite } from "@/lib/auth/step-up";
import { prisma } from "@/lib/db";
import { ACME_TXT_DEFAULT_EXPIRY_HOURS, ACME_TXT_MAX_EXPIRY_HOURS, ACME_TXT_TTL } from "@/lib/dns/constants";
import { checkAcmeTxtLimit } from "@/lib/dns/limits";
import {
  acmeChallengeHostFor,
  authorizeFqdnForName,
  isAcmeChallengeHost,
  relativeHostToFqdn,
  validateAcmeTxtValue,
  validateRelativeHost,
} from "@/lib/dns/validation";
import { getNamespace } from "@/lib/namespaces";
import { requireClaimedNameOwnership } from "@/lib/ownership/sync";
import { getPowerDnsClient } from "@/lib/powerdns/client";
import { checkRateLimit } from "@/lib/rate-limit";

function clampExpiryHours(raw: number | undefined): number {
  if (!raw) return ACME_TXT_DEFAULT_EXPIRY_HOURS;
  return Math.min(Math.max(raw, 1), ACME_TXT_MAX_EXPIRY_HOURS);
}

/**
 * Adds a single ACME DNS-01 challenge TXT value under
 * "_acme-challenge.<hostname>". `hostname` is the target service host (e.g.
 * "@" or "www"), not the "_acme-challenge" name itself - multiple values can
 * coexist at the same challenge name, and each auto-expires independently.
 */
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

    const body = createAcmeChallengeSchema.parse(await req.json());

    const hostResult = validateRelativeHost(body.hostname);
    if (!hostResult.ok) {
      return NextResponse.json({ error: hostResult.error }, { status: 400 });
    }
    if (isAcmeChallengeHost(hostResult.value)) {
      return NextResponse.json(
        { error: 'Provide the target hostname (e.g. "www"), not the _acme-challenge name itself.' },
        { status: 400 },
      );
    }

    const acmeHost = acmeChallengeHostFor(hostResult.value);
    const fqdn = relativeHostToFqdn(acmeHost, auth.name, ns);

    const authFqdn = authorizeFqdnForName(fqdn, auth.name, ns);
    if (!authFqdn.ok) {
      return NextResponse.json({ error: authFqdn.error }, { status: 403 });
    }

    const valueResult = validateAcmeTxtValue(body.value);
    if (!valueResult.ok) {
      return NextResponse.json({ error: valueResult.error }, { status: 400 });
    }

    const activeCount = await prisma.dnsRecord.count({
      where: {
        namespace: ns.key,
        claimedName: auth.name,
        type: "TXT",
        isAcmeChallenge: true,
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
      },
    });
    const limitResult = checkAcmeTxtLimit(activeCount);
    if (!limitResult.ok) {
      return NextResponse.json({ error: limitResult.error }, { status: 400 });
    }

    const existingSameValue = await prisma.dnsRecord.findFirst({
      where: { namespace: ns.key, fqdn, type: "TXT", value: valueResult.value, status: "ACTIVE" },
    });
    if (existingSameValue) {
      return NextResponse.json({ error: "This exact TXT value already exists for this challenge." }, { status: 409 });
    }

    // A DISABLED row at this exact (namespace, fqdn, type, value) - e.g. from
    // a prior ownership transfer - gets reactivated rather than blocked by
    // the unique constraint when we try to insert the "same" value fresh.
    const disabledSameValue = await prisma.dnsRecord.findFirst({
      where: { namespace: ns.key, fqdn, type: "TXT", value: valueResult.value, status: "DISABLED" },
    });

    const existingValues = await prisma.dnsRecord.findMany({
      where: { namespace: ns.key, fqdn, type: "TXT", status: "ACTIVE" },
      select: { value: true },
    });

    const pdns = getPowerDnsClient();
    await pdns.upsertTxtRecords(
      ns.dnsZone,
      fqdn,
      [...existingValues.map((v) => v.value), valueResult.value],
      ACME_TXT_TTL,
    );
    await pdns.notify(ns.dnsZone);

    const expiresAt = new Date(Date.now() + clampExpiryHours(body.expiryHours) * 60 * 60 * 1000);
    const saved = disabledSameValue
      ? await prisma.dnsRecord.update({
          where: { id: disabledSameValue.id },
          data: { ttl: ACME_TXT_TTL, status: "ACTIVE", disabledReason: null, expiresAt },
        })
      : await prisma.dnsRecord.create({
          data: {
            namespace: ns.key,
            claimedName: auth.name,
            fqdn,
            relativeHost: acmeHost,
            type: "TXT",
            value: valueResult.value,
            ttl: ACME_TXT_TTL,
            isAcmeChallenge: true,
            expiresAt,
          },
        });

    const { ipAddress, userAgent } = getRequestMeta(req);
    await recordAuditLog({
      namespace: ns.key,
      address: session.address,
      claimedName: auth.name,
      action: "CREATE",
      fqdn,
      type: "TXT",
      oldValue: null,
      newValue: valueResult.value,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ record: saved }, { status: 201 });
  } catch (err) {
    return handleApiError(err, "Failed to create ACME challenge record.");
  }
}

/** Removes a single ACME challenge TXT value, re-publishing any remaining values at that name. */
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

    const body = deleteAcmeChallengeSchema.parse(await req.json());

    const hostResult = validateRelativeHost(body.hostname);
    if (!hostResult.ok) {
      return NextResponse.json({ error: hostResult.error }, { status: 400 });
    }
    if (isAcmeChallengeHost(hostResult.value)) {
      return NextResponse.json(
        { error: 'Provide the target hostname (e.g. "www"), not the _acme-challenge name itself.' },
        { status: 400 },
      );
    }

    const acmeHost = acmeChallengeHostFor(hostResult.value);
    const fqdn = relativeHostToFqdn(acmeHost, auth.name, ns);

    const authFqdn = authorizeFqdnForName(fqdn, auth.name, ns);
    if (!authFqdn.ok) {
      return NextResponse.json({ error: authFqdn.error }, { status: 403 });
    }

    const existing = await prisma.dnsRecord.findFirst({
      where: { namespace: ns.key, fqdn, type: "TXT", value: body.value, status: "ACTIVE" },
    });
    if (!existing) {
      return NextResponse.json({ error: "Record not found." }, { status: 404 });
    }

    const remaining = await prisma.dnsRecord.findMany({
      where: { namespace: ns.key, fqdn, type: "TXT", status: "ACTIVE", NOT: { id: existing.id } },
      select: { value: true },
    });

    const pdns = getPowerDnsClient();
    await pdns.upsertTxtRecords(ns.dnsZone, fqdn, remaining.map((r) => r.value), ACME_TXT_TTL);
    await pdns.notify(ns.dnsZone);

    await prisma.dnsRecord.delete({ where: { id: existing.id } });

    const { ipAddress, userAgent } = getRequestMeta(req);
    await recordAuditLog({
      namespace: ns.key,
      address: session.address,
      claimedName: auth.name,
      action: "DELETE",
      fqdn,
      type: "TXT",
      oldValue: existing.value,
      newValue: null,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "Failed to delete ACME challenge record.");
  }
}
