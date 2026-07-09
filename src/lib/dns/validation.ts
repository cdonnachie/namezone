import {
  ACME_CHALLENGE_LABEL,
  ALLOWED_RECORD_TYPES,
  MAX_CNAME_CHAIN_HOPS,
  RESERVED_ROOT_HOSTS,
  reservedApexFqdn,
  reservedRootFqdns,
  zoneSuffixFor,
  type DnsNamespace,
  type DnsRecordType,
} from "./constants";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}
function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

/** Trim + lowercase. Does not validate structure. */
export function normalize(input: string): string {
  return input.trim().toLowerCase();
}

export function isAscii(input: string): boolean {
  return /^[\x00-\x7F]*$/.test(input);
}

/**
 * Validates a single DNS label per business rules:
 * - 1-63 characters
 * - only a-z, 0-9, hyphen
 * - cannot start or end with a hyphen
 * - cannot start with an underscore (blocks _acme-challenge etc.)
 * - cannot be a wildcard ("*")
 */
export function isValidDnsLabel(label: string): boolean {
  if (label.length < 1 || label.length > 63) return false;
  if (label === "*") return false;
  if (label.startsWith("_")) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label);
}

/**
 * True for the one narrow underscore exception: "_acme-challenge" itself, or
 * "_acme-challenge.<anything>". This is the only hostname shape allowed to
 * carry a TXT record (see validateTypeForHost) - everything else keeps the
 * blanket underscore-label ban.
 */
export function isAcmeChallengeHost(host: string): boolean {
  const h = normalize(host);
  return h === ACME_CHALLENGE_LABEL || h.startsWith(`${ACME_CHALLENGE_LABEL}.`);
}

/**
 * Derives the "_acme-challenge" relative host for a given target service
 * host, e.g. "@" -> "_acme-challenge", "www" -> "_acme-challenge.www".
 * `targetHost` must already be a validated relative host and must not
 * itself be an ACME challenge host.
 */
export function acmeChallengeHostFor(targetHost: string): string {
  return targetHost === "@" ? ACME_CHALLENGE_LABEL : `${ACME_CHALLENGE_LABEL}.${targetHost}`;
}

/**
 * Validates a source name like "bob.avn" (Avian) or "bob.rxd" (Radiant):
 * normalized, ASCII-only, a single DNS-safe label followed by the
 * namespace's TLD. Unicode/punycode is rejected for MVP.
 */
export function validateSourceName(raw: string, ns: Pick<DnsNamespace, "tld">): ValidationResult<string> {
  if (!raw) return fail("Name is required.");
  const name = normalize(raw);
  if (!isAscii(name)) return fail("Unicode names are not supported.");

  const suffix = `.${ns.tld}`;
  if (!name.endsWith(suffix)) return fail(`Name must end with "${suffix}".`);

  const label = name.slice(0, -suffix.length);
  if (!isValidDnsLabel(label)) {
    return fail("Name label is invalid (1-63 chars, a-z 0-9 hyphen, no leading/trailing hyphen).");
  }
  if (RESERVED_ROOT_HOSTS.includes(label)) {
    return fail(`"${label}" is reserved and cannot be managed through this service.`);
  }
  return ok(name);
}

/**
 * Converts a verified source name into its DNS zone base FQDN.
 * sourceNameToBaseFqdn("bob.avn", avianNamespace) -> "bob.avn.zone."
 */
export function sourceNameToBaseFqdn(name: string, ns: DnsNamespace): string {
  const parsed = validateSourceName(name, ns);
  if (!parsed.ok) throw new Error(parsed.error);
  return `${parsed.value}${zoneSuffixFor(ns)}.`;
}

/**
 * Validates a user-supplied relative hostname such as "@", "www", "test",
 * "api.test", or the narrow ACME exception "_acme-challenge"/
 * "_acme-challenge.www". Rejects empty labels, double dots,
 * underscore-prefixed labels (other than the ACME exception), and
 * wildcards. Namespace-independent - the same rules apply everywhere.
 *
 * `allowEmailLabels` (email-allowlisted names only - see ../email.ts)
 * additionally permits the two underscore shapes email requires: a leading
 * "_dmarc" label, and "_domainkey" as the second label (DKIM's
 * "<selector>._domainkey[.host]").
 */
