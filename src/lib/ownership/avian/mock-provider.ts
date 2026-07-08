import type { AvianOwnershipLookup } from "./adapter";

/**
 * Mock ANS ownership lookups for local development and testing.
 *
 * Configure via the AVIAN_MOCK_OWNERS environment variable, a JSON object
 * mapping ANS name -> owning Avian address, e.g.:
 *   AVIAN_MOCK_OWNERS='{"bob.avn":"RADDRESS1","alice.avn":"RADDRESS2"}'
 *
 * All names/addresses are treated as active/registered. Swap for
 * AviandRpcAnsOwnershipProvider (./rpc-provider.ts) by implementing the
 * same AvianOwnershipLookup interface.
 */
export class MockAnsOwnershipProvider implements AvianOwnershipLookup {
  private readonly ownersByName: Map<string, string>;

  constructor(rawConfig: string | undefined = process.env.AVIAN_MOCK_OWNERS) {
    this.ownersByName = new Map();
    if (!rawConfig) return;

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(rawConfig);
    } catch {
      throw new Error("AVIAN_MOCK_OWNERS is not valid JSON.");
    }

    for (const [name, owner] of Object.entries(parsed)) {
      this.ownersByName.set(name.trim().toLowerCase(), owner);
    }
  }

  async getNamesByOwner(address: string): Promise<string[]> {
    const names: string[] = [];
    for (const [name, owner] of this.ownersByName.entries()) {
      if (owner === address) names.push(name);
    }
    return names.sort();
  }

  async verifyOwner(name: string, address: string): Promise<boolean> {
    const owner = this.ownersByName.get(name.trim().toLowerCase());
    return owner !== undefined && owner === address;
  }

  async isNameActive(name: string): Promise<boolean> {
    return this.ownersByName.has(name.trim().toLowerCase());
  }

  async getOwnerAddress(name: string): Promise<string | null> {
    return this.ownersByName.get(name.trim().toLowerCase()) ?? null;
  }
}
