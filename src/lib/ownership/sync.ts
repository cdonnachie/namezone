import { prisma } from "@/lib/db";
import { disableClaimedNameRecords } from "@/lib/dns/reconcile";
import { validateSourceName } from "@/lib/dns/validation";
import type { NamespaceConfig } from "@/lib/namespaces/types";

export interface AuthorizeResult {
  ok: boolean;
  status: number;
  name: string;
  error?: string;
  /** True if this visit just (re)claimed a name whose ownership had transferred. */
  transferJustDetected?: boolean;
}

/**
 * Upserts the local ClaimedName cache row for `name`/`address` within
 * `namespace`. `address` has already been confirmed (via a live signed
 * session + a fresh OwnershipAdapter check) to be the *current* owner, so
 * this call itself constitutes the "new owner's first authenticated visit"
 * - status always ends up ACTIVE here, whether or not a transfer was
 * detected.
 *
 * If the cached owner differs from `address`, ownership changed since we
 * last saw this name (possibly already flagged by the background watcher -
 * see src/lib/dns/ownership-watcher.ts): disable the previous owner's
 * records first so their configuration doesn't leak into the new owner's
 * namespace, then record the transfer and reactivate the name for `address`.
 */
export async function syncClaimedNameOwnership(namespace: NamespaceConfig, name: string, address: string) {
  const existing = await prisma.claimedName.findUnique({
    where: { namespace_name: { namespace: namespace.key, name } },
  });
  const now = new Date();
  const ownerChanged = !!existing && existing.ownerAddress !== address;
  // Also treat "the watcher already flagged this TRANSFERRED, and the
  // rightful new owner is only now logging in" as a transfer to surface.
  const transferJustDetected = ownerChanged || existing?.status === "TRANSFERRED";

  if (ownerChanged) {
    await disableClaimedNameRecords(namespace, name, existing.ownerAddress);
  }

  const record = await prisma.claimedName.upsert({
    where: { namespace_name: { namespace: namespace.key, name } },
    create: {
      namespace: namespace.key,
      name,
      ownerAddress: address,
      status: "ACTIVE",
      verifiedAt: now,
      lastOwnershipCheckAt: now,
    },
    update: {
      ownerAddress: address,
      status: "ACTIVE", // a live visit from the verified current owner always (re)activates
      previousOwnerAddress: ownerChanged ? existing.ownerAddress : undefined,
      transferredAt: ownerChanged ? now : undefined,
      verifiedAt: now,
      lastOwnershipCheckAt: now,
    },
  });

  return { record, transferJustDetected };
}

/**
 * Validates the source name format, confirms it is active, and confirms
 * `address` currently owns it within `namespace`. Also syncs the local
 * ClaimedName cache row (including transfer-triggered cleanup - see
 * syncClaimedNameOwnership) so dashboard listings (record counts,
 * last-updated) have somewhere to live.
 */
export async function requireClaimedNameOwnership(
  namespace: NamespaceConfig,
  rawName: string,
  address: string,
): Promise<AuthorizeResult> {
  const parsed = validateSourceName(rawName, namespace);
  if (!parsed.ok) {
    return { ok: false, status: 400, name: rawName, error: parsed.error };
  }
  const name = parsed.value;

  const active = await namespace.adapter.isNameActive(name);
  if (!active) {
    return { ok: false, status: 404, name, error: "Name not found or inactive." };
  }

  const owns = await namespace.adapter.verifyOwner(name, address);
  if (!owns) {
    return { ok: false, status: 403, name, error: "You do not own this name." };
  }

  const { transferJustDetected } = await syncClaimedNameOwnership(namespace, name, address);

  return { ok: true, status: 200, name, transferJustDetected };
}
