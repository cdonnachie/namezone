import { describe, expect, it } from "vitest";
import { isAuthorizableDomain, isValidAuthorizeDomain } from "./tls-authorize";

describe("isValidAuthorizeDomain", () => {
  it("accepts plain hostnames", () => {
    expect(isValidAuthorizeDomain("x.craigd.rxd.zone")).toBe(true);
    expect(isValidAuthorizeDomain("X.CRAIGD.RXD.ZONE")).toBe(true);
    expect(isValidAuthorizeDomain("bob.avn.zone")).toBe(true);
  });

  it("rejects schemes, ports, paths, and whitespace", () => {
    expect(isValidAuthorizeDomain("https://x.craigd.rxd.zone")).toBe(false);
    expect(isValidAuthorizeDomain("x.craigd.rxd.zone:443")).toBe(false);
    expect(isValidAuthorizeDomain("x.craigd.rxd.zone/path")).toBe(false);
    expect(isValidAuthorizeDomain("x craigd.rxd.zone")).toBe(false);
  });

  it("rejects wildcards, underscores, leading/trailing dots, and empty labels", () => {
    expect(isValidAuthorizeDomain("*.craigd.rxd.zone")).toBe(false);
    expect(isValidAuthorizeDomain("_acme.craigd.rxd.zone")).toBe(false);
    expect(isValidAuthorizeDomain(".craigd.rxd.zone")).toBe(false);
    expect(isValidAuthorizeDomain("craigd.rxd.zone.")).toBe(false);
    expect(isValidAuthorizeDomain("a..b.rxd.zone")).toBe(false);
    expect(isValidAuthorizeDomain("single")).toBe(false);
  });

  it("rejects over-long labels and hostnames", () => {
    expect(isValidAuthorizeDomain(`${"a".repeat(64)}.rxd.zone`)).toBe(false);
    expect(isValidAuthorizeDomain(`${"a.".repeat(200)}rxd.zone`)).toBe(false);
  });
});

describe("isAuthorizableDomain", () => {
  it("accepts a valid domain inside a managed zone", () => {
    expect(isAuthorizableDomain("x.craigd.rxd.zone")).toBe(true);
  });

  it("rejects a valid domain outside any managed zone", () => {
    expect(isAuthorizableDomain("x.example.com")).toBe(false);
    expect(isAuthorizableDomain("rxd.zone.attacker.com")).toBe(false);
  });

  it("rejects a syntactically invalid domain even if it looks in-zone", () => {
    expect(isAuthorizableDomain("*.craigd.rxd.zone")).toBe(false);
  });
});
