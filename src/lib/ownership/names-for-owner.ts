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

  await reconcileClaimedNameRecordsWithPowerDns(namespace, names);

  return Promise.all(
    names.map(async (name) => {
      const { record, transferJustDetected } = await syncClaimedNameOwnership(namespace, name, address);

      return {
        name,
        zone: sourceNameToBaseFqdn(name, namespace),
        recordCount: record._count.records,
        lastUpdated: record.updatedAt,
        transferJustDetected,
      };
    }),
  );
}