export function validateRelativeHost(
  raw: string,
  options?: { allowEmailLabels?: boolean },
): ValidationResult<string> {
  if (raw === undefined || raw === null || raw === "") {
    return fail("Hostname is required.");
  }
  const host = normalize(raw);
  if (!isAscii(host)) return fail("Unicode hostnames are not supported.");
  if (host === "@") return ok(host);

  if (host.startsWith(".") || host.endsWith(".")) {
    return fail("Hostname cannot start or end with a dot.");
  }

  if (isAcmeChallengeHost(host)) {
    const rest = host === ACME_CHALLENGE_LABEL ? "" : host.slice(ACME_CHALLENGE_LABEL.length + 1);
    for (const label of rest.length > 0 ? rest.split(".") : []) {
      if (label.length === 0) return fail("Hostname cannot contain empty labels (double dots).");
      if (label.startsWith("_")) return fail(`Label "${label}" cannot start with an underscore.`);
      if (label === "*") return fail("Wildcard records are not allowed.");
      if (!isValidDnsLabel(label)) {
        return fail(`Label "${label}" is invalid (1-63 chars, a-z 0-9 hyphen, no leading/trailing hyphen).`);
      }
    }
    return ok(host);
  }

  const labels = host.split(".");
  for (const [index, label] of labels.entries()) {
    if (label.length === 0) return fail("Hostname cannot contain empty labels (double dots).");
    if (label.startsWith("_")) {
      const isEmailLabel =
        options?.allowEmailLabels &&
        ((index === 0 && label === "_dmarc") || (index === 1 && label === "_domainkey"));
      if (!isEmailLabel) {
        return fail(`Label "${label}" cannot start with an underscore.`);
      }
      continue; // known-good literal label; skip the general charset check
    }
    if (label === "*") return fail("Wildcard records are not allowed.");
    if (!isValidDnsLabel(label)) {
      return fail(`Label "${label}" is invalid (1-63 chars, a-z 0-9 hyphen, no leading/trailing hyphen).`);
    }
  }
  return ok(host);
}

/**
 * Builds the absolute FQDN for a relative host under a given (already
 * validated/owned) source name, within a namespace.
 * relativeHostToFqdn("@", "bob.avn", avianNamespace) -> "bob.avn.zone."
 * relativeHostToFqdn("test", "bob.avn", avianNamespace) -> "test.bob.avn.zone."
 * relativeHostToFqdn("api.test", "bob.avn", avianNamespace) -> "api.test.bob.avn.zone."
 */
export function relativeHostToFqdn(
  relativeHost: string,
  name: string,
  ns: DnsNamespace,
  options?: { allowEmailLabels?: boolean },
): string {
  const hostResult = validateRelativeHost(relativeHost, options);
  if (!hostResult.ok) throw new Error(hostResult.error);
  const base = sourceNameToBaseFqdn(name, ns);
  return hostResult.value === "@" ? base : `${hostResult.value}.${base}`;
}

/**
 * Inverse of relativeHostToFqdn: derives the relative host label from an
 * absolute FQDN known to fall within `name`'s namespace (the apex itself
 * becomes "@"). Does not re-validate namespace ownership - callers should
 * already have scoped `fqdn` to this source name's zone.
 */
export function fqdnToRelativeHost(fqdn: string, name: string, ns: DnsNamespace): string {
  const base = sourceNameToBaseFqdn(name, ns);
  const normalizedFqdn = normalize(fqdn);
  if (normalizedFqdn === base) return "@";
  const suffix = `.${base}`;
  if (normalizedFqdn.endsWith(suffix)) {
    return normalizedFqdn.slice(0, -suffix.length);
  }
  return normalizedFqdn;
}

/** Validates overall FQDN length constraints (<=253 chars, each label <=63). */
export function validateFqdnLength(fqdn: string): ValidationResult<string> {
  const withoutTrailingDot = fqdn.endsWith(".") ? fqdn.slice(0, -1) : fqdn;
  if (withoutTrailingDot.length === 0) return fail("Hostname cannot be empty.");
  if (withoutTrailingDot.length > 253) return fail("Full hostname exceeds 253 characters.");
  const labels = withoutTrailingDot.split(".");
  for (const label of labels) {
    if (label.length === 0) return fail("Hostname contains an empty label (double dots).");
    if (label.length > 63) return fail(`Label "${label}" exceeds 63 characters.`);
  }
  return ok(fqdn);
}

