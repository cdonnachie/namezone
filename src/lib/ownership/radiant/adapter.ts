import type { OwnershipAdapter } from "@/lib/namespaces/types";
import { buildRadiantLoginChallengeMessage, verifyRadiantSignedMessage } from "./message";
import { MockRadiantOwnershipLookup } from "./mock-provider";
import { ElectrumRadiantOwnershipLookup } from "./electrum-provider";

/** Just the ownership-lookup slice - signing (below) is the same regardless of lookup source. */
export interface RadiantOwnershipLookup {
  getNamesByOwner(address: string): Promise<string[]>;
  getOwnerAddress(name: string): Promise<string | null>;
  verifyOwner(name: string, address: string): Promise<boolean>;
  isNameActive(name: string): Promise<boolean>;
}

/**
 * Composes an ownership-lookup implementation (mock or RXinDexer-backed)
 * with Radiant's signing scheme into a complete OwnershipAdapter. Delegates
 * each method explicitly rather than `{ ...lookup }` - lookup is a class
 * instance, and spreading one only copies its own instance fields, not its
 * prototype methods, which would silently produce an adapter with no
 * working methods (see ../avian/adapter.ts's history of this exact bug).
 */
export function createRadiantAdapter(lookup: RadiantOwnershipLookup): OwnershipAdapter {
  return {
    getNamesByOwner: (address) => lookup.getNamesByOwner(address),
    getOwnerAddress: (name) => lookup.getOwnerAddress(name),
    verifyOwner: (name, address) => lookup.verifyOwner(name, address),
    isNameActive: (name) => lookup.isNameActive(name),
    buildLoginChallengeMessage: buildRadiantLoginChallengeMessage,
    verifySignedMessage: verifyRadiantSignedMessage,
  };
}

/** Picks a RXinDexer-backed lookup if configured, else the env-driven mock. */
export function createDefaultRadiantLookup(): RadiantOwnershipLookup {
  const hasElectrumConfig = !!process.env.RADIANT_ELECTRUMX_HOST && !!process.env.RADIANT_ELECTRUMX_PORT;
  return hasElectrumConfig ? new ElectrumRadiantOwnershipLookup() : new MockRadiantOwnershipLookup();
}
