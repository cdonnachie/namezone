import type { DnsNamespace } from "@/lib/dns/constants";
import {
  authorizeFqdnForName,
  isValidIPv4,
  isValidIPv6,
  normalize,
  relativeHostToFqdn,
  validateFqdnLength,
  validateRelativeHost,
  type ValidationResult,
} from "@/lib/dns/validation";
import { MAX_REDIRECT_CHAIN_HOPS, redirectReservedHosts } from "./constants";

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}
function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

/** True for private IPv4 ranges we never allow as a redirect destination. */
function isBlockedIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. 169.254.169.254 cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/** Value of the first hextet, for IPv6 prefix range checks. */
function firstHextet(ip: string): number | null {
  if (ip.startsWith("::")) return 0;
  const first = ip.split(":")[0];
  if (!/^[0-9a-f]{1,4}$/.test(first)) return null;
  return parseInt(first, 16);
}

/** True for loopback/unspecified/ULA/link-local IPv6 (and IPv4-mapped equivalents). */
function isBlockedIPv6(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase();
  if (ip === "::1" || ip === "::") return true; // loopback / unspecified
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip); // ::ffff:a.b.c.d and ::a.b.c.d
  if (v4 && isValidIPv4(v4[1])) return isBlockedIPv4(v4[1]);
  // IPv4-mapped in hex form (WHATWG URL normalizes ::ffff:127.0.0.1 → ::ffff:7f00:1).
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return isBlockedIPv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  const first = firstHextet(ip);
  if (first === null) return false;
  if (first >= 0xfc00 && first <= 0xfdff) return true; // fc00::/7 unique-local
  if (first >= 0xfe80 && first <= 0xfebf) return true; // fe80::/10 link-local
  return false;
}

/**
 * Blocks destinations that resolve (textually) to localhost, loopback,
 * link-local, private, or cloud-metadata addresses. Note: the redirect
 * service never *fetches* the destination — it only emits a Location header —
 * so this is a policy guard on what we hand a user's browser, not SSRF
 * mitigation. Name-based hosts are allowed (we don't resolve DNS here).
 */
export function isBlockedDestinationHost(rawHost: string): boolean {
  let host = rawHost.trim().toLowerCase();
  if (host.length === 0) return true;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1); // IPv6 brackets
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isValidIPv4(host)) return isBlockedIPv4(host);
  if (isValidIPv6(host)) return isBlockedIPv6(host);
  return false;
}

/**
 * Validates and normalizes a redirect destination URL. Requires http/https,
 * rejects embedded credentials, control characters (header injection), and
 * private/local/metadata hosts. Returns the WHATWG-normalized form.
 */
export function validateDestinationUrl(raw: string): ValidationResult<string> {
  if (!raw || !raw.trim()) return fail("Destination URL is required.");
  const value = raw.trim();
  if (value.length > 2048) return fail("Destination URL is too long (max 2048 characters).");
  if (/[\x00-\x1F\x7F]/.test(value)) {
    return fail("Destination URL contains invalid control characters.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("Destination URL is not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fail("Destination URL must start with http:// or https://.");
  }
  if (url.username || url.password) {
    return fail("Destination URL must not contain embedded credentials (user:pass@host).");
  }
  if (!url.hostname) return fail("Destination URL must include a hostname.");
  if (isBlockedDestinationHost(url.hostname)) {
    return fail("Destination URL points to a private, local, or reserved address, which is not allowed.");
  }
  return ok(url.toString());
}

/**
 * Validates a redirect host label under a claimed name, reusing the DNS
 * validators so the same label/length/subtree rules apply. Returns both the
 * relative host ("x" or "@") and the absolute FQDN (trailing dot).
 */
export function validateRedirectHost(
  rawHost: string,
  name: string,
  ns: DnsNamespace,
): ValidationResult<{ relativeHost: string; fqdn: string }> {
  const hostResult = validateRelativeHost(rawHost);
  if (!hostResult.ok) return fail(hostResult.error);
  const relativeHost = hostResult.value;

  const reserved = redirectReservedHosts();
  if (relativeHost !== "@" && reserved.length > 0) {
    const firstLabel = relativeHost.split(".")[0];
    if (reserved.includes(relativeHost) || reserved.includes(firstLabel)) {
      return fail(`"${relativeHost}" is a reserved hostname and cannot be used for a redirect.`);
    }
  }

  const fqdn = relativeHostToFqdn(relativeHost, name, ns);
  const lengthResult = validateFqdnLength(fqdn);
  if (!lengthResult.ok) return fail(lengthResult.error);

  const authResult = authorizeFqdnForName(fqdn, name, ns);
  if (!authResult.ok) return fail(authResult.error);

  return ok({ relativeHost, fqdn: authResult.value });
}

/** Absolute-FQDN form (trailing dot, lowercased) of a destination URL's host, or undefined. */
function destinationToFqdn(destinationUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(destinationUrl);
  } catch {
    return undefined;
  }
  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) return undefined;
  return host.endsWith(".") ? host : `${host}.`;
}

/**
 * Detects a redirect loop: the destination pointing back at the source
 * hostname, or chaining through other managed redirects that eventually
 * return to it (or never terminate within MAX_REDIRECT_CHAIN_HOPS).
 *
 * `resolveRedirect(fqdn)` returns the destination URL of an *enabled* managed
 * redirect at that fqdn, or undefined if none — so an external destination
 * (not one of ours) immediately terminates the walk with no loop.
 */
export function wouldRedirectLoop(
  sourceFqdn: string,
  destinationUrl: string,
  resolveRedirect: (fqdn: string) => string | undefined,
): boolean {
  const source = normalize(sourceFqdn);
  const seen = new Set<string>([source.endsWith(".") ? source : `${source}.`]);
  let currentUrl = destinationUrl;

  for (let hop = 0; hop < MAX_REDIRECT_CHAIN_HOPS; hop++) {
    const fqdn = destinationToFqdn(currentUrl);
    if (!fqdn) return false; // unparseable/external → chain ends, no loop
    if (seen.has(fqdn)) return true; // back to source or an earlier hop
    seen.add(fqdn);
    const next = resolveRedirect(fqdn);
    if (!next) return false; // not a managed redirect → chain terminates
    currentUrl = next;
  }
  return true; // didn't terminate within budget → treat as a loop
}