export function validateRecordType(raw: string): ValidationResult<DnsRecordType> {
  const type = raw?.trim().toUpperCase();
  if (!(ALLOWED_RECORD_TYPES as readonly string[]).includes(type)) {
    return fail(`Record type must be one of: ${ALLOWED_RECORD_TYPES.join(", ")}.`);
  }
  return ok(type as DnsRecordType);
}

/**
 * Enforces which record type is allowed at a given hostname shape: TXT is
 * only valid under the ACME challenge label; every other type is forbidden
 * there (and vice versa).
 */
export function validateTypeForHost(host: string, type: DnsRecordType): ValidationResult<DnsRecordType> {
  const isAcme = isAcmeChallengeHost(host);
  if (isAcme && type !== "TXT") {
    return fail(`"${ACME_CHALLENGE_LABEL}" hostnames may only have TXT records.`);
  }
  if (!isAcme && type === "TXT") {
    return fail(`TXT records are only allowed under "${ACME_CHALLENGE_LABEL}.*".`);
  }
  return ok(type);
}

/** Strict IPv4 dotted-quad validation. Rejects leading zeros and out-of-range octets. */
export function isValidIPv4(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value.trim());
  if (!match) return false;
  return match.slice(1, 5).every((octet) => {
    if (octet.length > 1 && octet.startsWith("0")) return false; // no leading zeros
    const n = Number(octet);
    return n >= 0 && n <= 255;
  });
}

/**
 * Strict, dependency-free IPv6 validation (supports "::" compression and
 * IPv4-mapped tails like "::ffff:192.168.1.1"). Pure JS so it can run in
 * both server and client code.
 */
