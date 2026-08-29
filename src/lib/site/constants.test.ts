import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isSelfHostingEnabled,
  isSiteFeatureEnabled,
  siteDnsRecords,
  siteServiceTargets,
} from "./constants";

const ENV_KEYS = [
  "SITE_SERVICE_IPV4",
  "SITE_SERVICE_IPV6",
  "RADIANT_SITE_SERVICE_IPV4",
  "RADIANT_SITE_SERVICE_IPV6",
  "SITE_HOSTING_ENABLED",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("siteServiceTargets", () => {
  it("is empty when nothing is configured", () => {
    expect(siteServiceTargets("radiant")).toEqual({ ipv4: undefined, ipv6: undefined });
  });

  it("reads the shared address", () => {
    process.env.SITE_SERVICE_IPV4 = "203.0.113.10";
    process.env.SITE_SERVICE_IPV6 = "2001:DB8::10";
    expect(siteServiceTargets("radiant")).toEqual({ ipv4: "203.0.113.10", ipv6: "2001:db8::10" });
  });

  it("prefers a per-namespace override", () => {
    process.env.SITE_SERVICE_IPV4 = "203.0.113.10";
    process.env.RADIANT_SITE_SERVICE_IPV4 = "198.51.100.5";
    expect(siteServiceTargets("radiant").ipv4).toBe("198.51.100.5");
    expect(siteServiceTargets("avian").ipv4).toBe("203.0.113.10");
  });

  it("throws on a configured-but-malformed address rather than writing junk DNS", () => {
    process.env.SITE_SERVICE_IPV4 = "not-an-ip";
    expect(() => siteServiceTargets("radiant")).toThrow(/not a valid IPv4/);
  });
});

describe("siteDnsRecords", () => {
  it("emits only the families that are configured", () => {
    process.env.SITE_SERVICE_IPV4 = "203.0.113.10";
    expect(siteDnsRecords("radiant")).toEqual([{ type: "A", value: "203.0.113.10" }]);
  });

  it("emits both when both are set", () => {
    process.env.SITE_SERVICE_IPV4 = "203.0.113.10";
    process.env.SITE_SERVICE_IPV6 = "2001:db8::10";
    expect(siteDnsRecords("radiant")).toHaveLength(2);
  });
});

describe("feature gating", () => {
  it("self-hosting needs somewhere to point the DNS", () => {
    expect(isSelfHostingEnabled("radiant")).toBe(false);
    process.env.SITE_SERVICE_IPV4 = "203.0.113.10";
    expect(isSelfHostingEnabled("radiant")).toBe(true);
  });

  it("self-hosting can be killed even when an address is set", () => {
    process.env.SITE_SERVICE_IPV4 = "203.0.113.10";
    process.env.SITE_HOSTING_ENABLED = "false";
    expect(isSelfHostingEnabled("radiant")).toBe(false);
  });

  it("external (CNAME) sites stay available with no service address", () => {
    // The point of the split: an operator can offer "deploy to your own
    // Vercel" without hosting anything themselves.
    expect(isSiteFeatureEnabled()).toBe(true);
    expect(isSelfHostingEnabled("radiant")).toBe(false);
  });

  it("the kill switch turns the whole feature off", () => {
    process.env.SITE_HOSTING_ENABLED = "false";
    expect(isSiteFeatureEnabled()).toBe(false);
  });
});
