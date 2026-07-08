import { FIXED_TTL } from "@/lib/dns/constants";

export class PowerDnsError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "PowerDnsError";
  }
}

export type PowerDnsSupportedType = "A" | "AAAA" | "CNAME" | "TXT";
const SUPPORTED_TYPES: readonly string[] = ["A", "AAAA", "CNAME", "TXT"];

interface PowerDnsRecord {
  content: string;
  disabled: boolean;
}

interface PowerDnsRRSet {
  name: string;
  type: string;
  ttl?: number;
  changetype?: "REPLACE" | "DELETE";
  records?: PowerDnsRecord[];
}

interface PowerDnsZoneResponse {
  rrsets: PowerDnsRRSet[];
}

export interface PowerDnsRecordSummary {
  name: string;
  type: PowerDnsSupportedType;
  ttl: number;
  content: string;
  disabled: boolean;
}

/** Wraps a TXT value in the quoted, escaped rdata format DNS/PowerDNS expects. */
function formatTxtRdata(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** Inverse of formatTxtRdata: strips surrounding quotes and unescapes. */
function parseTxtRdata(content: string): string {
  const trimmed = content.trim();
  const unwrapped =
    trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1)
      : trimmed;
  return unwrapped.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/**
 * Thin client around the PowerDNS Authoritative HTTP API. All calls are
 * server-side only — the API key must never reach the browser.
 *
 * One shared PowerDNS instance/credential set serves every namespace; each
 * call takes the target `zone` (e.g. "avn.zone.", "rxd.zone.") explicitly
 * rather than fixing it at construction, so namespaces don't need separate
 * client instances or PowerDNS servers.
 *
 * If POWERDNS_API_URL is not configured, the client runs in "dry run" mode:
 * writes are logged instead of sent, which is useful for local development
 * and demos without a running PowerDNS instance. Reads return an empty zone.
 */
export class PowerDnsClient {
  private readonly baseUrl: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly serverId: string;
  readonly dryRun: boolean;

  constructor(config: { baseUrl?: string; apiKey?: string; serverId?: string } = {}) {
    this.baseUrl = config.baseUrl ?? process.env.POWERDNS_API_URL;
    this.apiKey = config.apiKey ?? process.env.POWERDNS_API_KEY;
    this.serverId = config.serverId ?? process.env.POWERDNS_SERVER_ID ?? "localhost";
    this.dryRun = !this.baseUrl || !this.apiKey;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.baseUrl || !this.apiKey) {
      throw new PowerDnsError("PowerDNS client called outside dry-run without configuration.");
    }
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/v1/servers/${this.serverId}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text().catch(() => undefined);
      }
      throw new PowerDnsError(`PowerDNS API error (${res.status})`, res.status, body);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async getZone(zone: string): Promise<PowerDnsZoneResponse> {
    if (this.dryRun) return { rrsets: [] };
    return this.request<PowerDnsZoneResponse>(`/zones/${zone}`);
  }

  private async patchZone(zone: string, rrsets: PowerDnsRRSet[]): Promise<void> {
    if (this.dryRun) {
      console.warn(
        `[powerdns:dry-run] POWERDNS_API_URL/POWERDNS_API_KEY not set — skipping real write to ${zone}:`,
        JSON.stringify(rrsets),
      );
      return;
    }
    await this.request<void>(`/zones/${zone}`, {
      method: "PATCH",
      body: JSON.stringify({ rrsets }),
    });
  }

  /** Lists every A/AAAA/CNAME/TXT record in the whole zone, unfiltered. */
  async listAllRecords(zone: string): Promise<PowerDnsRecordSummary[]> {
    const zoneData = await this.getZone(zone);
    const results: PowerDnsRecordSummary[] = [];

    for (const rrset of zoneData.rrsets) {
      if (!SUPPORTED_TYPES.includes(rrset.type)) continue;
      const type = rrset.type as PowerDnsSupportedType;
      for (const record of rrset.records ?? []) {
        results.push({
          name: rrset.name,
          type,
          ttl: rrset.ttl ?? FIXED_TTL,
          content: type === "TXT" ? parseTxtRdata(record.content) : record.content,
          disabled: record.disabled,
        });
      }
    }
    return results;
  }

  /** Lists all supported records under a given source name's base FQDN (itself + children). */
  async listRecords(zone: string, baseFqdn: string): Promise<PowerDnsRecordSummary[]> {
    const all = await this.listAllRecords(zone);
    return all.filter((r) => r.name === baseFqdn || r.name.endsWith(`.${baseFqdn}`));
  }

  /** Creates or replaces a single A/AAAA/CNAME record at `fqdn` (single-value rrset). */
  async upsertRecord(
    zone: string,
    fqdn: string,
    type: "A" | "AAAA" | "CNAME",
    value: string,
    ttl: number = FIXED_TTL,
  ): Promise<void> {
    await this.patchZone(zone, [
      {
        name: fqdn,
        type,
        ttl,
        changetype: "REPLACE",
        records: [{ content: value, disabled: false }],
      },
    ]);
  }

  /**
   * Replaces the entire TXT rrset at `fqdn` with exactly `values` (each
   * quoted/escaped per DNS TXT rdata format). Used for ACME challenges,
   * which may need multiple concurrent values at the same name. Passing an
   * empty array deletes the rrset entirely.
   */
  async upsertTxtRecords(zone: string, fqdn: string, values: string[], ttl: number): Promise<void> {
    if (values.length === 0) {
      await this.deleteRecord(zone, fqdn, "TXT");
      return;
    }
    await this.patchZone(zone, [
      {
        name: fqdn,
        type: "TXT",
        ttl,
        changetype: "REPLACE",
        records: values.map((v) => ({ content: formatTxtRdata(v), disabled: false })),
      },
    ]);
  }

  /** Deletes the entire rrset (all values) at `fqdn` for the given type. */
  async deleteRecord(zone: string, fqdn: string, type: PowerDnsSupportedType): Promise<void> {
    await this.patchZone(zone, [
      {
        name: fqdn,
        type,
        changetype: "DELETE",
      },
    ]);
  }

  /** Optionally triggers a notify to secondaries after a batch of writes. */
  async notify(zone: string): Promise<void> {
    if (this.dryRun) return;
    if (process.env.POWERDNS_NOTIFY !== "true") return;
    try {
      await this.request<void>(`/zones/${zone}/notify`, { method: "PUT" });
    } catch (err) {
      console.error("[powerdns] notify failed", err);
    }
  }
}

let sharedClient: PowerDnsClient | undefined;

export function getPowerDnsClient(): PowerDnsClient {
  if (!sharedClient) sharedClient = new PowerDnsClient();
  return sharedClient;
}
