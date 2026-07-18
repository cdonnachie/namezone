import { describe, expect, it } from "vitest";
import { isManagedRedirectZone, normalizeRedirectHost } from "./lookup";

describe("normalizeRedirectHost", () => {
  it("lowercases, strips port, and adds a trailing dot", () => {
    expect(normalizeRedirectHost("X.Craigd.RXD.Zone")).toBe("x.craigd.rxd.zone.");
    expect(normalizeRedirectHost("x.craigd.rxd.zone:443")).toBe("x.craigd.rxd.zone.");
    expect(normalizeRedirectHost("  x.craigd.rxd.zone.  ")).toBe("x.craigd.rxd.zone.");
  });
});

describe("isManagedRedirectZone", () => {
  it("accepts hosts within an enabled namespace zone", () => {
    expect(isManagedRedirectZone("x.craigd.rxd.zone.")).toBe(true);
    expect(isManagedRedirectZone("bob.avn.zone.")).toBe(true);
  });

  it("rejects hosts outside any managed zone", () => {
    expect(isManagedRedirectZone("x.com.")).toBe(false);
    expect(isManagedRedirectZone("evil.example.com.")).toBe(false);
    // A near-miss suffix must not match (rxd.zone.attacker.com).
    expect(isManagedRedirectZone("rxd.zone.attacker.com.")).toBe(false);
  });
});
