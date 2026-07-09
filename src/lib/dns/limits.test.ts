import { describe, expect, it } from "vitest";
import { checkAcmeTxtLimit, checkRecordLimits, type ExistingBasicRecordSummary } from "./limits";
import { MAX_ACME_TXT_RECORDS, MAX_HOSTNAMES_PER_NAME, MAX_RECORDS_PER_HOSTNAME } from "./constants";

function makeRecords(hostCount: number, perHost: 1 | 2 = 1): ExistingBasicRecordSummary[] {
  const records: ExistingBasicRecordSummary[] = [];
  for (let i = 0; i < hostCount; i++) {
    records.push({ relativeHost: `host${i}`, type: "A" });
    if (perHost === 2) records.push({ relativeHost: `host${i}`, type: "AAAA" });
  }
  return records;
}

describe("checkRecordLimits", () => {
  it("allows adding a record for a brand new hostname when under all limits", () => {
    const result = checkRecordLimits(makeRecords(1), { relativeHost: "new", type: "A" });
    expect(result.ok).toBe(true);
  });

  it(`rejects a new hostname once ${MAX_HOSTNAMES_PER_NAME} distinct hostnames exist`, () => {
    const existing = makeRecords(MAX_HOSTNAMES_PER_NAME);
    const result = checkRecordLimits(existing, { relativeHost: "one-more", type: "A" });
    expect(result.ok).toBe(false);
  });

  it("allows replacing an existing record's value even at the hostname limit", () => {
    const existing = makeRecords(MAX_HOSTNAMES_PER_NAME);
    const result = checkRecordLimits(existing, { relativeHost: "host0", type: "A" });
    expect(result.ok).toBe(true);
  });

  it("allows adding the second record type (AAAA) to a hostname that only has an A record", () => {
    const existing = makeRecords(1, 1); // host0 has only an A record
    const result = checkRecordLimits(existing, { relativeHost: "host0", type: "AAAA" });
    expect(result.ok).toBe(true);
  });

  it(`rejects a genuinely new type once a hostname has ${MAX_RECORDS_PER_HOSTNAME} records`, () => {
    // host0 already has both A and AAAA (the max); replacing either is fine,
    // but there is no third A/AAAA slot to add.
    const existing: ExistingBasicRecordSummary[] = [
      { relativeHost: "host0", type: "A" },
      { relativeHost: "host0", type: "AAAA" },
    ];
    const replace = checkRecordLimits(existing, { relativeHost: "host0", type: "A" });
    expect(replace.ok).toBe(true);
  });

  it("rejects a genuinely new hostname+type once total is effectively capped", () => {
    const existing = makeRecords(MAX_HOSTNAMES_PER_NAME, 2);
    const newHost = checkRecordLimits(existing, { relativeHost: "brand-new", type: "A" });
    expect(newHost.ok).toBe(false);
  });

  it("rejects adding a CNAME to a hostname that already has an A/AAAA record", () => {
    const existing: ExistingBasicRecordSummary[] = [{ relativeHost: "www", type: "A" }];
    const result = checkRecordLimits(existing, { relativeHost: "www", type: "CNAME" });
    expect(result.ok).toBe(false);
  });

  it("rejects adding an A/AAAA record to a hostname that already has a CNAME", () => {
    const existing: ExistingBasicRecordSummary[] = [{ relativeHost: "www", type: "CNAME" }];
    expect(checkRecordLimits(existing, { relativeHost: "www", type: "A" }).ok).toBe(false);
    expect(checkRecordLimits(existing, { relativeHost: "www", type: "AAAA" }).ok).toBe(false);
  });

  it("allows a brand new hostname to take a CNAME", () => {
    const result = checkRecordLimits([], { relativeHost: "www", type: "CNAME" });
    expect(result.ok).toBe(true);
  });

  it("allows replacing an existing CNAME's target", () => {
    const existing: ExistingBasicRecordSummary[] = [{ relativeHost: "www", type: "CNAME" }];
    const result = checkRecordLimits(existing, { relativeHost: "www", type: "CNAME" });
    expect(result.ok).toBe(true);
  });

  it("a CNAME hostname still counts toward the hostname limit", () => {
    const existing: ExistingBasicRecordSummary[] = Array.from({ length: MAX_HOSTNAMES_PER_NAME }, (_, i) => ({
      relativeHost: `host${i}`,
      type: "CNAME" as const,
    }));
    const result = checkRecordLimits(existing, { relativeHost: "one-more", type: "CNAME" });
    expect(result.ok).toBe(false);
  });

  it("allows MX and TXT to coexist with A/AAAA on the same hostname", () => {
    const existing: ExistingBasicRecordSummary[] = [
      { relativeHost: "@", type: "A" },
      { relativeHost: "@", type: "AAAA" },
    ];
    expect(checkRecordLimits(existing, { relativeHost: "@", type: "MX" }).ok).toBe(true);
    expect(checkRecordLimits(existing, { relativeHost: "@", type: "TXT" }).ok).toBe(true);
  });

  it("MX/TXT do not count against the one-A-one-AAAA address limit", () => {
    const existing: ExistingBasicRecordSummary[] = [
      { relativeHost: "@", type: "A" },
      { relativeHost: "@", type: "MX" },
      { relativeHost: "@", type: "TXT" },
    ];
    expect(checkRecordLimits(existing, { relativeHost: "@", type: "AAAA" }).ok).toBe(true);
  });

  it("CNAME exclusivity extends to MX/TXT, not just A/AAAA", () => {
    const withMx: ExistingBasicRecordSummary[] = [{ relativeHost: "mail", type: "MX" }];
    expect(checkRecordLimits(withMx, { relativeHost: "mail", type: "CNAME" }).ok).toBe(false);
    const withCname: ExistingBasicRecordSummary[] = [{ relativeHost: "mail", type: "CNAME" }];
    expect(checkRecordLimits(withCname, { relativeHost: "mail", type: "MX" }).ok).toBe(false);
    expect(checkRecordLimits(withCname, { relativeHost: "mail", type: "TXT" }).ok).toBe(false);
  });
});

describe("checkAcmeTxtLimit", () => {
  it("allows a new challenge when under the cap", () => {
    expect(checkAcmeTxtLimit(0).ok).toBe(true);
    expect(checkAcmeTxtLimit(MAX_ACME_TXT_RECORDS - 1).ok).toBe(true);
  });

  it(`rejects once ${MAX_ACME_TXT_RECORDS} active challenges exist`, () => {
    expect(checkAcmeTxtLimit(MAX_ACME_TXT_RECORDS).ok).toBe(false);
  });
});
