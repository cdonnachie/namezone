import { MAX_ACME_TXT_RECORDS, MAX_HOSTNAMES_PER_NAME, MAX_RECORDS_PER_HOSTNAME } from "./constants";
import type { ValidationResult } from "./validation";

export interface ExistingBasicRecordSummary {
  relativeHost: string;
  type: "A" | "AAAA" | "CNAME" | "MX" | "TXT";
}

function ok(): ValidationResult<true> {
  return { ok: true, value: true };
}
function fail(error: string): ValidationResult<true> {
  return { ok: false, error };
}

/**
 * Checks the per-name limits for adding/replacing a single record: max
 * distinct hostnames, max A/AAAA per hostname, and CNAME exclusivity - per
 * RFC, a CNAME node may carry no other record type, so a hostname has
 * either a single CNAME or any mix of A/AAAA/MX/TXT (MX and email TXT are
 * one-per-hostname by replace semantics). Pass the full set of non-ACME
 * records that currently exist for the name.
 */
export function checkRecordLimits(
  existing: ExistingBasicRecordSummary[],
  target: { relativeHost: string; type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" },
): ValidationResult<true> {
  const sameHost = existing.filter((r) => r.relativeHost === target.relativeHost);
  const isReplace = sameHost.some((r) => r.type === target.type);

  if (isReplace) {
    // Replacing an existing record's value never changes hostname/type-mix counts.
    return ok();
  }

  const hasCname = sameHost.some((r) => r.type === "CNAME");
  const hasOther = sameHost.some((r) => r.type !== "CNAME");

  if (target.type === "CNAME" && hasOther) {
    return fail("This hostname already has other records; remove them before adding a CNAME.");
  }
  if (target.type !== "CNAME" && hasCname) {
    return fail("This hostname already has a CNAME record; remove it before adding other records.");
  }

  const distinctHosts = new Set(existing.map((r) => r.relativeHost));
  const isNewHost = !distinctHosts.has(target.relativeHost);
  if (isNewHost && distinctHosts.size >= MAX_HOSTNAMES_PER_NAME) {
    return fail(`Maximum of ${MAX_HOSTNAMES_PER_NAME} hostnames per name reached.`);
  }

  const sameHostAddresses = sameHost.filter((r) => r.type === "A" || r.type === "AAAA");
  if ((target.type === "A" || target.type === "AAAA") && sameHostAddresses.length >= MAX_RECORDS_PER_HOSTNAME) {
    return fail(`Maximum of ${MAX_RECORDS_PER_HOSTNAME} address records per hostname reached (one A and one AAAA).`);
  }

  return ok();
}

/** Checks the max-active-ACME-TXT-records-per-ANS-name limit for a brand new challenge value. */
export function checkAcmeTxtLimit(activeCount: number): ValidationResult<true> {
  if (activeCount >= MAX_ACME_TXT_RECORDS) {
    return fail(`Maximum of ${MAX_ACME_TXT_RECORDS} active ACME challenge records reached.`);
  }
  return ok();
}
