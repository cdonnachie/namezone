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

describe("TXT rdata quoting/chunking (DKIM keys)", () => {
  // A configured (non-dry-run) client so patchZone actually builds a PATCH body.
  const live = new PowerDnsClient({ baseUrl: "http://pdns.test", apiKey: "k", serverId: "localhost" });

  it("splits a >255-char TXT value into multiple quoted strings, and round-trips it back", async () => {
    const longKey = "v=DKIM1; k=rsa; p=" + "A".repeat(500); // 518 chars, must be chunked
    let patchedContent = "";

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      patchedContent = body.rrsets[0].records[0].content;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await live.upsertTxtRecords("rxd.zone", "sel._domainkey.craigd.rxd.zone.", [longKey], 300);

    // Each quoted string must be <= 255 content chars, and there must be > 1.
    const quoted = patchedContent.match(/"((?:[^"\\]|\\.)*)"/g) ?? [];
    expect(quoted.length).toBeGreaterThan(1);
    for (const q of quoted) expect(q.length - 2).toBeLessThanOrEqual(255);

    // Now feed that exact chunked content back through a GET and confirm
    // listAllRecords reassembles the original value.
    const zone = { rrsets: [{ name: "sel._domainkey.craigd.rxd.zone.", type: "TXT", ttl: 300, records: [{ content: patchedContent, disabled: false }] }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(zone), { status: 200 })));
    const records = await live.listAllRecords("rxd.zone");
    expect(records[0].content).toBe(longKey);

    vi.unstubAllGlobals();
  });
});
