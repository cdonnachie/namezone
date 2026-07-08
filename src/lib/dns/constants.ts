/**
 * Minimal shape the DNS validation/PowerDNS layer needs from a namespace -
 * kept separate from the fuller NamespaceConfig (src/lib/namespaces/types.ts)
 * so this module doesn't depend on ownership/branding concerns.
 */
export interface DnsNamespace {
  /** e.g. "avn" */
  tld: string;
  /** e.g. "avn.zone" - must start with `${tld}.` */
  dnsZone: string;
}

/** Suffix appended to a full source name to get its DNS zone, e.g. ".zone". */
export function zoneSuffixFor(ns: DnsNamespace): string {
  return ns.dnsZone.slice(ns.tld.length);
}

/** Absolute FQDN (trailing dot) of the root zone apex, e.g. "avn.zone." */
export function reservedApexFqdn(ns: DnsNamespace): string {
  return `${ns.dnsZone}.`;
}

/**
 * Labels reserved for the operator, enforced at two independent points:
 * as hostnames directly under the root zone that no owner may write records
 * to or target (`reservedRootFqdns` via authorizeFqdnForName - e.g.
 * "www.rxd.zone" stays the operator's), AND as source-name labels that can
 * never be claimed/managed through the app (validateSourceName - e.g.
 * whoever registers "www.rxd" on-chain still can't control "www.rxd.zone"
 * here). Extend this list BEFORE the corresponding on-chain name gets
 * registered by someone else - removing a label later doesn't retroactively
 * take the zone back from a legitimate on-chain owner, but keeping it listed
 * does keep them locked out.
 */
export const RESERVED_ROOT_HOSTS = ["ns1", "ns2", "www"];

export function reservedRootFqdns(ns: DnsNamespace): string[] {
  return RESERVED_ROOT_HOSTS.map((h) => `${h}.${ns.dnsZone}.`);
}

/** Record types a user can create directly via the "Add Record" flow. */
export const BASIC_RECORD_TYPES = ["A", "AAAA", "CNAME"] as const;
export type BasicRecordType = (typeof BASIC_RECORD_TYPES)[number];

/**
 * All record types the app will ever write to PowerDNS. TXT is intentionally
 * excluded from BASIC_RECORD_TYPES - it is only ever valid under
 * "_acme-challenge.*" (see isAcmeChallengeHost in validation.ts) and is
 * created exclusively through the dedicated ACME challenge flow, never the
 * general Add Record dialog/endpoint.
 */
export const ALLOWED_RECORD_TYPES = [...BASIC_RECORD_TYPES, "TXT"] as const;
export type DnsRecordType = (typeof ALLOWED_RECORD_TYPES)[number];

/** The single reserved label that unlocks narrow, ACME-only TXT support. */
export const ACME_CHALLENGE_LABEL = "_acme-challenge";

export const FIXED_TTL = 300;

/** ACME challenge records use a short TTL so DNS-01 validation isn't delayed by caching. */
export const ACME_TXT_TTL = 60;
export const ACME_TXT_DEFAULT_EXPIRY_HOURS = 24;
export const ACME_TXT_MAX_EXPIRY_HOURS = 24 * 7;

export const MAX_HOSTNAMES_PER_NAME = 10;
export const MAX_RECORDS_PER_HOSTNAME = 2; // one A + one AAAA; a CNAME instead takes the whole slot
export const MAX_ACME_TXT_RECORDS = 10; // active (non-expired) ACME TXT records per source name

/** Bounded depth for CNAME-chain loop detection (see wouldCreateCnameLoop). */
export const MAX_CNAME_CHAIN_HOPS = 10;
