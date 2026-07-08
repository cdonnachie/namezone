import { connect } from "node:net";

export interface RadiantElectrumConfig {
  host: string;
  port: number;
  timeoutMs?: number;
}

export class RadiantElectrumError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "RadiantElectrumError";
  }
}

let nextRequestId = 0;

// Hard cap on how much un-newline-terminated data we'll accumulate from the
// server before giving up - a misbehaving or hostile endpoint must not be
// able to grow our memory without bound. Real wave.* responses are a few KB.
const MAX_RESPONSE_BYTES = 1024 * 1024;

/**
 * Minimal ElectrumX JSON-RPC 2.0 client for RXinDexer. Unlike aviand's HTTP
 * RPC (../avian/rpc-client.ts), Electrum's wire protocol is a plain TCP
 * socket carrying newline-delimited JSON: one request per line, one
 * matching response per line - no HTTP framing. This opens a fresh
 * connection per call rather than pooling/multiplexing pending requests,
 * since lookups here are expected to be low-frequency; revisit if that
 * changes. Configured for the non-SSL port - do not point this at a TLS
 * Electrum endpoint.
 */
export class RadiantElectrumClient {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(config: RadiantElectrumConfig) {
    this.host = config.host;
    this.port = config.port;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  call<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = ++nextRequestId;
    const requestLine = `${JSON.stringify({ id, method, params })}\n`;

    return new Promise<T>((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      let buffer = "";
      let settled = false;

      const timer = setTimeout(() => {
        finish(() =>
          reject(new RadiantElectrumError(`Timed out calling "${method}" on RXinDexer (${this.host}:${this.port}).`)),
        );
      }, this.timeoutMs);

      function finish(run: () => void) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        run();
      }

      socket.on("connect", () => {
        socket.write(requestLine);
      });

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        // The server controls how much data arrives before a newline; never
        // buffer without bound on its behalf.
        if (buffer.length > MAX_RESPONSE_BYTES) {
          finish(() =>
            reject(new RadiantElectrumError(`Oversized response from RXinDexer for "${method}" (> ${MAX_RESPONSE_BYTES} bytes).`)),
          );
          return;
        }

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          let parsed: { id?: number; result?: T; error?: { code: number; message: string } };
          try {
            parsed = JSON.parse(line);
          } catch {
            finish(() => reject(new RadiantElectrumError(`Malformed response from RXinDexer for "${method}".`)));
            return;
          }

          // Only accept the response to OUR request. Lines with a different
          // or missing id (e.g. unsolicited server notifications) are
          // skipped, not treated as the answer.
          if (parsed.id !== id) continue;

          if (parsed.error) {
            finish(() =>
              reject(new RadiantElectrumError(`RXinDexer error calling "${method}": ${parsed.error!.message}`, parsed.error!.code)),
            );
            return;
          }
          finish(() => resolve(parsed.result as T));
          return;
        }
      });

      socket.on("error", (err) => {
        finish(() =>
          reject(new RadiantElectrumError(`Failed to reach RXinDexer at ${this.host}:${this.port}: ${err.message}`)),
        );
      });
    });
  }
}
