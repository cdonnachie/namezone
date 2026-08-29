import { prisma } from "@/lib/db";
import type { NamespaceConfig } from "@/lib/namespaces/types";
import { getPowerDnsClient } from "@/lib/powerdns/client";
import { SITE_RECORD_TTL, siteDnsRecords } from "./constants";

/** A site write was refused because something else already owns the hostname. Maps to 409. */
export class SiteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteConflictError";
  }
}

export type SiteTarget =
  | { kind: "SELF_HOSTED" }
  | { kind: "EXTERNAL"; cnameTarget: string };

/** The DNS records a target implies. */
function recordsForTarget(nsKey: string, target: SiteTarget): Array<{ type: "A" | "AAAA" | "CNAME"; value: string }> {
  if (target.kind === "SELF_HOSTED") return siteDnsRecords(nsKey);
  // Stored with the trailing dot PowerDNS expects for a CNAME target.
  const value = target.cnameTarget.endsWith(".") ? target.cnameTarget : `${target.cnameTarget}.`;
  return [{ type: "CNAME", value }];
}

/**
 * Points a hostname at a generated site, writing the managed DNS records and
 * mirroring them as DnsRecord rows flagged isManagedSite.
 *
 * The flag is what keeps these out of the raw record table and lets the
 * transfer / reconcile machinery treat them like any other record. Mirrors the
 * PowerDNS-then-DB, non-transactional ordering used everywhere else.
 */
export async function writeSiteDnsRecords(
  ns: NamespaceConfig,
  name: string,
  fqdn: string,
  relativeHost: string,
  target: SiteTarget,
): Promise<void> {
  const pdns = getPowerDnsClient();
  const records = recordsForTarget(ns.key, target);
  if (records.length === 0) {
    throw new SiteConflictError("Site hosting is not configured on this server.");
  }

  // A site host must be exclusive. The API conflict-check runs earlier, but
  // re-check right before the whole-rrset REPLACE below to narrow the TOCTOU
  // window: without this, a concurrently-added user record at this fqdn would
  // be silently wiped by the REPLACE. Turn that into a refusal, not data loss.
  const conflicting = await prisma.dnsRecord.findFirst({
    where: { namespace: ns.key, fqdn, status: "ACTIVE", isManagedSite: false },
  });
  if (conflicting) {
    throw new SiteConflictError("A DNS record already exists at this hostname.");
  }

  // Switching target kinds leaves the old rrset behind (A/AAAA -> CNAME or
  // back), and a CNAME may not coexist with anything else at a name. Clear
  // whatever this site previously wrote before writing the new shape.
  await removeSiteDnsRecords(ns, fqdn, { keepSiteRow: true });

  for (const rec of records) {
    // CNAME is single-value by definition (RFC: a CNAME node holds exactly one
    // and nothing else), so it takes the single-record writer; A/AAAA go
    // through the rrset writer that replaces the whole set.
    if (rec.type === "CNAME") {
      await pdns.upsertRecord(ns.dnsZone, fqdn, "CNAME", rec.value, SITE_RECORD_TTL);
    } else {
      await pdns.upsertRawRecordSet(ns.dnsZone, fqdn, rec.type, [rec.value], SITE_RECORD_TTL);
    }
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
        ttl: SITE_RECORD_TTL,
        isManagedSite: true,
      },
      update: { status: "ACTIVE", disabledReason: null, isManagedSite: true, ttl: SITE_RECORD_TTL, relativeHost },
    });
  }
}

/**
 * Removes the managed records for a site. Only touches rows still flagged
 * isManagedSite, so a record the owner has since taken over manually is never
 * clobbered. Best-effort PowerDNS delete, then the DB.
 */
export async function removeSiteDnsRecords(
  ns: NamespaceConfig,
  fqdn: string,
  options?: { keepSiteRow?: boolean },
): Promise<void> {
  const managed = await prisma.dnsRecord.findMany({
    where: { namespace: ns.key, fqdn, isManagedSite: true },
  });

  if (managed.length > 0) {
    const pdns = getPowerDnsClient();
    const types = new Set(managed.map((r) => r.type));
    for (const type of types) {
      // Preserve any non-managed values coexisting at this (fqdn, type):
      // rewrite the rrset with just those rather than deleting the whole set,
      // so a user's own record isn't collaterally wiped.
      const others = await prisma.dnsRecord.findMany({
        where: { namespace: ns.key, fqdn, type, status: "ACTIVE", isManagedSite: false },
      });
      const remaining = others.map((r) => r.value);
      if (remaining.length === 0) {
        await pdns.deleteRecord(ns.dnsZone, fqdn, type);
      } else if (type === "CNAME") {
        // Single-value: there can only ever be one survivor to restore.
        await pdns.upsertRecord(ns.dnsZone, fqdn, "CNAME", remaining[0], SITE_RECORD_TTL);
      } else {
        await pdns.upsertRawRecordSet(ns.dnsZone, fqdn, type as "A" | "AAAA" | "MX", remaining, SITE_RECORD_TTL);
      }
    }
    await pdns.notify(ns.dnsZone);
    await prisma.dnsRecord.deleteMany({ where: { id: { in: managed.map((r) => r.id) } } });
  }

  if (!options?.keepSiteRow) {
    await prisma.managedSite.deleteMany({ where: { namespace: ns.key, fqdn } });
  }
}

/** True if a non-site DNS record is active at this fqdn (a site there would conflict). */
export async function hasNonSiteRecordAt(nsKey: string, fqdn: string): Promise<boolean> {
  const row = await prisma.dnsRecord.findFirst({
    where: { namespace: nsKey, fqdn, status: "ACTIVE", isManagedSite: false },
  });
  return Boolean(row);
}

/** True if an active managed site exists at this fqdn (a normal record there would conflict). */
export async function hasManagedSiteAt(nsKey: string, fqdn: string): Promise<boolean> {
  const row = await prisma.managedSite.findFirst({
    where: { namespace: nsKey, fqdn, status: "ACTIVE" },
  });
  return Boolean(row);
}
