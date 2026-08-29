import { FIXED_TTL } from "@/lib/dns/constants";
import { isValidIPv4, isValidIPv6 } from "@/lib/dns/validation";

/**
 * Configuration for hostnames pointed at a generated website.
 *
 * Deliberately parallel to src/lib/redirect/constants.ts, and for the same
 * reason: a managed site is just "this hostname is owned by a subsystem, not
 * by the record editor". The two differ only in where they point — a redirect
 * always points at this server, whereas a site may be self-hosted here OR
 * CNAMEd to wherever a companion app deployed it.
 */

/** TTL for managed site records. Same as every other record we write. */
export const SITE_RECORD_TTL = FIXED_TTL;

/** Cap on managed sites per claimed name (mirrors MAX_REDIRECTS_PER_NAME). */
export const MAX_SITES_PER_NAME = 20;

export interface SiteServiceTargets {
  ipv4?: string;
  ipv6?: string;
}

/**
 * Reads the site-hosting service IP for a namespace: a per-namespace override
 * (`${KEY}_SITE_SERVICE_IPV4`) wins over the shared `SITE_SERVICE_IPV4`.
 * Empty/unset → undefined; configured-but-malformed throws (fail fast rather
 * than write junk DNS).
 *
 * Keep this distinct from REDIRECT_SERVICE_IPV4 even when both point at the
 * same machine: user-generated sites and the redirect service are different
 * trust domains, and separating the addresses is what lets them move to
 * separate hosts (or separate containers) without a DNS rewrite.
 */
function readServiceIp(nsKey: string, suffix: "IPV4" | "IPV6"): string | undefined {
  const perNs = process.env[`${nsKey.toUpperCase()}_SITE_SERVICE_${suffix}`];
  const shared = process.env[`SITE_SERVICE_${suffix}`];
  const raw = (perNs ?? shared ?? "").trim();
  if (!raw) return undefined;
  const valid = suffix === "IPV4" ? isValidIPv4(raw) : isValidIPv6(raw);
  if (!valid) {
    const label = suffix === "IPV4" ? "IPv4" : "IPv6";
    throw new Error(`SITE_SERVICE_${suffix} for namespace "${nsKey}" is not a valid ${label} address.`);
  }
  return suffix === "IPV6" ? raw.toLowerCase() : raw;
}

export function siteServiceTargets(nsKey: string): SiteServiceTargets {
  return { ipv4: readServiceIp(nsKey, "IPV4"), ipv6: readServiceIp(nsKey, "IPV6") };
}

/**
 * The A/AAAA records that point a hostname at this server's site service.
 * Only used for SELF_HOSTED sites; EXTERNAL ones get a CNAME instead.
 */
export function siteDnsRecords(nsKey: string): Array<{ type: "A" | "AAAA"; value: string }> {
  const targets = siteServiceTargets(nsKey);
  const records: Array<{ type: "A" | "AAAA"; value: string }> = [];
  if (targets.ipv4) records.push({ type: "A", value: targets.ipv4 });
  if (targets.ipv6) records.push({ type: "AAAA", value: targets.ipv6 });
  return records;
}

/**
 * Self-hosting is available once a site-service target is configured. An
 * EXTERNAL (CNAME) site needs no service IP, so it stays available whenever
 * the feature as a whole is on — which is what lets an operator offer
 * "deploy to your own Vercel" without hosting anything themselves.
 */
export function isSelfHostingEnabled(nsKey: string): boolean {
  if ((process.env.SITE_HOSTING_ENABLED ?? "").trim().toLowerCase() === "false") return false;
  const targets = siteServiceTargets(nsKey);
  return Boolean(targets.ipv4 || targets.ipv6);
}

/** Managed sites as a whole; off only when explicitly killed. */
export function isSiteFeatureEnabled(): boolean {
  return (process.env.SITE_HOSTING_ENABLED ?? "").trim().toLowerCase() !== "false";
}
