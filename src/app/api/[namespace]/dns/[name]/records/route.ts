import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { createRecordSchema, deleteRecordSchema } from "@/lib/api-schemas";
import { getRequestMeta, recordAuditLog } from "@/lib/audit";
import { getSession } from "@/lib/auth/session";
import { checkStepUpForWrite } from "@/lib/auth/step-up";
import { prisma } from "@/lib/db";
import { FIXED_TTL, MAX_EMAIL_TXT_PER_HOSTNAME, MAX_MX_PER_HOSTNAME } from "@/lib/dns/constants";
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

    const pdns = getPowerDnsClient();
    const { ipAddress, userAgent } = getRequestMeta(req);

    // MX and email TXT are MULTI-VALUE per hostname: several MX hosts, or SPF
    // alongside multiple provider verification tokens, coexist at one name.
    // Adding one must preserve the others, so we rewrite the whole rrset with
    // the union of existing active values plus this one.
    if (type === "MX" || type === "TXT") {
      const activeAtRrset = await prisma.dnsRecord.findMany({
        where: { namespace: ns.key, fqdn, type, status: "ACTIVE", isAcmeChallenge: false },
      });
      const existingRow = await prisma.dnsRecord.findFirst({
        where: { namespace: ns.key, fqdn, type, value: storedValue },
      });
      const alreadyActive = activeAtRrset.some((r) => r.value === storedValue);

      // Only one SPF record per host is valid (RFC 7208); a second silently
      // breaks SPF, so reject rather than let it through.
      if (type === "TXT" && /^v=spf1/i.test(storedValue) && activeAtRrset.some((r) => /^v=spf1/i.test(r.value) && r.value !== storedValue)) {
        return NextResponse.json(
          { error: "This hostname already has an SPF record; remove it before adding another." },
          { status: 400 },
        );
      }

      if (!alreadyActive) {
        const max = type === "MX" ? MAX_MX_PER_HOSTNAME : MAX_EMAIL_TXT_PER_HOSTNAME;
        if (activeAtRrset.length >= max) {
          return NextResponse.json(
            { error: `Maximum of ${max} ${type} records per hostname reached.` },
            { status: 400 },
          );
        }
      }

      const valueSet = Array.from(new Set([...activeAtRrset.map((r) => r.value), storedValue]));
      if (type === "TXT") {
        await pdns.upsertTxtRecords(ns.dnsZone, fqdn, valueSet, FIXED_TTL);
      } else {
        await pdns.upsertMxRecords(ns.dnsZone, fqdn, valueSet, FIXED_TTL);
      }
      await pdns.notify(ns.dnsZone);

      const isFresh = !existingRow || existingRow.status === "DISABLED";
      const saved = existingRow
        ? await prisma.dnsRecord.update({
            where: { id: existingRow.id },
            data: { ttl: FIXED_TTL, relativeHost: host, status: "ACTIVE", disabledReason: null },
          })
        : await prisma.dnsRecord.create({
            data: { namespace: ns.key, claimedName: auth.name, fqdn, relativeHost: host, type, value: storedValue, ttl: FIXED_TTL },
          });

      await recordAuditLog({
        namespace: ns.key,
        address: session.address,
        claimedName: auth.name,
        action: isFresh ? "CREATE" : "UPDATE",
        fqdn,
        type,
        oldValue: null,
        newValue: storedValue,
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ record: saved }, { status: isFresh ? 201 : 200 });
    }

    // Single-value A/AAAA/CNAME. Look up regardless of status: a DISABLED row
    // at this exact (fqdn, type) - e.g. left over from a prior ownership
    // transfer - gets reactivated in place rather than blocked by the
    // (namespace, fqdn, type, value) unique constraint.
    const existingRecord = await prisma.dnsRecord.findFirst({ where: { namespace: ns.key, fqdn, type } });
    const isFreshFromUserPerspective = !existingRecord || existingRecord.status === "DISABLED";

    await pdns.upsertRecord(ns.dnsZone, fqdn, type, storedValue, FIXED_TTL);
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

    const pdns = getPowerDnsClient();
    const { ipAddress, userAgent } = getRequestMeta(req);

    // Multi-value MX / email TXT: a `value` picks which one to remove; the
    // rest of the rrset must survive, so rewrite it with the remaining
    // values (never delete ACME TXT here - that's the ACME route's job).
    if (type === "MX" || type === "TXT") {
      if (!body.value) {
        return NextResponse.json({ error: "A value is required to delete an MX or TXT record." }, { status: 400 });
      }
      const target = await prisma.dnsRecord.findFirst({
        where: { namespace: ns.key, fqdn, type, value: body.value, status: "ACTIVE", isAcmeChallenge: false },
      });
      if (!target) {
        return NextResponse.json({ error: "Record not found." }, { status: 404 });
      }
      const remaining = await prisma.dnsRecord.findMany({
        where: { namespace: ns.key, fqdn, type, status: "ACTIVE", isAcmeChallenge: false, id: { not: target.id } },
      });
      const remainingValues = remaining.map((r) => r.value);
      if (type === "TXT") {
        await pdns.upsertTxtRecords(ns.dnsZone, fqdn, remainingValues, FIXED_TTL);
      } else {
        await pdns.upsertMxRecords(ns.dnsZone, fqdn, remainingValues, FIXED_TTL);
      }
      await pdns.notify(ns.dnsZone);
      await prisma.dnsRecord.delete({ where: { id: target.id } });

      await recordAuditLog({
        namespace: ns.key,
        address: session.address,
        claimedName: auth.name,
        action: "DELETE",
        fqdn,
        type,
        oldValue: target.value,
        newValue: null,
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ ok: true });
    }

    // Single-value A/AAAA/CNAME.
    const existingRecord = await prisma.dnsRecord.findFirst({
      where: { namespace: ns.key, fqdn, type, status: "ACTIVE", isAcmeChallenge: false },
    });
    if (!existingRecord) {
      return NextResponse.json({ error: "Record not found." }, { status: 404 });
    }

    await pdns.deleteRecord(ns.dnsZone, fqdn, type);
    await pdns.notify(ns.dnsZone);

    await prisma.dnsRecord.delete({ where: { id: existingRecord.id } });

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
