import { afterEach, describe, expect, it } from "vitest";
import type { DnsNamespace } from "@/lib/dns/constants";
import {
  isBlockedDestinationHost,
  validateDestinationUrl,
  validateRedirectHost,
  wouldRedirectLoop,
} from "./validation";

const radiant: DnsNamespace = { tld: "rxd", dnsZone: "rxd.zone" };

afterEach(() => {
  delete process.env.REDIRECT_RESERVED_HOSTS;
});

describe("validateRedirectHost", () => {
  it("accepts a simple host and returns relativeHost + absolute fqdn", () => {
    const result = validateRedirectHost("x", "craigd.rxd", radiant);
    expect(result).toEqual({ ok: true, value: { relativeHost: "x", fqdn: "x.craigd.rxd.zone." } });
  });

  it("normalizes case and whitespace", () => {
    const result = validateRedirectHost("  X  ", "craigd.rxd", radiant);
    expect(result.ok && result.value.fqdn).toBe("x.craigd.rxd.zone.");
  });

  it("accepts the name apex (@)", () => {
    const result = validateRedirectHost("@", "craigd.rxd", radiant);
    expect(result.ok && result.value.fqdn).toBe("craigd.rxd.zone.");
  });

  it("rejects an empty label (double dot)", () => {
    expect(validateRedirectHost("a..b", "craigd.rxd", radiant).ok).toBe(false);
  });

  it("rejects a label longer than 63 chars", () => {
    expect(validateRedirectHost("a".repeat(64), "craigd.rxd", radiant).ok).toBe(false);
  });

  it("rejects wildcards", () => {
    expect(validateRedirectHost("*", "craigd.rxd", radiant).ok).toBe(false);
  });

  it("rejects underscore labels", () => {
    expect(validateRedirectHost("_dmarc", "craigd.rxd", radiant).ok).toBe(false);
  });

  it("rejects a host escaping the owner's subtree via a full domain", () => {
    // A user typing a full foreign hostname must not be able to target it.
    const result = validateRedirectHost("evil.example.com", "craigd.rxd", radiant);
    // It's treated as a relative label chain under the name, so it stays inside
    // craigd.rxd.zone - never escapes. FQDN must remain within the owned zone.
    expect(result.ok && result.value.fqdn.endsWith(".craigd.rxd.zone.")).toBe(true);
  });

  it("honors a configured per-name reserved host", () => {
    process.env.REDIRECT_RESERVED_HOSTS = "blocked, other";
    expect(validateRedirectHost("blocked", "craigd.rxd", radiant).ok).toBe(false);
    expect(validateRedirectHost("blocked.sub", "craigd.rxd", radiant).ok).toBe(false);
    expect(validateRedirectHost("allowed", "craigd.rxd", radiant).ok).toBe(true);
  });
});

