import { describe, expect, it } from "vitest";
import type { DnsNamespace } from "./constants";
import {
  acmeChallengeHostFor,
  authorizeFqdnForName,
  fqdnToRelativeHost,
  isAcmeChallengeHost,
  isValidIPv4,
  isValidIPv6,
  relativeHostToFqdn,
  sourceNameToBaseFqdn,
  validateAcmeTxtValue,
  validateCnameTarget,
  validateFqdnLength,
  validateRecordType,
  validateRecordValue,
  validateRelativeHost,
  validateSourceName,
  validateTypeForHost,
  wouldCreateCnameLoop,
} from "./validation";

const avian: DnsNamespace = { tld: "avn", dnsZone: "avn.zone" };

describe("sourceNameToBaseFqdn", () => {
  it("maps bob.avn to bob.avn.zone.", () => {
    expect(sourceNameToBaseFqdn("bob.avn", avian)).toBe("bob.avn.zone.");
  });

  it("normalizes case", () => {
    expect(sourceNameToBaseFqdn("BOB.AVN", avian)).toBe("bob.avn.zone.");
  });

  it("throws for a name without the .avn TLD", () => {
    expect(() => sourceNameToBaseFqdn("bob.com", avian)).toThrow();
  });
});

describe("relativeHostToFqdn", () => {
  it("maps apex (@) to the base zone", () => {
    expect(relativeHostToFqdn("@", "bob.avn", avian)).toBe("bob.avn.zone.");
  });

  it("maps a single-label host", () => {
    expect(relativeHostToFqdn("test", "bob.avn", avian)).toBe("test.bob.avn.zone.");
  });

  it("maps a multi-label host", () => {
    expect(relativeHostToFqdn("api.test", "bob.avn", avian)).toBe("api.test.bob.avn.zone.");
  });

  it("normalizes case on both host and source name", () => {
    expect(relativeHostToFqdn("WWW", "BOB.AVN", avian)).toBe("www.bob.avn.zone.");
  });
});

describe("fqdnToRelativeHost", () => {
  it("maps the base zone back to apex (@)", () => {
    expect(fqdnToRelativeHost("bob.avn.zone.", "bob.avn", avian)).toBe("@");
  });

  it("maps a single-label child back to its host", () => {
    expect(fqdnToRelativeHost("test.bob.avn.zone.", "bob.avn", avian)).toBe("test");
  });

  it("maps a multi-label child back to its host", () => {
    expect(fqdnToRelativeHost("api.test.bob.avn.zone.", "bob.avn", avian)).toBe("api.test");
  });

  it("round-trips through relativeHostToFqdn", () => {
    for (const host of ["@", "www", "test", "api.test"]) {
      expect(fqdnToRelativeHost(relativeHostToFqdn(host, "bob.avn", avian), "bob.avn", avian)).toBe(host);
    }
  });
});

describe("validateSourceName", () => {
  it.each(["bob.avn", "alice.avn", "a1-b2.avn"])("accepts %s", (name) => {
    expect(validateSourceName(name, avian).ok).toBe(true);
  });

  it("rejects a name without the .avn suffix", () => {
    expect(validateSourceName("bob.com", avian).ok).toBe(false);
  });

  it("rejects unicode names", () => {
    expect(validateSourceName("bö.avn", avian).ok).toBe(false);
  });

  it("rejects a label with a leading hyphen", () => {
    expect(validateSourceName("-bob.avn", avian).ok).toBe(false);
  });

  it("rejects a label with an underscore", () => {
    expect(validateSourceName("_bob.avn", avian).ok).toBe(false);
  });

  it("rejects an empty label", () => {
    expect(validateSourceName(".avn", avian).ok).toBe(false);
  });

  it.each(["app.demo.avn", "www.bob.avn", "a.b.c.avn"])(
    "rejects sub-shaped on-chain name %s - only <single-label>.<tld> is ever manageable",
    (name) => {
      // Registering e.g. the APP.DEMO.AVN asset on-chain must never grant
      // control inside demo.avn's zone: app.demo.avn.zone belongs to
      // demo.avn's owner (as hostname "app"), not to whoever holds the
      // sub-shaped name.
      expect(validateSourceName(name, avian).ok).toBe(false);
    },
  );

  it("rejects the sub-shaped wave name app.demo.rxd for Radiant too", () => {
    expect(validateSourceName("app.demo.rxd", { tld: "rxd" }).ok).toBe(false);
  });

  it.each(["www.avn", "ns1.avn", "ns2.avn"])(
    "rejects the reserved name %s even if someone registers it on-chain",
    (name) => {
      const result = validateSourceName(name, avian);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("reserved");
    },
  );

  it("rejects www.rxd for Radiant too (reserved labels are namespace-independent)", () => {
    expect(validateSourceName("www.rxd", { tld: "rxd" }).ok).toBe(false);
  });

  it("still accepts www as a label deeper in a name's own zone (only the root-level label is reserved)", () => {
    // "www.bob.avn.zone" belongs to bob.avn's owner - unaffected.
    expect(validateRelativeHost("www").ok).toBe(true);
  });
});

