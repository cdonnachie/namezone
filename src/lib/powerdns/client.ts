import { FIXED_TTL, RESERVED_ROOT_HOSTS } from "@/lib/dns/constants";

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

export type PowerDnsSupportedType = "A" | "AAAA" | "CNAME" | "TXT" | "MX";
const SUPPORTED_TYPES: readonly string[] = ["A", "AAAA", "CNAME", "TXT", "MX"];

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

// A single DNS TXT character-string maxes out at 255 bytes; longer values
// (DKIM public keys, notably) must be split into multiple quoted strings
// that resolvers concatenate back together.
const TXT_CHUNK_SIZE = 255;

/** Wraps a TXT value in the quoted, escaped (and if needed chunked) rdata format DNS/PowerDNS expects. */
function formatTxtRdata(value: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += TXT_CHUNK_SIZE) {
    const chunk = value.slice(i, i + TXT_CHUNK_SIZE);
    chunks.push(`"${chunk.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  }
  return chunks.length > 0 ? chunks.join(" ") : '""';
}

/** Inverse of formatTxtRdata: concatenates all quoted strings, unescaped. */
function parseTxtRdata(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  const segments: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed)) !== null) {
    segments.push(match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return segments.length > 0 ? segments.join("") : trimmed;
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

  /**
   * Last-line defense in depth, independent of the API layer's
   * authorizeFqdnForName: no write leaving this client may ever touch the
   * zone apex (SOA/NS/site records live there), a reserved operator
   * hostname (ns1/ns2/www) or anything beneath one, or any name outside
   * the zone being patched. Every legitimate write is to `<owner-name>.
   * <zone>.` or deeper, so a violation here always means a bug (or bypass)
   * upstream - throw loudly rather than let it reach PowerDNS.
   */
  private assertWritableNames(zone: string, rrsets: PowerDnsRRSet[]): void {
    const zoneRoot = `${zone.toLowerCase().replace(/\.$/, "")}.`;
    for (const rrset of rrsets) {
      const name = rrset.name.toLowerCase();
      if (name === zoneRoot) {
        throw new PowerDnsError(`Refusing to write to zone apex "${rrset.name}".`);
      }
      if (!name.endsWith(`.${zoneRoot}`)) {
        throw new PowerDnsError(`Refusing to write to "${rrset.name}" - outside zone "${zoneRoot}".`);
      }
      for (const host of RESERVED_ROOT_HOSTS) {
        const reserved = `${host}.${zoneRoot}`;
        if (name === reserved || name.endsWith(`.${reserved}`)) {
          throw new PowerDnsError(`Refusing to write to reserved name "${rrset.name}".`);
        }
      }
    }
  }

  private async patchZone(zone: string, rrsets: PowerDnsRRSet[]): Promise<void> {
    this.assertWritableNames(zone, rrsets);
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

  /** Creates or replaces a single A/AAAA/CNAME/MX record at `fqdn` (single-value rrset). */
  async upsertRecord(
    zone: string,
    fqdn: string,
    type: "A" | "AAAA" | "CNAME" | "MX",
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
   * Replaces the entire rrset at `fqdn` with exactly `values` for a raw
   * (non-TXT) multi-value type - A/AAAA (multiple IPs, e.g. GitHub Pages'
   * four apex records) or MX (2+ mail hosts, already formatted as
   * "<priority> <target>."). Empty array deletes the rrset. TXT has its own
   * quoted/chunked writer (upsertTxtRecords).
   */
  async upsertRawRecordSet(
    zone: string,
    fqdn: string,
    type: "A" | "AAAA" | "MX",
    values: string[],
    ttl: number = FIXED_TTL,
  ): Promise<void> {
    if (values.length === 0) {
      await this.deleteRecord(zone, fqdn, type);
      return;
    }
    await this.patchZone(zone, [
      {
        name: fqdn,
        type,
        ttl,
        changetype: "REPLACE",
        records: values.map((v) => ({ content: v, disabled: false })),
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
