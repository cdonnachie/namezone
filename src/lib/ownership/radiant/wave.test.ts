import { describe, expect, it, vi } from "vitest";
import type { RadiantElectrumClient } from "./electrum-client";
import { getWaveNamesByOwner, hashXFromRadiantAddress, resolveWaveName } from "./wave";

function fakeClient(handler: (method: string, params: unknown[]) => unknown) {
  return { call: vi.fn(async (method: string, params: unknown[] = []) => handler(method, params)) };
}

describe("hashXFromRadiantAddress", () => {
  it("matches the real hashX from wave_reverse_lookup.py for a known address", () => {
    // Real example captured from the reference tool against RXinDexer:
    //   wave_reverse_lookup.py 14XmXG3dSBWZUukGT3xzS9zxpiZ53vgx1i
    //   -> Owner hashX: e4bf68e0c8eb9018f15fa0
    expect(hashXFromRadiantAddress("14XmXG3dSBWZUukGT3xzS9zxpiZ53vgx1i")).toBe("e4bf68e0c8eb9018f15fa0");
  });

  it("returns undefined for an invalid address", () => {
    expect(hashXFromRadiantAddress("not-an-address")).toBeUndefined();
  });
});

describe("getWaveNamesByOwner", () => {
  const ADDRESS = "14XmXG3dSBWZUukGT3xzS9zxpiZ53vgx1i";
  const HASHX = "e4bf68e0c8eb9018f15fa0";

  it("returns [] without calling the client for an invalid address", async () => {
    const client = fakeClient(() => {
      throw new Error("should not be called");
    });
    const names = await getWaveNamesByOwner(client as unknown as RadiantElectrumClient, "bad-address");
    expect(names).toEqual([]);
    expect(client.call).not.toHaveBeenCalled();
  });

  it("returns [] when reverse_lookup has no hits", async () => {
    const client = fakeClient((method) => (method === "wave.reverse_lookup" ? [] : null));
    expect(await getWaveNamesByOwner(client as unknown as RadiantElectrumClient, ADDRESS)).toEqual([]);
  });

  it("uses the name already present on the reverse_lookup hit, without an extra glyph.get_token call", async () => {
    const client = fakeClient((method, params) => {
      if (method === "wave.reverse_lookup") {
        expect(params).toEqual([HASHX, 1000]);
        return [{ ref: "abc123_0", owner: HASHX, full_name: "bob.rxd" }];
      }
      throw new Error(`unexpected method ${method}`);
    });
    const names = await getWaveNamesByOwner(client as unknown as RadiantElectrumClient, ADDRESS);
    expect(names).toEqual(["bob.rxd"]);
  });

  it("falls back to glyph.get_token when the hit has no name, converting ref (txid_vout) to glyph_id (txid:vout)", async () => {
    const ref = "901a71184b14a92775df0ec35fce710bc6677829e7dedcd513c0e34f807b8ad4_0";
    const client = fakeClient((method, params) => {
      if (method === "wave.reverse_lookup") {
        return [{ ref, owner: HASHX, zone: { address: ADDRESS } }];
      }
      if (method === "glyph.get_token") {
        expect(params).toEqual(["901a71184b14a92775df0ec35fce710bc6677829e7dedcd513c0e34f807b8ad4:0"]);
        return { full_name: "craigd.rxd" };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const names = await getWaveNamesByOwner(client as unknown as RadiantElectrumClient, ADDRESS);
    expect(names).toEqual(["craigd.rxd"]);
  });

  it("defaults the domain to 'rxd' when only a bare name is found", async () => {
    const client = fakeClient((method) => {
      if (method === "wave.reverse_lookup") return [{ ref: "abc_0", name: "bob" }];
      throw new Error(`unexpected method ${method}`);
    });
    expect(await getWaveNamesByOwner(client as unknown as RadiantElectrumClient, ADDRESS)).toEqual(["bob.rxd"]);
  });

  it("finds a name nested under metadata.attrs (deep fallback)", async () => {
    const client = fakeClient((method) => {
      if (method === "wave.reverse_lookup") {
        return [{ ref: "abc_0", metadata: { attrs: { name: "deep", domain: "rxd" } } }];
      }
      throw new Error(`unexpected method ${method}`);
    });
    expect(await getWaveNamesByOwner(client as unknown as RadiantElectrumClient, ADDRESS)).toEqual(["deep.rxd"]);
  });

  it("skips a hit whose glyph.get_token call errors, rather than throwing", async () => {
    const client = fakeClient((method) => {
      if (method === "wave.reverse_lookup") return [{ ref: "abc_0" }];
      if (method === "glyph.get_token") throw new Error("not found");
      throw new Error(`unexpected method ${method}`);
    });
    expect(await getWaveNamesByOwner(client as unknown as RadiantElectrumClient, ADDRESS)).toEqual([]);
  });

  it("does not double-suffix a reverse_lookup hit whose `name` is already fully-qualified (real RXinDexer response)", async () => {
    // Real wave.reverse_lookup hit: `name` is already "spacex.rxd", but this
    // same hit's own `full_name` field is a known RXinDexer quirk that
    // double-suffixes to "spacex.rxd.rxd" - must not repeat that bug here.
    const client = fakeClient((method) => {
      if (method === "wave.reverse_lookup") {
        return [
          {
            ref: "3be37a91a72692ad4ccb4ebcd64c1c421dfd93c983b7b4c65ad54287ec09e9ef_0",
            zone: { address: "1GrwkQNJfjbEJjH25heszNZLpbZou8nfXG" },
            owner: "63e666eeae345b386ee939",
            name: "spacex.rxd",
            full_name: "spacex.rxd.rxd",
          },
        ];
      }
      throw new Error(`unexpected method ${method}`);
    });
    expect(await getWaveNamesByOwner(client as unknown as RadiantElectrumClient, ADDRESS)).toEqual(["spacex.rxd"]);
  });
});

describe("resolveWaveName", () => {
  it("strips the .rxd suffix before calling (raw RPC wants the bare label, confirmed live - the suffixed form errors with \"Invalid character: .\")", async () => {
    const client = fakeClient((method, params) => {
      expect(method).toBe("wave.resolve");
      expect(params).toEqual(["craigd"]);
      return {
        name: "craigd",
        ref: "901a71184b14a92775df0ec35fce710bc6677829e7dedcd513c0e34f807b8ad4_0",
        target: "14XmXG3dSBWZUukGT3xzS9zxpiZ53vgx1i",
        zone: { address: "14XmXG3dSBWZUukGT3xzS9zxpiZ53vgx1i" },
        owner: "e4bf68e0c8eb9018f15fa0",
        available: false,
        canonical: true,
        has_duplicates: false,
      };
    });
    const result = await resolveWaveName(client as unknown as RadiantElectrumClient, "craigd.rxd");
    expect(result).toMatchObject({
      target: "14XmXG3dSBWZUukGT3xzS9zxpiZ53vgx1i",
      owner: "e4bf68e0c8eb9018f15fa0",
      available: false,
    });
  });

  it("returns null for an unregistered name", async () => {
    const client = fakeClient(() => null);
    expect(await resolveWaveName(client as unknown as RadiantElectrumClient, "nobody.rxd")).toBeNull();
  });
});
