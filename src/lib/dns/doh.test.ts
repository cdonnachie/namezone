import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupPublicDns, normalizeDohAnswer } from "./doh";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeDohAnswer", () => {
  it("passes A records through untouched", () => {
    expect(normalizeDohAnswer("A", "185.199.108.153")).toBe("185.199.108.153");
  });

  it("lowercases AAAA answers", () => {
    expect(normalizeDohAnswer("AAAA", "2606:50C0:8000::153")).toBe("2606:50c0:8000::153");
  });

  it("lowercases CNAME answers and ensures a trailing dot", () => {
    expect(normalizeDohAnswer("CNAME", "Cdonnachie.GitHub.io")).toBe("cdonnachie.github.io.");
    expect(normalizeDohAnswer("CNAME", "cdonnachie.github.io.")).toBe("cdonnachie.github.io.");
  });

  it("normalizes MX spacing, case and trailing dot to match stored content", () => {
    expect(normalizeDohAnswer("MX", "10  ASPMX1.Migadu.com")).toBe("10 aspmx1.migadu.com.");
    expect(normalizeDohAnswer("MX", "10 aspmx1.migadu.com.")).toBe("10 aspmx1.migadu.com.");
  });

  it("strips TXT quoting and rejoins chunked strings", () => {
    expect(normalizeDohAnswer("TXT", '"v=spf1 include:spf.migadu.com -all"')).toBe(
      "v=spf1 include:spf.migadu.com -all",
    );
    // >255-byte values come back as multiple quoted chunks
    expect(normalizeDohAnswer("TXT", '"v=DKIM1; k=rsa; p=AAA" "BBB"')).toBe("v=DKIM1; k=rsa; p=AAABBB");
    expect(normalizeDohAnswer("TXT", '"abc""def"')).toBe("abcdef");
  });

  it("leaves an unquoted TXT answer as-is (some resolvers omit quotes)", () => {
    expect(normalizeDohAnswer("TXT", "v=spf1 -all")).toBe("v=spf1 -all");
  });
});

describe("lookupPublicDns", () => {
  it("returns only answers of the requested type (CNAME chains excluded)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            Status: 0,
            Answer: [
              { name: "www.bob.rxd.zone.", type: 5, data: "bob.github.io." },
              { name: "bob.github.io.", type: 1, data: "185.199.108.153" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const result = await lookupPublicDns("www.bob.rxd.zone.", "A");
    expect(result.answers).toEqual(["185.199.108.153"]);
    expect(result.resolver).toBe("cloudflare");
  });

  it("returns an empty answer list for NXDOMAIN (no Answer section)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ Status: 3 }), { status: 200 })),
    );
    const result = await lookupPublicDns("missing.bob.rxd.zone.", "A");
    expect(result.answers).toEqual([]);
  });

  it("falls back to Google when Cloudflare fails", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("cloudflare")) return new Response(null, { status: 500 });
      return new Response(
        JSON.stringify({ Status: 0, Answer: [{ name: "x.", type: 1, data: "203.0.113.1" }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await lookupPublicDns("bob.rxd.zone.", "A");
    expect(result.resolver).toBe("google");
    expect(result.answers).toEqual(["203.0.113.1"]);
  });
});
