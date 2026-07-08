import { validateSourceName } from "@/lib/dns/validation";
import { AviandRpcClient, type AviandRpcConfig } from "./rpc-client";

const AVIAN_TLD = "avn";
const OWNER_TOKEN_TLD_SUFFIX = `.${AVIAN_TLD.toUpperCase()}!`; // ".AVN!"

/**
 * Real ANS ownership lookups backed by `aviand`'s (Avian Core) JSON-RPC
 * asset index. Implements just the ownership-lookup slice of
 * OwnershipAdapter - signing lives in ./message.ts, composed together in
 * ./adapter.ts (an RPC outage shouldn't require reimplementing signing).
 *
 * ANS names are Ravencoin-style assets: registering "bob.avn" issues the
 * on-chain asset "BOB.AVN", which — per standard Ravencoin/Avian asset
 * semantics — automatically mints a paired, always-quantity-1,
 * non-divisible "owner token" asset "BOB.AVN!" to the issuer. Whoever holds
 * the "<NAME>.AVN!" owner token controls DNS for that name — confirmed as
 * the correct convention (not merely holding the base asset).
 *
 * Requires the node to run with `-assetindex=1` so `listaddressesbyasset`
 * and `listassetbalancesbyaddress` are available.
 */
export class AviandRpcAnsOwnershipProvider {
  private readonly client: AviandRpcClient;

  constructor(config?: Partial<AviandRpcConfig>) {
    const url = config?.url ?? process.env.AVIAN_RPC_URL;
    const user = config?.user ?? process.env.AVIAN_RPC_USER;
    const password = config?.password ?? process.env.AVIAN_RPC_PASSWORD;
    if (!url || !user || !password) {
      throw new Error(
        "AviandRpcAnsOwnershipProvider requires AVIAN_RPC_URL, AVIAN_RPC_USER, and AVIAN_RPC_PASSWORD.",
      );
    }
    this.client = new AviandRpcClient({
      url,
      user,
      password,
      timeoutMs: config?.timeoutMs ?? Number(process.env.AVIAN_RPC_TIMEOUT_MS ?? 10_000),
    });
  }

  private ownerAssetName(name: string): string {
    const parsed = validateSourceName(name, { tld: AVIAN_TLD });
    if (!parsed.ok) throw new Error(parsed.error);
    return `${parsed.value.toUpperCase()}!`;
  }

  /**
   * Resolves the single current holder of a name's owner token, or null if
   * *confirmed* unregistered (the RPC call succeeded and returned no/many
   * holders). Deliberately does NOT catch errors here: a thrown error means
   * we couldn't verify anything (RPC unreachable, timeout, malformed
   * response), which callers must not treat the same as a confirmed "no
   * owner" - conflating the two would mean a transient node outage during
   * the background ownership sweep (src/lib/dns/ownership-watcher.ts) looks
   * identical to every tracked name being transferred, disabling everyone's
   * DNS records. Callers that want fail-closed *access control* semantics
   * (verifyOwner/isNameActive below) catch and handle this themselves.
   */
  async getOwnerAddress(name: string): Promise<string | null> {
    const ownerAsset = this.ownerAssetName(name);
    const holders = await this.client.call<Record<string, number>>("listaddressesbyasset", [ownerAsset]);
    const holderEntries = Object.entries(holders).filter(([, qty]) => qty >= 1);
    // Owner tokens are protocol-guaranteed unique (supply always 1), so
    // there should never be more than one holder; if there somehow is,
    // treat it as unresolved rather than guessing.
    if (holderEntries.length !== 1) return null;
    return holderEntries[0][0];
  }

  async getNamesByOwner(address: string): Promise<string[]> {
    let balances: Record<string, number>;
    try {
      balances = await this.client.call<Record<string, number>>("listassetbalancesbyaddress", [address]);
    } catch {
      return [];
    }

    const names: string[] = [];
    for (const [assetName, qty] of Object.entries(balances)) {
      if (qty < 1) continue;
      if (!assetName.endsWith(OWNER_TOKEN_TLD_SUFFIX)) continue;

      const bare = assetName.slice(0, -1); // strip trailing "!"
      const candidate = bare.toLowerCase(); // "bob.avn"
      const parsed = validateSourceName(candidate, { tld: AVIAN_TLD });
      if (!parsed.ok) continue; // asset name doesn't map to a DNS-safe name; skip defensively
      names.push(parsed.value);
    }
    return names.sort();
  }

  async verifyOwner(name: string, address: string): Promise<boolean> {
    try {
      const owner = await this.getOwnerAddress(name);
      return owner === address;
    } catch {
      return false; // fail closed: can't verify ownership -> deny access
    }
  }

  async isNameActive(name: string): Promise<boolean> {
    try {
      return (await this.getOwnerAddress(name)) !== null;
    } catch {
      return false; // fail closed: can't verify -> treat as inactive
    }
  }
}
