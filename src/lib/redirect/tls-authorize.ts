import { isManagedRedirectZone, normalizeRedirectHost } from "./lookup";

/**
 * Strict syntactic check for a domain passed to the on-demand-TLS authorize
 * endpoint, applied before any database work so junk SNIs never reach the DB.
 * Requires a bare ASCII hostname (lowercased): valid label lengths, at least
 * two labels, no scheme/path/port/query/whitespace/wildcard/underscore, and no
 * leading/trailing dot. Does NOT confirm the domain exists as a redirect.
 */
export function isValidAuthorizeDomain(raw: string): boolean {
  if (!raw) return false;
  const host = raw.trim().toLowerCase();
  if (host.length === 0 || host.length > 253) return false;
  if (/[^a-z0-9.-]/.test(host)) return false; // rejects ports, paths, schemes, wildcards, underscores, spaces
  if (host.startsWith(".") || host.endsWith(".")) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
  }
  return true;
}

/**
 * Syntactically valid AND within a managed zone (still no existence check).
 * Cheap gate a caller can use before the DB lookup; the endpoint itself relies
 * on findEnabledRedirectByFqdn, which also confirms the redirect is enabled.
 */
export function isAuthorizableDomain(raw: string): boolean {
  if (!isValidAuthorizeDomain(raw)) return false;
  return isManagedRedirectZone(normalizeRedirectHost(raw));
}
