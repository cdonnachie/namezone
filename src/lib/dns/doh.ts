/**
 * Server-side DNS-over-HTTPS lookups against public resolvers, used by the
 * record propagation checker ("is my record visible to the internet yet?").
 *
 * Queries Cloudflare's JSON API first and falls back to Google's. Pure fetch,
 * no dependencies, safe in any server runtime.
 */

export type DohRecordType = "A" | "AAAA" | "CNAME" | "MX" | "TXT";

/** RR type codes as they appear in DoH JSON answers. */
const TYPE_CODES: Record<DohRecordType, number> = {
  A: 1,
  AAAA: 28,
  CNAME: 5,
  MX: 15,
  TXT: 16,
};

export interface PublicLookupResult {
  /** Resolver that produced the result ("cloudflare" | "google"). */
  resolver: string;
  /** Normalized answer values of the requested type (may be empty). */
  answers: string[];
}

interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

/**
 * Normalizes a DoH answer's data so it can be compared against the values we
 * store: TXT chunk quotes stripped and rejoined, hostnames lowercased with a
 * trailing dot, MX whitespace collapsed.
 */
export function normalizeDohAnswer(type: DohRecordType, data: string): string {
  const trimmed = data.trim();
  switch (type) {
    case "TXT": {
      // Resolvers return one or more quoted chunks: "part1" "part2" or "part1""part2".
      const chunks = trimmed.match(/"((?:[^"\\]|\\.)*)"/g);
      if (!chunks) return trimmed;
      return chunks.map((c) => c.slice(1, -1).replace(/\\(.)/g, "$1")).join("");
    }
    case "MX": {
      const [prio, ...rest] = trimmed.split(/\s+/);
      const host = rest.join(" ").toLowerCase();
      return `${prio} ${host.endsWith(".") ? host : `${host}.`}`;
    }
    case "CNAME": {
      const host = trimmed.toLowerCase();
      return host.endsWith(".") ? host : `${host}.`;
    }
    case "AAAA":
      return trimmed.toLowerCase();
    default:
      return trimmed;
  }
}

async function queryResolver(
  url: string,
  headers: Record<string, string>,
  resolver: string,
  type: DohRecordType,
): Promise<PublicLookupResult> {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${resolver} DoH returned ${res.status}`);
  const json = (await res.json()) as DohResponse;
  const wanted = TYPE_CODES[type];
  const answers = (json.Answer ?? [])
    .filter((a) => a.type === wanted)
    .map((a) => normalizeDohAnswer(type, a.data));
  return { resolver, answers };
}

/**
 * Looks up `fqdn`/`type` on a public resolver. Throws only if every resolver
 * fails; an empty `answers` array means the name genuinely doesn't resolve
 * publicly (yet).
 */
export async function lookupPublicDns(fqdn: string, type: DohRecordType): Promise<PublicLookupResult> {
  const name = encodeURIComponent(fqdn);
  try {
    return await queryResolver(
      `https://cloudflare-dns.com/dns-query?name=${name}&type=${type}`,
      { accept: "application/dns-json" },
      "cloudflare",
      type,
    );
  } catch {
    return queryResolver(`https://dns.google/resolve?name=${name}&type=${type}`, {}, "google", type);
  }
}
