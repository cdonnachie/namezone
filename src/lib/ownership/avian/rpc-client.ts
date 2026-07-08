/**
 * Minimal JSON-RPC 1.0 client for `aviand` (Avian Core), matching the
 * standard Bitcoin-family daemon RPC wire format: HTTP Basic Auth, a single
 * POST endpoint, `{jsonrpc, id, method, params}` requests.
 *
 * The node must be started with `-assetindex=1` (or `assetindex=1` in
 * avian.conf) for the asset-lookup RPCs this app relies on
 * (`listaddressesbyasset`, `listassetbalancesbyaddress`) to work.
 */
export class AviandRpcError extends Error {
  constructor(
    message: string,
    public readonly rpcCode?: number,
  ) {
    super(message);
    this.name = "AviandRpcError";
  }
}

export interface AviandRpcConfig {
  url: string;
  user: string;
  password: string;
  timeoutMs?: number;
}

export class AviandRpcClient {
  private readonly url: string;
  private readonly authHeader: string;
  private readonly timeoutMs: number;

  constructor(config: AviandRpcConfig) {
    this.url = config.url;
    this.authHeader = `Basic ${Buffer.from(`${config.user}:${config.password}`).toString("base64")}`;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.authHeader,
        },
        body: JSON.stringify({ jsonrpc: "1.0", id: "avian-name-zone", method, params }),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (err) {
      throw new AviandRpcError(
        `Failed to reach aviand RPC at ${this.url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      throw new AviandRpcError(
        `aviand RPC HTTP ${res.status}${json?.error?.message ? `: ${json.error.message}` : ""}`,
        json?.error?.code,
      );
    }
    if (json?.error) {
      throw new AviandRpcError(`aviand RPC error: ${json.error.message ?? JSON.stringify(json.error)}`, json.error.code);
    }
    return json.result as T;
  }
}