describe("validateRelativeHost", () => {
  it.each(["@", "www", "test", "api", "api.test", "a-b.c-d"])("accepts %s", (host) => {
    expect(validateRelativeHost(host).ok).toBe(true);
  });

  it("rejects empty labels (double dots)", () => {
    expect(validateRelativeHost("api..test").ok).toBe(false);
  });

  it("rejects a leading dot", () => {
    expect(validateRelativeHost(".test").ok).toBe(false);
  });

  it("rejects a trailing dot", () => {
    expect(validateRelativeHost("test.").ok).toBe(false);
  });

  it("rejects underscore-prefixed labels other than the ACME exception", () => {
    expect(validateRelativeHost("_dmarc").ok).toBe(false);
    expect(validateRelativeHost("_domainkey").ok).toBe(false);
  });

  it("permits the email underscore shapes only with allowEmailLabels", () => {
    // _dmarc as a leading label, _domainkey as the SECOND label (DKIM).
    expect(validateRelativeHost("_dmarc", { allowEmailLabels: true }).ok).toBe(true);
    expect(validateRelativeHost("_dmarc.www", { allowEmailLabels: true }).ok).toBe(true);
    expect(validateRelativeHost("sel._domainkey", { allowEmailLabels: true }).ok).toBe(true);
    expect(validateRelativeHost("sel._domainkey.mail", { allowEmailLabels: true }).ok).toBe(true);
  });

  it("does not let allowEmailLabels open up arbitrary underscore labels", () => {
    // _domainkey only valid as the 2nd label; _dmarc only as the 1st.
    expect(validateRelativeHost("_domainkey", { allowEmailLabels: true }).ok).toBe(false);
    expect(validateRelativeHost("www._dmarc", { allowEmailLabels: true }).ok).toBe(false);
    expect(validateRelativeHost("_spf", { allowEmailLabels: true }).ok).toBe(false);
    expect(validateRelativeHost("_dmarc._extra", { allowEmailLabels: true }).ok).toBe(false);
  });

  it("rejects underscore-prefixed labels nested in a multi-label host", () => {
    expect(validateRelativeHost("foo._bar").ok).toBe(false);
  });

  it("accepts the narrow _acme-challenge exception (apex and nested)", () => {
    expect(validateRelativeHost("_acme-challenge").ok).toBe(true);
    expect(validateRelativeHost("_acme-challenge.www").ok).toBe(true);
    expect(validateRelativeHost("_acme-challenge.api.test").ok).toBe(true);
  });

  it("still rejects a second underscore label nested under _acme-challenge", () => {
    expect(validateRelativeHost("_acme-challenge._bar").ok).toBe(false);
  });

  it("still rejects wildcards nested under _acme-challenge", () => {
    expect(validateRelativeHost("_acme-challenge.*").ok).toBe(false);
  });

  it("rejects wildcard labels", () => {
    expect(validateRelativeHost("*").ok).toBe(false);
    expect(validateRelativeHost("*.test").ok).toBe(false);
  });

  it("rejects a label over 63 characters", () => {
    expect(validateRelativeHost("a".repeat(64)).ok).toBe(false);
  });

  it("accepts a label at exactly 63 characters", () => {
    expect(validateRelativeHost("a".repeat(63)).ok).toBe(true);
  });

  it("normalizes to lowercase", () => {
    const result = validateRelativeHost("WWW");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("www");
  });

  it("rejects empty input", () => {
    expect(validateRelativeHost("").ok).toBe(false);
  });
});

