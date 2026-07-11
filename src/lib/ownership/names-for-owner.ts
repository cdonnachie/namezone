import { prisma } from "@/lib/db";
import { reconcileClaimedNameRecordsWithPowerDns } from "@/lib/dns/reconcile";
import { sourceNameToBaseFqdn, validateSourceName } from "@/lib/dns/validation";
import type { NamespaceConfig } from "@/lib/namespaces/types";
import { syncClaimedNameOwnership } from "./sync";

export interface ClaimedNameSummary {
  name: string;
  zone: string;
  recordCount: number;
  lastUpdated: Date;
  transferJustDetected: boolean;
}

/** Fetches all source names owned by `address` within `namespace`, syncing the local cache row for each. */
export async function getOwnedNameSummaries(
  namespace: NamespaceConfig,
  address: string,
): Promise<ClaimedNameSummary[]> {
  // Drop anything that isn't a valid, non-reserved source name rather than
  // letting one bad entry throw and take down the whole dashboard: adapters
  // return whatever the chain says the address owns, which can include
  // reserved labels (e.g. "www.rxd" - on-chain ownership is real, but the
  // operator keeps www.<zone>) or names that aren't DNS-safe.
  const names = (await namespace.adapter.getNamesByOwner(address)).filter(
    (name) => validateSourceName(name, namespace).ok,
  );

  // Sync ownership BEFORE reconciling: reconcile upserts DnsRecord rows whose
  // (namespace, claimedName) FK requires the ClaimedName row to already exist,
  // and this is what creates it (a wiped local DB against a live PowerDNS
  // would otherwise 500 with a foreign-key violation). It also means
  // transfer-triggered record cleanup happens before reconcile snapshots the
  // live zone, not after.
  const synced = await Promise.all(
    names.map(async (name) => ({
      name,
      ...(await syncClaimedNameOwnership(namespace, name, address)),
    })),
  );

  await reconcileClaimedNameRecordsWithPowerDns(namespace, names);

  // Count records only after reconcile - it may have mirrored live PowerDNS
  // records into rows that didn't exist locally yet (or removed stale ones).
  const counts = await prisma.dnsRecord.groupBy({
    by: ["claimedName"],
    where: { namespace: namespace.key, claimedName: { in: names }, status: "ACTIVE" },
    _count: { _all: true },
  });
  const countByName = new Map(counts.map((c) => [c.claimedName, c._count._all]));

  return synced.map(({ name, record, transferJustDetected }) => ({
    name,
    zone: sourceNameToBaseFqdn(name, namespace),
    recordCount: countByName.get(name) ?? 0,
    lastUpdated: record.updatedAt,
    transferJustDetected,
  }));
}
