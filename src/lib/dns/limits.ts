import { MAX_ACME_TXT_RECORDS, MAX_HOSTNAMES_PER_NAME, MAX_RECORDS_PER_HOSTNAME } from "./constants";
import type { ValidationResult } from "./validation";

export interface ExistingBasicRecordSummary {
  relativeHost: string;
  type: "A" | "AAAA" | "CNAME";
}

function ok(): ValidationResult<true> {
  return { ok: true, value: true };
}
function fail(error: string): ValidationResult<true> {
  return { ok: false, error };
}

/**
 * Checks the per-ANS-name limits for adding/replacing a single A/AAAA/CNAME
 * record: max distinct hostnames, max records per hostname, and the
 * A/AAAA <-> CNAME mutual exclusivity rule (a hostname has either up to one
 * A and one AAAA, or a single CNAME, never both kinds). Pass the full set
 * of basic (non-ACME) records that currently exist for the ANS name.
 */
export function checkRecordLimits(
  existing: ExistingBasicRecordSummary[],
  target: { relativeHost: string; type: "A" | "AAAA" | "CNAME" },
): ValidationResult<true> {
  const sameHost = existing.filter((r) => r.relativeHost === target.relativeHost);
  const isReplace = sameHost.some((r) => r.type === target.type);

  if (isReplace) {
    // Replacing an existing record's value never changes hostname/type-mix counts.
    return ok();
  }

  const hasCname = sameHost.some((r) => r.type === "CNAME");
  const hasAddress = sameHost.some((r) => r.type === "A" || r.type === "AAAA");

  if (target.type === "CNAME" && hasAddress) {
    return fail("This hostname already has an A/AAAA record; remove it before adding a CNAME.");
  }
  if (target.type !== "CNAME" && hasCname) {
    return fail("This hostname already has a CNAME record; remove it before adding an A/AAAA record.");
  }

  const distinctHosts = new Set(existing.map((r) => r.relativeHost));
  const isNewHost = !distinctHosts.has(target.relativeHost);
  if (isNewHost && distinctHosts.size >= MAX_HOSTNAMES_PER_NAME) {
    return fail(`Maximum of ${MAX_HOSTNAMES_PER_NAME} hostnames per ANS name reached.`);
  }

  if (target.type !== "CNAME" && sameHost.length >= MAX_RECORDS_PER_HOSTNAME) {
    return fail(`Maximum of ${MAX_RECORDS_PER_HOSTNAME} records per hostname reached (one A and one AAAA).`);
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