describe("validateFqdnLength", () => {
  it("accepts a normal fqdn", () => {
    expect(validateFqdnLength("test.bob.avn.zone.").ok).toBe(true);
  });

  it("rejects a name over 253 characters", () => {
    const longLabel = "a".repeat(63);
    const fqdn = `${longLabel}.${longLabel}.${longLabel}.${longLabel}.zone.`;
    expect(fqdn.length).toBeGreaterThan(253);
    expect(validateFqdnLength(fqdn).ok).toBe(false);
  });

  it("rejects a label over 63 characters even if total length is fine", () => {
    expect(validateFqdnLength(`${"a".repeat(64)}.zone.`).ok).toBe(false);
  });
});

describe("isValidIPv4", () => {
  it.each(["203.0.113.20", "0.0.0.0", "255.255.255.255", "1.2.3.4"])("accepts %s", (ip) => {
    expect(isValidIPv4(ip)).toBe(true);
  });

  it.each([
    "256.1.1.1",
    "1.1.1",
    "1.1.1.1.1",
    "01.1.1.1",
    "1.1.1.-1",
    "a.b.c.d",
    "",
    "999.999.999.999",
  ])("rejects %s", (ip) => {
    expect(isValidIPv4(ip)).toBe(false);
  });
});

describe("isValidIPv6", () => {
  it.each([
    "2001:db8::1",
    "::1",
    "::",
    "fe80:0000:0000:0000:0202:b3ff:fe1e:8329",
    "fe80:0:0:0:202:b3ff:fe1e:8329",
    "::ffff:192.168.1.1",
    "2001:db8::192.168.1.1",
  ])("accepts %s", (ip) => {
    expect(isValidIPv6(ip)).toBe(true);
  });

  it.each([
    "2001:db8:::1", // triple colon
    "1:2:3:4:5:6:7:8:9", // too many groups
    "1:2:3", // too few groups, no compression
    "gggg::1", // invalid hex
    "",
    "203.0.113.20", // plain IPv4
  ])("rejects %s", (ip) => {
    expect(isValidIPv6(ip)).toBe(false);
  });
});

describe("validateRecordType", () => {
  it.each(["A", "AAAA", "CNAME", "TXT", "MX", "a", "cname", "mx"])("accepts %s (format-level only)", (type) => {
    expect(validateRecordType(type).ok).toBe(true);
  });

  it.each(["NS", "SRV", "PTR", "CAA", "SOA", ""])("rejects %s", (type) => {
    expect(validateRecordType(type).ok).toBe(false);
  });
});

describe("isAcmeChallengeHost", () => {
  it.each(["_acme-challenge", "_acme-challenge.www", "_ACME-CHALLENGE.API"])("true for %s", (host) => {
    expect(isAcmeChallengeHost(host)).toBe(true);
  });

  it.each(["@", "www", "_dmarc", "acme-challenge"])("false for %s", (host) => {
    expect(isAcmeChallengeHost(host)).toBe(false);
  });
});

describe("acmeChallengeHostFor", () => {
  it('maps apex to "_acme-challenge"', () => {
    expect(acmeChallengeHostFor("@")).toBe("_acme-challenge");
  });

  it("prefixes a target host", () => {
    expect(acmeChallengeHostFor("www")).toBe("_acme-challenge.www");
  });
});

