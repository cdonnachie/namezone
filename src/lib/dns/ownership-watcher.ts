import { prisma } from "@/lib/db";
import { listAllNamespaces } from "@/lib/namespaces";
import { disableClaimedNameRecords } from "./reconcile";

export interface OwnershipSweepResult {
  checked: number;
  transferred: string[];
  errors: { namespace: string; name: string; error: string }[];
}

/**
 * Periodically-run sweep across every namespace: re-verifies the current
 * on-chain owner for every tracked claimed name (regardless of current
 * status) and disables records for any name whose owner has changed since
 * we last saw it.
 *
 * Without this, ownership changes are only detected reactively when someone
 * with a valid session visits the app (see syncClaimedNameOwnership) - if
 * nobody ever revisits a transferred name, its old records would keep
 * resolving in PowerDNS indefinitely. This sweep is what closes that gap;
 * wire it up to run every 5-10 minutes via an external scheduler hitting
 * POST /api/cron/verify-ownership (see that route and README).
 *
 * Marks a transferred name's status as TRANSFERRED rather than ACTIVE -
 * unlike the live request path, there's no signed session here proving who
 * the new owner is. They still need to log in normally to manage DNS, which
 * flips the name back to ACTIVE via syncClaimedNameOwnership.
 *
 * Claimed names belonging to an unknown or currently-disabled namespace are
 * skipped defensively (e.g. a namespace temporarily disabled for
 * maintenance shouldn't cause this sweep to spam errors against it).
 *
 * `ownerAddress` uses "" (empty string) as the sentinel for "no current
 * owner" (name inactive/unregistered), since the column itself is
 * non-nullable; the last real owner is preserved in previousOwnerAddress.
 */
export async function sweepAllClaimedNamesForOwnershipChanges(): Promise<OwnershipSweepResult> {
  const namespacesByKey = new Map(listAllNamespaces().map((ns) => [ns.key, ns]));
  const claimedNames = await prisma.claimedName.findMany();

  const result: OwnershipSweepResult = { checked: 0, transferred: [], errors: [] };

  for (const record of claimedNames) {
    const namespace = namespacesByKey.get(record.namespace);
    if (!namespace || !namespace.enabled) continue;

    result.checked++;

    let currentOwner: string | null;
    try {
      currentOwner = await namespace.adapter.getOwnerAddress(record.name);
    } catch (err) {
      result.errors.push({
        namespace: namespace.key,
        name: record.name,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const normalizedCurrentOwner = currentOwner ?? "";
    const now = new Date();

    if (normalizedCurrentOwner === record.ownerAddress) {
      await prisma.claimedName.update({ where: { id: record.id }, data: { lastOwnershipCheckAt: now } });
      continue;
    }

    await disableClaimedNameRecords(namespace, record.name, record.ownerAddress);
    await prisma.claimedName.update({
      where: { id: record.id },
      data: {
        status: "TRANSFERRED",
        previousOwnerAddress: record.ownerAddress,
        transferredAt: now,
        lastOwnershipCheckAt: now,
        ownerAddress: normalizedCurrentOwner,
      },
    });
    result.transferred.push(`${namespace.key}/${record.name}`);
  }

  return result;
}
