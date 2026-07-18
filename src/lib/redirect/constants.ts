import { FIXED_TTL } from "@/lib/dns/constants";
import { isValidIPv4, isValidIPv6 } from "@/lib/dns/validation";

/**
 * Allowlisted HTTP redirect status codes. Anything outside this set is
 * rejected before it can be stored or served.
 */
export const REDIRECT_STATUS_CODES = [301, 302, 307, 308] as const;
export type RedirectStatusCode = (typeof REDIRECT_STATUS_CODES)[number];

/** Default when the user does not choose one. Temporary, so mistakes aren't cached hard. */
export const DEFAULT_REDIRECT_STATUS: RedirectStatusCode = 302;

export function isRedirectStatusCode(n: number): n is RedirectStatusCode {
  return (REDIRECT_STATUS_CODES as readonly number[]).includes(n);
}

/** 301/308 are cached by browsers and search engines; the UI warns about them. */
export function isPermanentRedirect(code: RedirectStatusCode): boolean {
  return code === 301 || code === 308;
}

/**
 * Cache policy for the emitted redirect. Temporary redirects are never
 * cached; permanent ones get only a short max-age during rollout so a
 * mistaken permanent redirect can still be corrected without users being
 * stuck on a long-lived cached 301.
 */
export function redirectCacheControl(code: RedirectStatusCode): string {
  return isPermanentRedirect(code) ? "public, max-age=300" : "no-store";
}

/** Cap on managed redirects per claimed name (mirrors MAX_HOSTNAMES_PER_NAME). */
export const MAX_REDIRECTS_PER_NAME = 20;

/** Bounded depth for redirect-loop detection (see wouldRedirectLoop). */
export const MAX_REDIRECT_CHAIN_HOPS = 10;

/** TTL for the managed A/AAAA records that point a redirect host at the service. */
export const REDIRECT_RECORD_TTL = FIXED_TTL;

export interface RedirectServiceTargets {
  ipv4?: string;
  ipv6?: string;
}

/**
 * Reads a redirect-service IP for a namespace: a per-namespace override
 * (`${KEY}_REDIRECT_SERVICE_IPV4`, e.g. RADIANT_REDIRECT_SERVICE_IPV4) wins
 * over the shared `REDIRECT_SERVICE_IPV4`. Empty/unset → undefined; a
 * configured-but-malformed value throws (fail fast rather than write junk DNS).
 */
function readServiceIp(nsKey: string, suffix: "IPV4" | "IPV6"): string | undefined {
  const perNs = process.env[`${nsKey.toUpperCase()}_REDIRECT_SERVICE_${suffix}`];
  const shared = process.env[`REDIRECT_SERVICE_${suffix}`];
  const raw = (perNs ?? shared ?? "").trim();
  if (!raw) return undefined;
  const valid = suffix === "IPV4" ? isValidIPv4(raw) : isValidIPv6(raw);
  if (!valid) {
    const label = suffix === "IPV4" ? "IPv4" : "IPv6";
    throw new Error(`REDIRECT_SERVICE_${suffix} for namespace "${nsKey}" is not a valid ${label} address.`);
  }
  return suffix === "IPV6" ? raw.toLowerCase() : raw;
}

export function redirectServiceTargets(nsKey: string): RedirectServiceTargets {
  return { ipv4: readServiceIp(nsKey, "IPV4"), ipv6: readServiceIp(nsKey, "IPV6") };
}

/**
 * The A/AAAA records to write so a redirect host resolves to the redirect
 * service (and, in turn, Caddy's on-demand TLS). At least one of A/AAAA must
 * exist for the feature to function; callers gate on isRedirectFeatureEnabled.
 */
export function redirectDnsRecords(nsKey: string): Array<{ type: "A" | "AAAA"; value: string }> {
  const targets = redirectServiceTargets(nsKey);
  const records: Array<{ type: "A" | "AAAA"; value: string }> = [];
  if (targets.ipv4) records.push({ type: "A", value: targets.ipv4 });
  if (targets.ipv6) records.push({ type: "AAAA", value: targets.ipv6 });
  return records;
}

/**
 * Redirects are available in a namespace when a redirect-service target is
 * configured (there is somewhere to point the DNS) and the feature has not
 * been explicitly killed via REDIRECT_ENABLED=false. This means the feature
 * lights up automatically for any namespace — rxd.zone, avn.zone, or a future
 * xyz.zone — the moment its service IP is set, with no per-namespace code.
 */
export function isRedirectFeatureEnabled(nsKey: string): boolean {
  if ((process.env.REDIRECT_ENABLED ?? "").trim().toLowerCase() === "false") return false;
  const targets = redirectServiceTargets(nsKey);
  return Boolean(targets.ipv4 || targets.ipv6);
}

/**
 * Per-name reserved host labels (configurable, default none). Note: platform
 * infrastructure lives at the ROOT of each zone (ns1/ns2/www.<zone>) and is
 * already protected by authorizeFqdnForName / assertWritableNames — there is
 * no platform infra under an owner's own name, so this list is empty unless an
 * operator has a specific reason to block a label like "x.<name>.<zone>".
 */
export function redirectReservedHosts(): string[] {
  return (process.env.REDIRECT_RESERVED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
