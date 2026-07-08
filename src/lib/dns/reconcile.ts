import { recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { NamespaceConfig } from "@/lib/namespaces/types";
import { getPowerDnsClient, type PowerDnsRecordSummary } from "@/lib/powerdns/client";
import { ACME_TXT_DEFAULT_EXPIRY_HOURS, ACME_TXT_TTL } from "./constants";
import { fqdnToRelativeHost, sourceNameToBaseFqdn } from "./validation";

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
  const records = await prisma.dnsRecord.findMany({
    where: { namespace: namespace.key, claimedName: name, status: "ACTIVE" },
  });
  if (records.length === 0) return;

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
  const localRecords = await prisma.dnsRecord.findMany({
    where: { namespace: namespace.key, claimedName: name, status: "ACTIVE" },
  });

  const liveSingle = liveRecords.filter((r) => r.type !== "TXT");
  const liveTxt = liveRecords.filter((r) => r.type === "TXT");

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
    if (local.type === "TXT") continue;
    if (!singleKeys.has(`${local.fqdn}|${local.type}`)) {
      await prisma.dnsRecord.delete({ where: { id: local.id } }).catch(() => {});
    }
  }

  // Multi-value type (TXT / ACME challenges): many values may coexist per (fqdn, type).
  const liveTxtKeys = new Set(liveTxt.map((r) => `${r.name}|${r.content}`));
  for (const live of liveTxt) {
    const relativeHost = fqdnToRelativeHost(live.name, name, namespace);
    await prisma.dnsRecord.upsert({
      where: {
        namespace_fqdn_type_value: { namespace: namespace.key, fqdn: live.name, type: "TXT", value: live.content },
      },
      create: {
        namespace: namespace.key,
        claimedName: name,
        fqdn: live.name,
        relativeHost,
        type: "TXT",
        value: live.content,
        ttl: live.ttl,
        isAcmeChallenge: true,
        // Discovered outside the app (no known intended lifetime) - give it
        // the standard default rather than leaving it permanent.
        expiresAt: new Date(Date.now() + ACME_TXT_DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000),
      },
      update: { status: "ACTIVE", disabledReason: null },
    });
  }
  for (const local of localRecords) {
    if (local.type !== "TXT") continue;
    if (!liveTxtKeys.has(`${local.fqdn}|${local.value}`)) {
      await prisma.dnsRecord.delete({ where: { id: local.id } }).catch(() => {});
    }
  }
}
