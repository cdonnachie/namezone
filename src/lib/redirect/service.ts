import { prisma } from "@/lib/db";
import type { NamespaceConfig } from "@/lib/namespaces/types";
import { getPowerDnsClient } from "@/lib/powerdns/client";
import { REDIRECT_RECORD_TTL, redirectDnsRecords } from "./constants";
import { wouldRedirectLoop } from "./validation";

/** A redirect write was refused because a conflicting record/redirect exists. Maps to 409. */
export class RedirectConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedirectConflictError";
  }
}

/**
 * Writes the managed A/AAAA records that point a redirect host at the redirect
 * service, and mirrors them as DnsRecord rows flagged isManagedRedirect. The
 * flag is what keeps these out of the raw-record table and lets the transfer /
 * reconcile machinery treat them like any other record. Mirrors the
 * PowerDNS-then-DB, non-transactional ordering of the records route.
 */
export async function writeRedirectDnsRecords(
  ns: NamespaceConfig,
  name: string,
  fqdn: string,
  relativeHost: string,
): Promise<void> {
  const pdns = getPowerDnsClient();
  const records = redirectDnsRecords(ns.key);

  // A redirect host must be exclusive. The API conflict-check runs earlier, but
  // re-check right before the whole-rrset REPLACE below to narrow the TOCTOU
  // window: without this, a concurrently-added user A/AAAA at this fqdn would be
  // silently wiped by the REPLACE. Turn that into a refusal, not data loss.
  const conflicting = await prisma.dnsRecord.findFirst({
    where: { namespace: ns.key, fqdn, status: "ACTIVE", isManagedRedirect: false },
  });
  if (conflicting) {
    throw new RedirectConflictError("A DNS record already exists at this hostname.");
  }

  for (const rec of records) {
    await pdns.upsertRawRecordSet(ns.dnsZone, fqdn, rec.type, [rec.value], REDIRECT_RECORD_TTL);
  }
  await pdns.notify(ns.dnsZone);

  for (const rec of records) {
    await prisma.dnsRecord.upsert({
      where: { namespace_fqdn_type_value: { namespace: ns.key, fqdn, type: rec.type, value: rec.value } },
      create: {
        namespace: ns.key,
        claimedName: name,
        fqdn,
        relativeHost,
        type: rec.type,
        value: rec.value,
        ttl: REDIRECT_RECORD_TTL,
        isManagedRedirect: true,
      },
      update: { status: "ACTIVE", disabledReason: null, isManagedRedirect: true, ttl: REDIRECT_RECORD_TTL, relativeHost },
    });
  }
}

/**
 * Removes the managed A/AAAA records for a redirect. Only touches rows still
 * flagged isManagedRedirect, so a record the owner has since taken over
 * manually is never clobbered. Best-effort PowerDNS delete then DB delete.
 */
export async function removeRedirectDnsRecords(ns: NamespaceConfig, fqdn: string): Promise<void> {
  const managed = await prisma.dnsRecord.findMany({
    where: { namespace: ns.key, fqdn, isManagedRedirect: true },
  });
  if (managed.length === 0) return;

  const pdns = getPowerDnsClient();
  const types = new Set(managed.map((r) => r.type));
  for (const type of types) {
    // Preserve any non-managed values coexisting at this (fqdn, type): rewrite
    // the rrset with just those rather than deleting the whole set, so a user's
    // own A/AAAA (if one ever slipped in alongside) isn't collaterally wiped.
    const others = await prisma.dnsRecord.findMany({
      where: { namespace: ns.key, fqdn, type, status: "ACTIVE", isManagedRedirect: false },
    });
    const remaining = others.map((r) => r.value);
    if (remaining.length > 0) {
      await pdns.upsertRawRecordSet(ns.dnsZone, fqdn, type as "A" | "AAAA", remaining, REDIRECT_RECORD_TTL);
    } else {
      await pdns.deleteRecord(ns.dnsZone, fqdn, type);
    }
  }
  await pdns.notify(ns.dnsZone);
  await prisma.dnsRecord.deleteMany({ where: { namespace: ns.key, fqdn, isManagedRedirect: true } });
}

/**
 * Shared redirect-loop guard for the create and enable/update paths: true if
 * pointing `fqdn` at `destinationUrl` would loop back to itself directly or via
 * other enabled managed redirects. The candidate destination is substituted at
 * `fqdn` so chains through the row being written are seen.
 */
export async function redirectWouldLoop(
  nsKey: string,
  fqdn: string,
  destinationUrl: string,
): Promise<boolean> {
  const active = await prisma.urlRedirect.findMany({
    where: { namespace: nsKey, status: "ACTIVE" },
    select: { fqdn: true, destinationUrl: true },
  });
  const destByFqdn = new Map(active.map((r) => [r.fqdn, r.destinationUrl]));
  destByFqdn.set(fqdn, destinationUrl);
  return wouldRedirectLoop(fqdn, destinationUrl, (f) => destByFqdn.get(f));
}

/** True if a non-redirect DNS record is active at this fqdn (a redirect there would conflict). */
export async function hasNonRedirectRecordAt(nsKey: string, fqdn: string): Promise<boolean> {
  const row = await prisma.dnsRecord.findFirst({
    where: { namespace: nsKey, fqdn, status: "ACTIVE", isManagedRedirect: false },
  });
  return Boolean(row);
}

/** True if an active managed redirect exists at this fqdn (a normal record there would conflict). */
export async function hasManagedRedirectAt(nsKey: string, fqdn: string): Promise<boolean> {
  const row = await prisma.urlRedirect.findFirst({
    where: { namespace: nsKey, fqdn, status: "ACTIVE" },
  });
  return Boolean(row);
}
