import { afterEach, describe, expect, it } from "vitest";
import {
  emailTxtKindForHost,
  isDkimHost,
  isDmarcHost,
  isEmailEnabledName,
  validateEmailTxtValue,
  validateMxValue,
} from "./email";

const NS = { tld: "rxd", dnsZone: "rxd.zone" };

afterEach(() => {
  delete process.env.EMAIL_ALLOWED_NAMES;
});

describe("isEmailEnabledName", () => {
  it("is false when EMAIL_ALLOWED_NAMES is unset", () => {
    expect(isEmailEnabledName("craigd.rxd")).toBe(false);
  });

  it("matches names on the comma list, case/space-insensitively", () => {
    process.env.EMAIL_ALLOWED_NAMES = " craigd.rxd , art.rxd ";
    expect(isEmailEnabledName("craigd.rxd")).toBe(true);
    expect(isEmailEnabledName("CraigD.rxd")).toBe(true);
    expect(isEmailEnabledName("art.rxd")).toBe(true);
    expect(isEmailEnabledName("bob.rxd")).toBe(false);
  });
});

describe("email host classification", () => {
  it("recognizes _dmarc hosts", () => {
    expect(isDmarcHost("_dmarc")).toBe(true);
    expect(isDmarcHost("_dmarc.www")).toBe(true);
    expect(isDmarcHost("www")).toBe(false);
  });

  it("recognizes _domainkey (DKIM) hosts by the second label", () => {
    expect(isDkimHost("sel._domainkey")).toBe(true);
    expect(isDkimHost("google._domainkey.mail")).toBe(true);
    expect(isDkimHost("_domainkey")).toBe(false); // needs a selector before it
    expect(isDkimHost("www")).toBe(false);
  });

  it("maps host to TXT kind (SPF for plain hosts)", () => {
    expect(emailTxtKindForHost("@")).toBe("SPF");
    expect(emailTxtKindForHost("_dmarc")).toBe("DMARC");
    expect(emailTxtKindForHost("sel._domainkey")).toBe("DKIM");
  });
});

describe("validateEmailTxtValue", () => {
  it("accepts a valid SPF policy at a plain host", () => {
    expect(validateEmailTxtValue("@", "v=spf1 include:example.com -all").ok).toBe(true);
  });

  it("accepts provider verification tokens at a plain host", () => {
    // Onboarding TXT records from real providers - too many formats to allowlist.
    expect(validateEmailTxtValue("@", "hosted-email-verify=dgp5a3zt").ok).toBe(true); // Migadu
    expect(validateEmailTxtValue("@", "google-site-verification=abc123").ok).toBe(true);
    expect(validateEmailTxtValue("@", "MS=ms12345678").ok).toBe(true); // Microsoft
    expect(validateEmailTxtValue("@", "zoho-verification=zb123.zmverify.zoho.com").ok).toBe(true);
  });

  it("nudges DMARC/DKIM records placed at a plain host to their correct host", () => {
    expect(validateEmailTxtValue("@", "v=DMARC1; p=reject").ok).toBe(false);
    expect(validateEmailTxtValue("@", "v=DKIM1; k=rsa; p=MIGf...").ok).toBe(false);
  });

  it("requires v=DMARC1 under _dmarc", () => {
    expect(validateEmailTxtValue("_dmarc", "v=DMARC1; p=reject").ok).toBe(true);
    expect(validateEmailTxtValue("_dmarc", "v=spf1 -all").ok).toBe(false);
  });

  it("requires a p= key under _domainkey", () => {
    expect(validateEmailTxtValue("sel._domainkey", "v=DKIM1; k=rsa; p=MIGfMA0GCS...").ok).toBe(true);
    expect(validateEmailTxtValue("sel._domainkey", "v=DKIM1; k=rsa").ok).toBe(false);
  });

  it("rejects quotes/backslashes and over-long values", () => {
    expect(validateEmailTxtValue("@", 'v=spf1 "quoted" -all').ok).toBe(false);
    expect(validateEmailTxtValue("_dmarc", "v=DMARC1; " + "x".repeat(1100)).ok).toBe(false);
  });
});

describe("validateMxValue", () => {
  it("accepts priority + hostname and builds PowerDNS rdata", () => {
    const r = validateMxValue("10 mail.example.com", "craigd.rxd", NS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.priority).toBe(10);
      expect(r.value.content).toBe("10 mail.example.com.");
    }
  });

  it("rejects malformed input, IPs, localhost, and bad priority", () => {
    expect(validateMxValue("mail.example.com", "craigd.rxd", NS).ok).toBe(false); // no priority
    expect(validateMxValue("10 203.0.113.5", "craigd.rxd", NS).ok).toBe(false); // IP target
    expect(validateMxValue("10 localhost", "craigd.rxd", NS).ok).toBe(false);
    expect(validateMxValue("99999 mail.example.com", "craigd.rxd", NS).ok).toBe(false); // priority > 65535
    expect(validateMxValue("10 mailserver", "craigd.rxd", NS).ok).toBe(false); // not FQDN
  });

  it("rejects an MX target pointing into another owner's zone", () => {
    // Inside rxd.zone but not under craigd.rxd's own namespace.
    const r = validateMxValue("10 mail.alice.rxd.zone", "craigd.rxd", NS);
    expect(r.ok).toBe(false);
  });

  it("allows an MX target within the owner's own zone", () => {
    const r = validateMxValue("10 mail.craigd.rxd.zone", "craigd.rxd", NS);
    expect(r.ok).toBe(true);
  });
});