describe("validateDestinationUrl", () => {
  it("accepts and normalizes an https URL", () => {
    const result = validateDestinationUrl("https://x.com/craig_donnachie");
    expect(result).toEqual({ ok: true, value: "https://x.com/craig_donnachie" });
  });

  it("accepts http", () => {
    expect(validateDestinationUrl("http://example.com/").ok).toBe(true);
  });

  it("rejects a missing/empty URL", () => {
    expect(validateDestinationUrl("").ok).toBe(false);
    expect(validateDestinationUrl("   ").ok).toBe(false);
  });

  it("rejects non-http(s) schemes", () => {
    expect(validateDestinationUrl("ftp://example.com/").ok).toBe(false);
    expect(validateDestinationUrl("javascript:alert(1)").ok).toBe(false);
    expect(validateDestinationUrl("mailto:a@b.com").ok).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(validateDestinationUrl("https://").ok).toBe(false);
    expect(validateDestinationUrl("not a url").ok).toBe(false);
  });

  it("rejects embedded credentials", () => {
    expect(validateDestinationUrl("https://user:pass@example.com/").ok).toBe(false);
    expect(validateDestinationUrl("https://user@example.com/").ok).toBe(false);
  });

  it("rejects control characters / header injection", () => {
    expect(validateDestinationUrl("https://example.com/\r\nSet-Cookie: x=1").ok).toBe(false);
    expect(validateDestinationUrl("https://example.com/\x00").ok).toBe(false);
  });

  it("rejects private, loopback, link-local and metadata destinations", () => {
    for (const host of [
      "http://localhost/",
      "http://app.localhost/",
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://172.16.9.9/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/",
      "http://0.0.0.0/",
      "http://[::1]/",
      "http://[fe80::1]/",
      "http://[fc00::1]/",
      "http://[::ffff:127.0.0.1]/",
      // Trailing-dot forms must not slip past the exact-match / IP checks.
      "http://localhost./",
      "http://127.0.0.1./",
    ]) {
      expect(validateDestinationUrl(host).ok, host).toBe(false);
    }
  });

  it("allows public IPs and hostnames", () => {
    expect(validateDestinationUrl("https://93.184.216.34/").ok).toBe(true);
    expect(validateDestinationUrl("https://x.com/").ok).toBe(true);
  });
});

describe("isBlockedDestinationHost", () => {
  it("blocks empty host", () => {
    expect(isBlockedDestinationHost("")).toBe(true);
  });
  it("allows a normal public host", () => {
    expect(isBlockedDestinationHost("example.com")).toBe(false);
  });
});

describe("wouldRedirectLoop", () => {
  const source = "x.craigd.rxd.zone.";

  it("detects a direct self-redirect", () => {
    expect(wouldRedirectLoop(source, "https://x.craigd.rxd.zone/", () => undefined)).toBe(true);
  });

  it("detects a self-redirect regardless of trailing-dot/case", () => {
    expect(wouldRedirectLoop(source, "https://X.CRAIGD.RXD.ZONE./path", () => undefined)).toBe(true);
  });

  it("allows an external destination", () => {
    expect(wouldRedirectLoop(source, "https://x.com/craig", () => undefined)).toBe(false);
  });

  it("detects a two-hop loop back to the source", () => {
    const map: Record<string, string> = {
      "y.craigd.rxd.zone.": "https://x.craigd.rxd.zone/",
    };
    expect(
      wouldRedirectLoop(source, "https://y.craigd.rxd.zone/", (fqdn) => map[fqdn]),
    ).toBe(true);
  });

  it("allows a one-hop chain that terminates externally", () => {
    const map: Record<string, string> = {
      "y.craigd.rxd.zone.": "https://x.com/",
    };
    expect(
      wouldRedirectLoop(source, "https://y.craigd.rxd.zone/", (fqdn) => map[fqdn]),
    ).toBe(false);
  });

  it("allows a chain of exactly MAX_REDIRECT_CHAIN_HOPS managed hops that terminates externally", () => {
    // r1 -> r2 -> ... -> r10 -> https://external (10 managed hops, no loop).
    const map: Record<string, string> = {};
    for (let i = 1; i < 10; i++) map[`r${i}.craigd.rxd.zone.`] = `https://r${i + 1}.craigd.rxd.zone/`;
    map["r10.craigd.rxd.zone."] = "https://external.example/";
    expect(wouldRedirectLoop(source, "https://r1.craigd.rxd.zone/", (fqdn) => map[fqdn])).toBe(false);
  });

  it("rejects a chain that never terminates within the hop budget", () => {
    // Every managed hop points to the next, past the budget, never leaving the zone.
    const resolve = (fqdn: string): string => {
      const n = Number(/^r(\d+)\./.exec(fqdn)?.[1] ?? "0");
      return `https://r${n + 1}.craigd.rxd.zone/`;
    };
    expect(wouldRedirectLoop(source, "https://r1.craigd.rxd.zone/", resolve)).toBe(true);
  });
});
