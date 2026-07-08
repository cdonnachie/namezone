import type { RadiantOwnershipLookup } from "./adapter";

/**
 * Mock Radiant name ownership lookups for local development and testing,
 * used until RXinDexer's Glyphs asset queries are wired up in
 * ./electrum-provider.ts. Configure via the RADIANT_MOCK_OWNERS environment
 * variable, a JSON object mapping name -> owning Radiant address, e.g.:
 *   RADIANT_MOCK_OWNERS='{"bob.rxd":"1BoatSLRHtKNngkdXEeobR76b53LETtpyT"}'
 *
 * All names/addresses are treated as active/registered. Mirrors
 * ../avian/mock-provider.ts.
 */
export class MockRadiantOwnershipLookup implements RadiantOwnershipLookup {
  private readonly ownersByName: Map<string, string>;

  constructor(rawConfig: string | undefined = process.env.RADIANT_MOCK_OWNERS) {
    this.ownersByName = new Map();
    if (!rawConfig) return;

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(rawConfig);
    } catch {
      throw new Error("RADIANT_MOCK_OWNERS is not valid JSON.");
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
