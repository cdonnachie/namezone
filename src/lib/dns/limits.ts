import { MAX_ACME_TXT_RECORDS, MAX_HOSTNAMES_PER_NAME } from "./constants";
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
 * Checks the cross-record rules for a hostname: CNAME exclusivity and the
 * max-distinct-hostnames cap. Per RFC a CNAME node may carry no other record
 * type, so a hostname holds either a single CNAME or any mix of
 * A/AAAA/MX/TXT. The per-type value caps (how many A, MX, TXT values at one
 * host) are enforced in the records route, which knows the actual values and
 * can distinguish a genuine add from a re-submit. Pass the full set of
 * non-ACME records that currently exist for the name.
 */
export function checkRecordLimits(
  existing: ExistingBasicRecordSummary[],
  target: { relativeHost: string; type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" },
): ValidationResult<true> {
  const sameHost = existing.filter((r) => r.relativeHost === target.relativeHost);

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

  return ok();
}

/** Checks the max-active-ACME-TXT-records-per-ANS-name limit for a brand new challenge value. */
export function checkAcmeTxtLimit(activeCount: number): ValidationResult<true> {
  if (activeCount >= MAX_ACME_TXT_RECORDS) {
    return fail(`Maximum of ${MAX_ACME_TXT_RECORDS} active ACME challenge records reached.`);
  }
  return ok();
}