export function isValidIPv6(value: string): boolean {
  const raw = value.trim();
  if (raw.length === 0 || raw.length > 45) return false;
  if (!/^[0-9a-fA-F:.]+$/.test(raw)) return false;

  let working = raw;

  // Handle an embedded IPv4 tail (e.g. "::ffff:192.168.1.1") by substituting
  // it with two placeholder hex groups of the same bit-width.
  const ipv4TailMatch = /(?:^|:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(working);
  if (ipv4TailMatch) {
    if (!isValidIPv4(ipv4TailMatch[1])) return false;
    working = working.slice(0, working.length - ipv4TailMatch[1].length) + "0:0";
  }
  if (working.includes(".")) return false; // any leftover dot means malformed mixed notation

  const doubleColonCount = (working.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return false;
  if (working.includes(":::")) return false;

  const isHexGroup = (g: string) => /^[0-9a-fA-F]{1,4}$/.test(g);

  if (doubleColonCount === 1) {
    const [left, right] = working.split("::");
    const leftGroups = left.length ? left.split(":") : [];
    const rightGroups = right.length ? right.split(":") : [];
    const allGroups = [...leftGroups, ...rightGroups];
    // "::" must compress at least one group, so at most 7 explicit groups.
    if (allGroups.length > 7) return false;
    return allGroups.every(isHexGroup);
  }

  const groups = working.split(":");
  if (groups.length !== 8) return false;
  return groups.every(isHexGroup);
}

export function validateRecordValue(type: "A" | "AAAA", raw: string): ValidationResult<string> {
  const value = raw?.trim();
  if (!value) return fail("Value is required.");
  if (type === "A") {
    return isValidIPv4(value) ? ok(value) : fail("Invalid IPv4 address.");
  }
  return isValidIPv6(value) ? ok(value.toLowerCase()) : fail("Invalid IPv6 address.");
}

/** Validates the free-text value of an ACME challenge TXT record. */
export function validateAcmeTxtValue(raw: string): ValidationResult<string> {
  const value = raw?.trim();
  if (!value) return fail("TXT value is required.");
  if (!isAscii(value)) return fail("TXT value must be ASCII.");
  if (value.length > 255) return fail("TXT value exceeds 255 characters.");
  if (value.includes('"') || value.includes("\\")) {
    return fail("TXT value cannot contain quote or backslash characters.");
  }
  return ok(value);
}

/**
 * Ensures a target FQDN falls within the namespace a source-name owner is
 * allowed to manage (their name's own zone, or any child of it), and is
 * never one of the globally reserved names (root zone apex, ns1/ns2).
 */
export function authorizeFqdnForName(fqdn: string, name: string, ns: DnsNamespace): ValidationResult<string> {
  const nameResult = validateSourceName(name, ns);
  if (!nameResult.ok) return fail(nameResult.error);

  const normalizedFqdn = normalize(fqdn);
  const target = normalizedFqdn.endsWith(".") ? normalizedFqdn : `${normalizedFqdn}.`;

  if (target === reservedApexFqdn(ns)) {
    return fail("The root zone itself cannot be modified.");
  }
  if (reservedRootFqdns(ns).includes(target)) {
    return fail("Reserved nameserver records cannot be modified.");
  }

  const base = sourceNameToBaseFqdn(nameResult.value, ns);
  if (target !== base && !target.endsWith(`.${base}`)) {
    return fail(`"${fqdn}" is outside the namespace you are authorized to manage.`);
  }
  return ok(target);
}

/**
 * Validates a CNAME record's target: must be a syntactically valid hostname
 * (not an IP, not localhost), cannot point at itself, and if it falls
 * within our own root zone it must stay inside the calling owner's own
 * namespace - it can never point at another owner's zone, the root zone
 * apex, or the reserved nameserver records.
 */
export function validateCnameTarget(
  raw: string,
  ownFqdn: string,
  name: string,
  ns: DnsNamespace,
): ValidationResult<string> {
  if (!raw || !raw.trim()) return fail("CNAME target is required.");
  const trimmed = normalize(raw.trim());
  if (!isAscii(trimmed)) return fail("Unicode hostnames are not supported.");

  const target = trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
  const withoutDot = target.slice(0, -1);

  if (withoutDot.length === 0) return fail("CNAME target cannot be empty.");
  if (withoutDot.length > 253) return fail("CNAME target exceeds 253 characters.");
  if (isValidIPv4(withoutDot) || isValidIPv6(withoutDot)) {
    return fail("CNAME target must be a hostname, not an IP address.");
  }
  if (withoutDot === "localhost") {
    return fail("CNAME target cannot be localhost.");
  }

  for (const label of withoutDot.split(".")) {
    if (label.length === 0) return fail("CNAME target contains an empty label (double dots).");
    if (label.length > 63) return fail(`CNAME target label "${label}" exceeds 63 characters.`);
    // Deliberately more permissive than isValidDnsLabel: this is an external
    // hostname we don't control, and real-world targets legitimately use
    // underscores (e.g. some CDN verification subdomains).
    if (!/^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/.test(label)) {
      return fail(`CNAME target label "${label}" is not a valid hostname label.`);
    }
  }

  if (target === normalize(ownFqdn)) {
    return fail("CNAME target cannot point to itself.");
  }

  if (target === reservedApexFqdn(ns) || target.endsWith(`.${ns.dnsZone}.`)) {
    const auth = authorizeFqdnForName(target, name, ns);
    if (!auth.ok) {
      return fail(`CNAME target invalid: ${auth.error}`);
    }
  }

  return ok(target);
}

/**
 * Detects whether pointing `fqdn` at `target` would create a CNAME loop,
 * walking the existing chain (via `resolveCname`, typically backed by the
 * local DB mirror) up to MAX_CNAME_CHAIN_HOPS hops. Returns true both for
 * genuine cycles and for chains that don't terminate within the hop budget.
 */
export function wouldCreateCnameLoop(
  fqdn: string,
  target: string,
  resolveCname: (name: string) => string | undefined,
): boolean {
  let current = normalize(target);
  const seen = new Set<string>([normalize(fqdn)]);

  for (let hop = 0; hop < MAX_CNAME_CHAIN_HOPS; hop++) {
    if (seen.has(current)) return true;
    seen.add(current);
    const next = resolveCname(current);
    if (!next) return false;
    current = normalize(next);
  }
  return true;
}
