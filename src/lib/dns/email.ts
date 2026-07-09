import { authorizeFqdnForName, isValidIPv4, isValidIPv6, normalize, isAscii, type ValidationResult } from "./validation";
import type { DnsNamespace } from "./constants";

/**
 * Email DNS records (MX + SPF/DKIM/DMARC TXT) are allowlist-gated: unlike
 * A/AAAA/CNAME, sending email under the shared parent zone puts the WHOLE
 * zone's reputation at stake (blocklists and mail providers largely score
 * the registrable domain), so this capability is operator-granted to known
 * names rather than permissionless. Configure via EMAIL_ALLOWED_NAMES, a
 * comma-separated list of full source names, e.g.:
 *   EMAIL_ALLOWED_NAMES="craigd.rxd,art.rxd,craigd.avn"
 *
 * Values are only ever shape-validated here - a name on the list still
 * can't touch anyone else's zone or the reserved names (the normal
 * authorization + PowerDNS write guard apply unchanged).
 */
export function isEmailEnabledName(name: string): boolean {
  const raw = process.env.EMAIL_ALLOWED_NAMES;
  if (!raw) return false;
  const normalized = normalize(name);
  return raw
    .split(",")
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}
function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

/** "_dmarc" or "_dmarc.<host>" - the only place a DMARC TXT may live. */
export function isDmarcHost(host: string): boolean {
  const h = normalize(host);
  return h === "_dmarc" || h.startsWith("_dmarc.");
}

/** "<selector>._domainkey" or "<selector>._domainkey.<host>" - DKIM key location. */
export function isDkimHost(host: string): boolean {
  const labels = normalize(host).split(".");
  return labels.length >= 2 && labels[1] === "_domainkey";
}

export type EmailTxtKind = "SPF" | "DKIM" | "DMARC";

/** Which email TXT shape a hostname implies (SPF for plain hosts). */
export function emailTxtKindForHost(host: string): EmailTxtKind {
  if (isDmarcHost(host)) return "DMARC";
  if (isDkimHost(host)) return "DKIM";
  return "SPF";
}

// DKIM p= values for 2048-bit RSA keys exceed a single 255-byte TXT string;
// the PowerDNS client splits long values into multiple quoted strings.
const MAX_EMAIL_TXT_LENGTH = 1024;

function validateTxtBasics(raw: string): ValidationResult<string> {
  const value = raw?.trim();
  if (!value) return fail("Value is required.");
  if (!isAscii(value)) return fail("TXT value must be ASCII.");
  if (value.length > MAX_EMAIL_TXT_LENGTH) {
    return fail(`TXT value exceeds ${MAX_EMAIL_TXT_LENGTH} characters.`);
  }
  if (value.includes('"') || value.includes("\\")) {
    return fail("TXT value cannot contain quote or backslash characters.");
  }
  return ok(value);
}

/**
 * Validates an email TXT value against the shape its hostname implies.
 * DMARC/DKIM hosts are shape-checked (they have exactly one correct form);
 * a plain host accepts SPF plus the provider verification tokens email
 * onboarding needs (Migadu `hosted-email-verify=`, Google
 * `google-site-verification=`, Microsoft `MS=`, etc.) - too many formats to
 * allowlist, and email names are operator-trusted via EMAIL_ALLOWED_NAMES,
 * so the plain host is permissive with only misplacement nudges. (Non-
 * allowlisted names still can't create TXT here at all - see the route.)
 */
export function validateEmailTxtValue(host: string, raw: string): ValidationResult<string> {
  const basics = validateTxtBasics(raw);
  if (!basics.ok) return basics;
  const value = basics.value;
  const kind = emailTxtKindForHost(host);

  if (kind === "DMARC") {
    if (!/^v=DMARC1\s*;/i.test(value)) {
      return fail('DMARC records must start with "v=DMARC1;".');
    }
    return ok(value);
  }
  if (kind === "DKIM") {
    if (!/(^|;)\s*p=/.test(value)) {
      return fail('DKIM records must contain a public key ("p=...").');
    }
    return ok(value);
  }
  // Plain host: SPF, provider verification tokens, and other email-setup
  // TXT are all allowed. Nudge the two records that belong elsewhere.
  if (/^v=DMARC1/i.test(value)) {
    return fail('DMARC records must be placed under "_dmarc".');
  }
  if (/^v=DKIM1/i.test(value)) {
    return fail('DKIM records must be placed under "<selector>._domainkey".');
  }
  return ok(value);
}

export interface ParsedMxValue {
  priority: number;
  target: string;
  /** PowerDNS rdata: "<priority> <target>." */
  content: string;
}

/**
 * Validates an MX value of the form "<priority> <mail-host>", e.g.
 * "10 mail.example.com". Same target rules as CNAME: a real hostname (not
 * an IP, not localhost), and if it points inside our own root zone it must
 * stay within the owner's namespace.
 */
export function validateMxValue(
  raw: string,
  name: string,
  ns: DnsNamespace,
): ValidationResult<ParsedMxValue> {
  const trimmed = raw?.trim().toLowerCase();
  if (!trimmed) return fail("Value is required.");

  const match = /^(\d{1,5})\s+(\S+)$/.exec(trimmed);
  if (!match) {
    return fail('MX value must be "<priority> <mail-host>", e.g. "10 mail.example.com".');
  }
  const priority = Number(match[1]);
  if (priority > 65535) return fail("MX priority must be between 0 and 65535.");

  const target = match[2].endsWith(".") ? match[2].slice(0, -1) : match[2];
  if (target.length === 0 || target.length > 253) return fail("MX target hostname is invalid.");
  if (isValidIPv4(target) || isValidIPv6(target)) {
    return fail("MX target must be a hostname, not an IP address.");
  }
  if (target === "localhost") return fail("MX target cannot be localhost.");
  if (!target.includes(".")) return fail("MX target must be a fully-qualified hostname.");
  for (const label of target.split(".")) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return fail(`MX target label "${label}" is not a valid hostname label.`);
    }
  }

  // Inside our own root zone? Must stay within the caller's namespace
  // (mirrors validateCnameTarget's containment rule).
  if (target === ns.dnsZone || target.endsWith(`.${ns.dnsZone}`)) {
    const auth = authorizeFqdnForName(`${target}.`, name, ns);
    if (!auth.ok) return fail(`MX target invalid: ${auth.error}`);
  }

  return ok({ priority, target, content: `${priority} ${target}.` });
}
