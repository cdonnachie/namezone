import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isPermanentRedirect,
  isRedirectFeatureEnabled,
  isRedirectStatusCode,
  redirectCacheControl,
  redirectDnsRecords,
  redirectServiceTargets,
} from "./constants";

const ENV_KEYS = [
  "REDIRECT_ENABLED",
  "REDIRECT_SERVICE_IPV4",
  "REDIRECT_SERVICE_IPV6",
  "RADIANT_REDIRECT_SERVICE_IPV4",
  "RADIANT_REDIRECT_SERVICE_IPV6",
];

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});
afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("status code allowlist", () => {
  it("accepts only 301/302/307/308", () => {
    expect(isRedirectStatusCode(301)).toBe(true);
    expect(isRedirectStatusCode(302)).toBe(true);
    expect(isRedirectStatusCode(307)).toBe(true);
    expect(isRedirectStatusCode(308)).toBe(true);
    expect(isRedirectStatusCode(300)).toBe(false);
    expect(isRedirectStatusCode(200)).toBe(false);
    expect(isRedirectStatusCode(303)).toBe(false);
  });

  it("classifies permanent redirects", () => {
    expect(isPermanentRedirect(301)).toBe(true);
    expect(isPermanentRedirect(308)).toBe(true);
    expect(isPermanentRedirect(302)).toBe(false);
    expect(isPermanentRedirect(307)).toBe(false);
  });

  it("uses no-store for temporary and short cache for permanent", () => {
    expect(redirectCacheControl(302)).toBe("no-store");
    expect(redirectCacheControl(307)).toBe("no-store");
    expect(redirectCacheControl(301)).toContain("max-age");
    expect(redirectCacheControl(308)).toContain("max-age");
  });
});

describe("redirect service targets", () => {
  it("reads the shared IPv4/IPv6", () => {
    process.env.REDIRECT_SERVICE_IPV4 = "203.0.113.10";
    process.env.REDIRECT_SERVICE_IPV6 = "2001:db8::10";
    expect(redirectServiceTargets("radiant")).toEqual({ ipv4: "203.0.113.10", ipv6: "2001:db8::10" });
    expect(redirectDnsRecords("radiant")).toEqual([
      { type: "A", value: "203.0.113.10" },
      { type: "AAAA", value: "2001:db8::10" },
    ]);
  });

  it("prefers the per-namespace override", () => {
    process.env.REDIRECT_SERVICE_IPV4 = "203.0.113.10";
    process.env.RADIANT_REDIRECT_SERVICE_IPV4 = "198.51.100.5";
    expect(redirectServiceTargets("radiant").ipv4).toBe("198.51.100.5");
  });

  it("throws on a malformed configured IP", () => {
    process.env.REDIRECT_SERVICE_IPV4 = "not-an-ip";
    expect(() => redirectServiceTargets("radiant")).toThrow();
  });

  it("returns undefined when unset", () => {
    expect(redirectServiceTargets("radiant")).toEqual({ ipv4: undefined, ipv6: undefined });
  });
});

describe("isRedirectFeatureEnabled", () => {
  it("is off when no target is configured", () => {
    expect(isRedirectFeatureEnabled("radiant")).toBe(false);
  });

  it("is on when a target is configured", () => {
    process.env.REDIRECT_SERVICE_IPV4 = "203.0.113.10";
    expect(isRedirectFeatureEnabled("radiant")).toBe(true);
  });

  it("respects the REDIRECT_ENABLED=false kill switch", () => {
    process.env.REDIRECT_SERVICE_IPV4 = "203.0.113.10";
    process.env.REDIRECT_ENABLED = "false";
    expect(isRedirectFeatureEnabled("radiant")).toBe(false);
  });
});