describe("validateTypeForHost", () => {
  it("allows TXT only under _acme-challenge", () => {
    expect(validateTypeForHost("_acme-challenge", "TXT").ok).toBe(true);
    expect(validateTypeForHost("_acme-challenge.www", "TXT").ok).toBe(true);
  });

  it("rejects TXT anywhere else", () => {
    expect(validateTypeForHost("www", "TXT").ok).toBe(false);
    expect(validateTypeForHost("@", "TXT").ok).toBe(false);
  });

  it("rejects A/AAAA/CNAME under _acme-challenge", () => {
    expect(validateTypeForHost("_acme-challenge", "A").ok).toBe(false);
    expect(validateTypeForHost("_acme-challenge.www", "CNAME").ok).toBe(false);
  });

  it("allows A/AAAA/CNAME elsewhere", () => {
    expect(validateTypeForHost("www", "A").ok).toBe(true);
    expect(validateTypeForHost("www", "CNAME").ok).toBe(true);
  });
});

describe("validateAcmeTxtValue", () => {
  it("accepts a typical ACME token", () => {
    expect(validateAcmeTxtValue("gfj9Xq...Rg85nM").ok).toBe(true);
  });

  it("rejects empty values", () => {
    expect(validateAcmeTxtValue("").ok).toBe(false);
  });

  it("rejects values over 255 characters", () => {
    expect(validateAcmeTxtValue("a".repeat(256)).ok).toBe(false);
  });

  it("rejects embedded quotes or backslashes", () => {
    expect(validateAcmeTxtValue('has"quote').ok).toBe(false);
    expect(validateAcmeTxtValue("has\\backslash").ok).toBe(false);
  });
});

describe("validateRecordValue", () => {
  it("validates an A record against IPv4 rules", () => {
    expect(validateRecordValue("A", "203.0.113.20").ok).toBe(true);
    expect(validateRecordValue("A", "::1").ok).toBe(false);
  });

  it("validates an AAAA record against IPv6 rules", () => {
    expect(validateRecordValue("AAAA", "2001:db8::1").ok).toBe(true);
    expect(validateRecordValue("AAAA", "203.0.113.20").ok).toBe(false);
  });
});

describe("authorizeFqdnForName", () => {
  it("allows the owner's own zone apex", () => {
    expect(authorizeFqdnForName("bob.avn.zone.", "bob.avn", avian).ok).toBe(true);
  });

  it("allows a single-level child", () => {
    expect(authorizeFqdnForName("test.bob.avn.zone.", "bob.avn", avian).ok).toBe(true);
  });

  it("allows a multi-level child", () => {
    expect(authorizeFqdnForName("api.test.bob.avn.zone.", "bob.avn", avian).ok).toBe(true);
  });

  it("rejects the root zone itself", () => {
    expect(authorizeFqdnForName("avn.zone.", "bob.avn", avian).ok).toBe(false);
  });

  it("rejects ns1/ns2 nameserver records", () => {
    expect(authorizeFqdnForName("ns1.avn.zone.", "bob.avn", avian).ok).toBe(false);
    expect(authorizeFqdnForName("ns2.avn.zone.", "bob.avn", avian).ok).toBe(false);
  });

  it("rejects the reserved www record - even for the on-chain owner of the www name itself", () => {
    expect(authorizeFqdnForName("www.avn.zone.", "www.avn", avian).ok).toBe(false);
    expect(authorizeFqdnForName("www.rxd.zone.", "www.rxd", { tld: "rxd", dnsZone: "rxd.zone" }).ok).toBe(false);
  });

  it("rejects another owner's zone", () => {
    expect(authorizeFqdnForName("alice.avn.zone.", "bob.avn", avian).ok).toBe(false);
  });

  it("rejects other direct children of the root zone", () => {
    expect(authorizeFqdnForName("www.avn.zone.", "bob.avn", avian).ok).toBe(false);
    expect(authorizeFqdnForName("api.avn.zone.", "bob.avn", avian).ok).toBe(false);
  });

  it("rejects a name that merely shares a suffix (not a true child)", () => {
    // "evilbob.avn.zone." ends in "bob.avn.zone." as a substring but not as a label suffix
    expect(authorizeFqdnForName("evilbob.avn.zone.", "bob.avn", avian).ok).toBe(false);
  });
});

