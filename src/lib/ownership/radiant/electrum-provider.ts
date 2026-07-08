import type { RadiantOwnershipLookup } from "./adapter";
import { RadiantElectrumClient, type RadiantElectrumConfig } from "./electrum-client";
import { getWaveNamesByOwner, hashXFromRadiantAddress, resolveWaveName } from "./wave";

/**
 * Real Radiant name ownership lookups, backed by RXinDexer (an ElectrumX
 * fork/extension that understands Radiant's Wave/Glyphs asset protocol -
 * https://radiantblockchain.org/glyphs-protocol-guide.html). See ./wave.ts
 * for the underlying `wave.reverse_lookup`/`wave.resolve`/`glyph.get_token`
 * calls, all confirmed against real RXinDexer responses.
 */
export class ElectrumRadiantOwnershipLookup implements RadiantOwnershipLookup {
  private readonly client: RadiantElectrumClient;

  constructor(config?: Partial<RadiantElectrumConfig>) {
    const host = config?.host ?? process.env.RADIANT_ELECTRUMX_HOST;
    const port = config?.port ?? Number(process.env.RADIANT_ELECTRUMX_PORT);
    if (!host || !port) {
      throw new Error("ElectrumRadiantOwnershipLookup requires RADIANT_ELECTRUMX_HOST and RADIANT_ELECTRUMX_PORT.");
    }
    this.client = new RadiantElectrumClient({
      host,
      port,
      timeoutMs: config?.timeoutMs ?? Number(process.env.RADIANT_ELECTRUMX_TIMEOUT_MS ?? 10_000),
    });
  }

  async getNamesByOwner(address: string): Promise<string[]> {
    return getWaveNamesByOwner(this.client, address);
  }

  /**
   * Deliberately does NOT catch errors here (mirrors ../avian/rpc-provider.ts) -
   * a thrown error means we couldn't verify anything (RXinDexer unreachable,
   * timeout), which callers must not treat the same as a confirmed "no
   * owner": conflating the two would make a transient outage during the
   * background ownership sweep (src/lib/dns/ownership-watcher.ts) look
   * identical to every tracked name being transferred, disabling everyone's
   * DNS records. `target` is wave.resolve's actual resolved owner address -
   * not `zone`, which is separate user-settable DNS-style data that isn't
   * guaranteed to match the current owner.
   */
  async getOwnerAddress(name: string): Promise<string | null> {
    const result = await resolveWaveName(this.client, name);
    if (!result || result.available) return null;
    return result.target ?? null;
  }

  /**
   * Compares hashXes rather than addresses: wave.resolve's `owner` field is
   * the same one-way truncated hashX as wave.reverse_lookup's, which can't
   * be turned back into an address - so we hash the candidate address
   * ourselves and compare, instead of trying to invert theirs.
   */
  async verifyOwner(name: string, address: string): Promise<boolean> {
    try {
      const hashX = hashXFromRadiantAddress(address);
      if (!hashX) return false;
      const result = await resolveWaveName(this.client, name);
      return !!result && !result.available && result.owner === hashX;
    } catch {
      return false; // fail closed: can't verify -> deny access
    }
  }

  async isNameActive(name: string): Promise<boolean> {
    try {
      const result = await resolveWaveName(this.client, name);
      return !!result && !result.available;
    } catch {
      return false; // fail closed: can't verify -> treat as inactive
    }
  }
}
