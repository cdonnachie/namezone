import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PowerDnsClient, PowerDnsError } from "./client";

// Constructed with no config -> dry-run mode: patchZone short-circuits
// before any HTTP, but assertWritableNames runs first, so the guard is
// testable (and enforced) without a PowerDNS instance.
const client = new PowerDnsClient({});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {}); // silence dry-run logs
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("PowerDnsClient write guard (defense in depth)", () => {
  it("allows writes to an owner's own base name and children", async () => {
    await expect(client.upsertRecord("avn.zone", "bob.avn.zone.", "A", "203.0.113.10")).resolves.toBeUndefined();
    await expect(client.upsertRecord("avn.zone", "www.bob.avn.zone.", "A", "203.0.113.10")).resolves.toBeUndefined();
    await expect(client.deleteRecord("rxd.zone", "test.bob.rxd.zone.", "CNAME")).resolves.toBeUndefined();
    await expect(
      client.upsertTxtRecords("avn.zone", "_acme-challenge.bob.avn.zone.", ["token"], 60),
    ).resolves.toBeUndefined();
  });

  it("refuses the zone apex, for every write method", async () => {
    await expect(client.upsertRecord("avn.zone", "avn.zone.", "A", "203.0.113.10")).rejects.toThrow(PowerDnsError);
    await expect(client.deleteRecord("rxd.zone", "rxd.zone.", "A")).rejects.toThrow(/apex/);
    await expect(client.upsertTxtRecords("avn.zone", "avn.zone.", ["x"], 60)).rejects.toThrow(/apex/);
    // deleting a TXT rrset via the empty-values path must be guarded too
    await expect(client.upsertTxtRecords("avn.zone", "avn.zone.", [], 60)).rejects.toThrow(/apex/);
  });

  it.each(["ns1", "ns2", "www"])("refuses the reserved %s hostname and anything beneath it", async (host) => {
    await expect(client.upsertRecord("avn.zone", `${host}.avn.zone.`, "A", "203.0.113.10")).rejects.toThrow(
      /reserved/,
    );
    await expect(client.deleteRecord("rxd.zone", `${host}.rxd.zone.`, "A")).rejects.toThrow(/reserved/);
    await expect(client.upsertRecord("avn.zone", `sub.${host}.avn.zone.`, "A", "203.0.113.10")).rejects.toThrow(
      /reserved/,
    );
  });

  it("refuses names outside the zone being patched", async () => {
    await expect(client.upsertRecord("avn.zone", "bob.rxd.zone.", "A", "203.0.113.10")).rejects.toThrow(/outside/);
    await expect(client.upsertRecord("avn.zone", "evil.example.com.", "A", "203.0.113.10")).rejects.toThrow(
      /outside/,
    );
    // suffix trickery: "xavn.zone." is not within "avn.zone."
    await expect(client.upsertRecord("avn.zone", "xavn.zone.", "A", "203.0.113.10")).rejects.toThrow(/outside/);
  });

  it("is case-insensitive", async () => {
    await expect(client.upsertRecord("avn.zone", "WWW.AVN.ZONE.", "A", "203.0.113.10")).rejects.toThrow(/reserved/);
  });
});