describe("validateCnameTarget", () => {
  const ownFqdn = "www.bob.avn.zone.";

  it("accepts an external hosting target", () => {
    expect(validateCnameTarget("craigd.github.io.", ownFqdn, "bob.avn", avian).ok).toBe(true);
    expect(validateCnameTarget("cname.vercel-dns.com.", ownFqdn, "bob.avn", avian).ok).toBe(true);
  });

  it("accepts an underscore-labelled external target (DKIM-CNAME delegation)", () => {
    // Migadu-style DKIM CNAME target - a _domainkey label mid-hostname.
    expect(
      validateCnameTarget("key1.craigd.rxd.zone._domainkey.migadu.com.", "key1._domainkey.craigd.rxd.zone.", "bob.avn", avian).ok,
    ).toBe(true);
  });

  it("adds a trailing dot if missing", () => {
    const result = validateCnameTarget("craigd.github.io", ownFqdn, "bob.avn", avian);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("craigd.github.io.");
  });

  it("rejects an IPv4 target", () => {
    expect(validateCnameTarget("203.0.113.20", ownFqdn, "bob.avn", avian).ok).toBe(false);
  });

  it("rejects an IPv6 target", () => {
    expect(validateCnameTarget("2001:db8::1", ownFqdn, "bob.avn", avian).ok).toBe(false);
  });

  it("rejects localhost", () => {
    expect(validateCnameTarget("localhost", ownFqdn, "bob.avn", avian).ok).toBe(false);
    expect(validateCnameTarget("localhost.", ownFqdn, "bob.avn", avian).ok).toBe(false);
  });

  it("rejects a direct self-reference (loop)", () => {
    expect(validateCnameTarget(ownFqdn, ownFqdn, "bob.avn", avian).ok).toBe(false);
    expect(validateCnameTarget("www.bob.avn.zone", ownFqdn, "bob.avn", avian).ok).toBe(false);
  });

  it("allows pointing within the caller's own namespace", () => {
    expect(validateCnameTarget("bob.avn.zone.", ownFqdn, "bob.avn", avian).ok).toBe(true);
    expect(validateCnameTarget("other.bob.avn.zone.", ownFqdn, "bob.avn", avian).ok).toBe(true);
  });

  it("rejects pointing at another owner's namespace within avn.zone", () => {
    expect(validateCnameTarget("alice.avn.zone.", ownFqdn, "bob.avn", avian).ok).toBe(false);
  });

  it("rejects pointing at the root zone apex or reserved nameservers", () => {
    expect(validateCnameTarget("avn.zone.", ownFqdn, "bob.avn", avian).ok).toBe(false);
    expect(validateCnameTarget("ns1.avn.zone.", ownFqdn, "bob.avn", avian).ok).toBe(false);
  });

  it("rejects an empty target", () => {
    expect(validateCnameTarget("", ownFqdn, "bob.avn", avian).ok).toBe(false);
  });
});

describe("wouldCreateCnameLoop", () => {
  it("detects a direct self-loop", () => {
    expect(wouldCreateCnameLoop("www.bob.avn.zone.", "www.bob.avn.zone.", () => undefined)).toBe(true);
  });

  it("detects a two-hop loop (a -> b -> a)", () => {
    const chain = new Map([["b.bob.avn.zone.", "a.bob.avn.zone."]]);
    expect(
      wouldCreateCnameLoop("a.bob.avn.zone.", "b.bob.avn.zone.", (name) => chain.get(name)),
    ).toBe(true);
  });

  it("allows a chain that terminates outside avn.zone", () => {
    const chain = new Map([["b.bob.avn.zone.", "external.example.com."]]);
    expect(
      wouldCreateCnameLoop("a.bob.avn.zone.", "b.bob.avn.zone.", (name) => chain.get(name)),
    ).toBe(false);
  });

  it("allows a target with no existing CNAME chain", () => {
    expect(wouldCreateCnameLoop("a.bob.avn.zone.", "external.example.com.", () => undefined)).toBe(false);
  });

  it("treats an unterminated long chain as a loop", () => {
    const chain = new Map<string, string>();
    for (let i = 0; i < 20; i++) {
      chain.set(`n${i}.bob.avn.zone.`, `n${i + 1}.bob.avn.zone.`);
    }
    expect(
      wouldCreateCnameLoop("start.bob.avn.zone.", "n0.bob.avn.zone.", (name) => chain.get(name)),
    ).toBe(true);
  });
});
