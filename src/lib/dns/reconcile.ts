import { recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { NamespaceConfig } from "@/lib/namespaces/types";
import { getPowerDnsClient, type PowerDnsRecordSummary } from "@/lib/powerdns/client";
import { ACME_TXT_DEFAULT_EXPIRY_HOURS, ACME_TXT_TTL } from "./constants";
import { fqdnToRelativeHost, isAcmeChallengeHost, sourceNameToBaseFqdn } from "./validation";

/**
 * Disables every ACTIVE DNS record (A/AAAA/CNAME/ACME TXT) for a claimed
 * name: removed from PowerDNS (so it stops resolving immediately), but the
 * local rows are kept with status=DISABLED rather than deleted, for
 * audit/history.
 *
 * Used when ownership transfers to a new address, so the previous owner's
 * configuration (CNAMEs pointing at their hosting, live ACME challenges,
 * etc.) never silently carries over to the new owner. The new owner starts
 * from a clean slate and must explicitly recreate whatever they need.
 * Audit entries are attributed to the previous owner.
 */
export async function disableClaimedNameRecords(
  namespace: NamespaceConfig,
  name: string,
  previousOwnerAddress: string,
): Promise<void> {
  // Disable managed URL redirects in lockstep with their A/AAAA rows. Done LAST
  // (after the DNS records are removed from PowerDNS below) so the effective
  // kill - the host no longer resolving - happens first; if the process dies
  // mid-way the worst case is a redirect briefly marked active with no DNS,
  // which the next ownership sync / reconcile heals. Runs even when there are no
  // DnsRecords, in case a redirect's records were manually removed.
  const disableRedirects = () =>
    prisma.urlRedirect.updateMany({
      where: { namespace: namespace.key, claimedName: name, status: "ACTIVE" },
      data: { status: "DISABLED", disabledReason: "OWNERSHIP_CHANGED" },
    });

  const records = await prisma.dnsRecord.findMany({
    where: { namespace: namespace.key, claimedName: name, status: "ACTIVE" },
  });
  if (records.length === 0) {
    await disableRedirects();
    return;
  }

  const pdns = getPowerDnsClient();
  const seenRrsets = new Set<string>();
  for (const record of records) {
    const key = `${record.fqdn}|${record.type}`;
    if (seenRrsets.has(key)) continue;
    seenRrsets.add(key);
    try {
      await pdns.deleteRecord(namespace.dnsZone, record.fqdn, record.type);
    } catch (err) {
      console.error(
        "[ownership-transfer] failed to remove PowerDNS record while disabling",
        record.fqdn,
        record.type,
        err,
      );
    }
  }
  await pdns.notify(namespace.dnsZone);

  for (const record of records) {
    await recordAuditLog({
      namespace: namespace.key,
      address: previousOwnerAddress,
      claimedName: name,
      action: "DISABLE",
      fqdn: record.fqdn,
      type: record.type,
      oldValue: record.value,
      newValue: null,
      ipAddress: null,
      userAgent: null,
    });
  }

  await prisma.dnsRecord.updateMany({
    where: { id: { in: records.map((r) => r.id) } },
    data: { status: "DISABLED", disabledReason: "OWNERSHIP_CHANGED" },
  });

  await disableRedirects();
}

/**
 * Reconciles the local DnsRecord mirror for the given source names (within
 * `namespace`) against PowerDNS, which is treated as the source of truth
 * for record existence/values. Without this, a record created outside the
 * app's own API (manually added directly in PowerDNS, pre-seeded zone data,
 * or a wiped local database) would be invisible in the UI even though it's
 * live in PowerDNS.
 *
 * Only ever compares against locally ACTIVE rows - DISABLED rows (kept for
 * ownership-transfer audit history) are left alone; if PowerDNS somehow
 * still has a record matching a DISABLED row's (fqdn, type, value), it gets
 * reactivated (a real record is live, so our state should say so).
 *
 * Fetches the whole zone once and filters per name, so listing many owned
 * names costs one PowerDNS round trip, not one per name.
 *
 * No-ops the PowerDNS sync when the client is in dry-run mode (no real
 * server configured) - "live" would always be empty there, which would
 * otherwise wipe out locally-created test records. Also no-ops (logging a
 * warning) if the live fetch itself fails, so a transient PowerDNS outage
 * degrades to "serve the local mirror as-is" rather than breaking the read.
 *
 * Always runs ACME TXT expiry cleanup first, regardless of dry-run, since
 * that's purely local bookkeeping (plus a best-effort PowerDNS update).
 */
export async function reconcileClaimedNameRecordsWithPowerDns(
  namespace: NamespaceConfig,
  names: string[],
): Promise<void> {
  if (names.length === 0) return;

  await expireStaleAcmeRecords(namespace, names);

  const pdns = getPowerDnsClient();
  if (pdns.dryRun) return;

  let allLive: PowerDnsRecordSummary[];
  try {
    allLive = await pdns.listAllRecords(namespace.dnsZone);
  } catch (err) {
    console.error("[dns-reconcile] failed to list live PowerDNS records; serving local mirror as-is", err);
    return;
  }

  for (const name of names) {
    const base = sourceNameToBaseFqdn(name, namespace);
    const liveForName = allLive.filter((r) => r.name === base || r.name.endsWith(`.${base}`));
    await reconcileOne(namespace, name, liveForName);
  }
}

/** Deletes expired ACME TXT records locally, and best-effort trims them from PowerDNS. */
async function expireStaleAcmeRecords(namespace: NamespaceConfig, names: string[]): Promise<void> {
  const now = new Date();
  const stale = await prisma.dnsRecord.findMany({
    where: {
      namespace: namespace.key,
      claimedName: { in: names },
      isAcmeChallenge: true,
      status: "ACTIVE",
      expiresAt: { lt: now },
    },
  });
  if (stale.length === 0) return;

  const pdns = getPowerDnsClient();
  const byFqdn = new Map<string, typeof stale>();
  for (const record of stale) {
    const list = byFqdn.get(record.fqdn) ?? [];
    list.push(record);
    byFqdn.set(record.fqdn, list);
  }

  for (const [fqdn, expiredHere] of byFqdn) {
    if (!pdns.dryRun) {
      const remaining = await prisma.dnsRecord.findMany({
        where: {
          namespace: namespace.key,
          fqdn,
          type: "TXT",
          isAcmeChallenge: true,
          status: "ACTIVE",
          expiresAt: { gte: now },
        },
      });
      try {
        await pdns.upsertTxtRecords(namespace.dnsZone, fqdn, remaining.map((r) => r.value), ACME_TXT_TTL);
        await pdns.notify(namespace.dnsZone);
      } catch (err) {
        console.error("[dns-reconcile] failed to remove expired ACME TXT from PowerDNS", fqdn, err);
        continue; // keep the local rows so we retry next time rather than losing track
      }
    }
    await prisma.dnsRecord.deleteMany({ where: { id: { in: expiredHere.map((r) => r.id) } } });
  }
}

async function reconcileOne(namespace: NamespaceConfig, name: string, liveRecords: PowerDnsRecordSummary[]): Promise<void> {
  const pdns = getPowerDnsClient();
  const localRecords = await prisma.dnsRecord.findMany({
    where: { namespace: namespace.key, claimedName: name, status: "ACTIVE" },
  });

  // Managed-redirect A/AAAA are owned by the UrlRedirect table, not by whatever
  // is live in PowerDNS. Reconcile must (a) stamp isManagedRedirect so the flag
  // survives a DB wipe / pre-seed / partial write (otherwise the record looks
  // like a normal A and blocks redirect re-creation / can't be cleaned up), and
  // (b) never resurrect a record whose redirect is DISABLED.
  const managedRedirects = await prisma.urlRedirect.findMany({
    where: { namespace: namespace.key, claimedName: name },
    select: { fqdn: true, status: true },
  });
  const managedRedirectStatus = new Map(managedRedirects.map((r) => [r.fqdn, r.status]));

  // Everything except CNAME is multi-value (many values per fqdn+type):
  // A/AAAA (multiple IPs), MX, TXT. CNAME is the only single-value type (RFC:
  // a CNAME node holds exactly one, and nothing else).
  const isMultiValueType = (t: string) => t !== "CNAME";
  const liveSingle = liveRecords.filter((r) => !isMultiValueType(r.type));
  const liveMulti = liveRecords.filter((r) => isMultiValueType(r.type));

  // Single-value types (A/AAAA/CNAME): exactly one active value per (fqdn, type) by policy.
  const singleKeys = new Set(liveSingle.map((r) => `${r.name}|${r.type}`));
  for (const live of liveSingle) {
    const staleLocal = localRecords.filter(
      (r) => r.fqdn === live.name && r.type === live.type && r.value !== live.content,
    );
    for (const stale of staleLocal) {
      await prisma.dnsRecord.delete({ where: { id: stale.id } }).catch(() => {});
    }

    const relativeHost = fqdnToRelativeHost(live.name, name, namespace);
    await prisma.dnsRecord.upsert({
      where: {
        namespace_fqdn_type_value: { namespace: namespace.key, fqdn: live.name, type: live.type, value: live.content },
      },
      create: {
        namespace: namespace.key,
        claimedName: name,
        fqdn: live.name,
        relativeHost,
        type: live.type,
        value: live.content,
        ttl: live.ttl,
      },
      // A matching row might be a previously-DISABLED one (e.g. the exact
      // same value existed before an ownership transfer and PowerDNS
      // somehow still had it) - a live PowerDNS record means it should read
      // as active regardless of that prior state.
      update: { ttl: live.ttl, relativeHost, status: "ACTIVE", disabledReason: null },
    });
  }
  for (const local of localRecords) {
    if (isMultiValueType(local.type)) continue;
    if (!singleKeys.has(`${local.fqdn}|${local.type}`)) {
      await prisma.dnsRecord.delete({ where: { id: local.id } }).catch(() => {});
    }
  }

  // Multi-value types (TXT, MX): many values may coexist per (fqdn, type).
  // For TXT, classify by host: only _acme-challenge.* TXT is an auto-expiring
  // ACME challenge - email TXT (SPF/DKIM/DMARC) and MX are permanent, so they
  // must NOT be stamped isAcmeChallenge/expiresAt or they'd be swept after 24h.
  const liveMultiKeys = new Set(liveMulti.map((r) => `${r.name}|${r.type}|${r.content}`));
  for (const live of liveMulti) {
    const relativeHost = fqdnToRelativeHost(live.name, name, namespace);
    const isAcme = live.type === "TXT" && isAcmeChallengeHost(relativeHost);

    // A/AAAA at a fqdn with a UrlRedirect row belong to the redirect subsystem.
    const redirectStatus =
      live.type === "A" || live.type === "AAAA" ? managedRedirectStatus.get(live.name) : undefined;
    const isManagedRedirect = redirectStatus !== undefined;

    if (isManagedRedirect && redirectStatus !== "ACTIVE") {
      // Redirect is disabled/removed but its record is still live in PowerDNS
      // (e.g. a transfer's best-effort delete failed). Re-remove it and mark any
      // local row DISABLED - never adopt it as ACTIVE.
      try {
        await pdns.deleteRecord(namespace.dnsZone, live.name, live.type);
        await pdns.notify(namespace.dnsZone);
      } catch (err) {
        console.error("[dns-reconcile] failed to remove stale managed-redirect record", live.name, live.type, err);
      }
      await prisma.dnsRecord.updateMany({
        where: { namespace: namespace.key, fqdn: live.name, type: live.type, status: "ACTIVE" },
        data: { status: "DISABLED", disabledReason: null, isManagedRedirect: true },
      });
      continue;
    }

    await prisma.dnsRecord.upsert({
      where: {
        namespace_fqdn_type_value: { namespace: namespace.key, fqdn: live.name, type: live.type, value: live.content },
      },
      create: {
        namespace: namespace.key,
        claimedName: name,
        fqdn: live.name,
        relativeHost,
        type: live.type,
        value: live.content,
        ttl: live.ttl,
        isAcmeChallenge: isAcme,
        isManagedRedirect,
        // ACME challenges discovered outside the app have no known intended
        // lifetime - give them the standard default. Email TXT/MX are permanent.
        expiresAt: isAcme
          ? new Date(Date.now() + ACME_TXT_DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000)
          : null,
      },
      update: { status: "ACTIVE", disabledReason: null, isManagedRedirect },
    });
  }
  for (const local of localRecords) {
    if (!isMultiValueType(local.type)) continue;
    if (!liveMultiKeys.has(`${local.fqdn}|${local.type}|${local.value}`)) {
      await prisma.dnsRecord.delete({ where: { id: local.id } }).catch(() => {});
    }
  }
}
