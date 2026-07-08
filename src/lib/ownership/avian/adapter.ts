import type { OwnershipAdapter } from "@/lib/namespaces/types";
import { buildAvianLoginChallengeMessage, verifyAvianSignedMessage } from "./message";
import { MockAnsOwnershipProvider } from "./mock-provider";
import { AviandRpcAnsOwnershipProvider } from "./rpc-provider";

/** Just the ownership-lookup slice - signing (below) is the same regardless of lookup source. */
export interface AvianOwnershipLookup {
  getNamesByOwner(address: string): Promise<string[]>;
  getOwnerAddress(name: string): Promise<string | null>;
  verifyOwner(name: string, address: string): Promise<boolean>;
  isNameActive(name: string): Promise<boolean>;
}

/**
 * Composes an ownership-lookup implementation (mock or real RPC) with
 * Avian's signing scheme into a complete OwnershipAdapter. A real signature
 * always needs the same real crypto verification regardless of whether
 * ownership lookups are mocked, so signing isn't duplicated per lookup impl.
 */
export function createAvianAdapter(lookup: AvianOwnershipLookup): OwnershipAdapter {
  return {
    getNamesByOwner: (address) => lookup.getNamesByOwner(address),
    getOwnerAddress: (name) => lookup.getOwnerAddress(name),
    verifyOwner: (name, address) => lookup.verifyOwner(name, address),
    isNameActive: (name) => lookup.isNameActive(name),
    buildLoginChallengeMessage: buildAvianLoginChallengeMessage,
    verifySignedMessage: verifyAvianSignedMessage,
  };
}

/** Picks a real aviand-RPC-backed lookup if configured, else the env-driven mock. */
export function createDefaultAvianLookup(): AvianOwnershipLookup {
  const hasRpcConfig =
    !!process.env.AVIAN_RPC_URL && !!process.env.AVIAN_RPC_USER && !!process.env.AVIAN_RPC_PASSWORD;
  return hasRpcConfig ? new AviandRpcAnsOwnershipProvider() : new MockAnsOwnershipProvider();
}
