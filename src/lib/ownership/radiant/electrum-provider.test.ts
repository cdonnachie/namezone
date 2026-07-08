import { describe, expect, it, vi } from "vitest";
import { ElectrumRadiantOwnershipLookup } from "./electrum-provider";

const ADDRESS = "14XmXG3dSBWZUukGT3xzS9zxpiZ53vgx1i";
const HASHX = "e4bf68e0c8eb9018f15fa0"; // real hashX for ADDRESS, confirmed against RXinDexer

function makeLookup(handler: (method: string, params: unknown[]) => unknown) {
  const lookup = new ElectrumRadiantOwnershipLookup({ host: "127.0.0.1", port: 50010 });
  // @ts-expect-error - overriding the private client with a fake for testing, same pattern as wave.test.ts's fakeClient.
  lookup.client = { call: vi.fn(async (method: string, params: unknown[] = []) => handler(method, params)) };
  return lookup;
}

describe("ElectrumRadiantOwnershipLookup", () => {
  it("throws when Electrum config is missing", () => {
    expect(() => new ElectrumRadiantOwnershipLookup({})).toThrow();
  });

  describe("getOwnerAddress", () => {
    it("returns the resolved target address (real wave.resolve response)", async () => {
      const lookup = makeLookup((method) => {
        expect(method).toBe("wave.resolve");
        return { target: ADDRESS, owner: HASHX, available: false };
      });
      expect(await lookup.getOwnerAddress("craigd.rxd")).toBe(ADDRESS);
    });

    it("returns null when unregistered", async () => {
      const lookup = makeLookup(() => null);
      expect(await lookup.getOwnerAddress("nobody.rxd")).toBeNull();
    });

    it("returns null when the name resolves but is marked available", async () => {
      const lookup = makeLookup(() => ({ available: true }));
      expect(await lookup.getOwnerAddress("nobody.rxd")).toBeNull();
    });

    it("throws (does not return null) when the RPC call fails", async () => {
      // Critical distinction: a transient failure must never look like a
      // confirmed "no owner" to the background ownership sweep.
      const lookup = makeLookup(() => {
        throw new Error("RXinDexer unreachable");
      });
      await expect(lookup.getOwnerAddress("craigd.rxd")).rejects.toThrow();
    });
  });

  describe("verifyOwner", () => {
    it("returns true when the address's hashX matches the resolved owner", async () => {
      const lookup = makeLookup(() => ({ owner: HASHX, available: false }));
      expect(await lookup.verifyOwner("craigd.rxd", ADDRESS)).toBe(true);
    });

    it("returns false for a different address", async () => {
      const lookup = makeLookup(() => ({ owner: HASHX, available: false }));
      expect(await lookup.verifyOwner("craigd.rxd", "1BoatSLRHtKNngkdXEeobR76b53LETtpyT")).toBe(false);
    });

    it("returns false when the name is available (unregistered)", async () => {
      const lookup = makeLookup(() => ({ owner: HASHX, available: true }));
      expect(await lookup.verifyOwner("craigd.rxd", ADDRESS)).toBe(false);
    });

    it("returns false (fails closed) if the RPC call errors", async () => {
      const lookup = makeLookup(() => {
        throw new Error("RXinDexer unreachable");
      });
      expect(await lookup.verifyOwner("craigd.rxd", ADDRESS)).toBe(false);
    });

    it("returns false for a malformed address without calling RXinDexer", async () => {
      const lookup = makeLookup(() => {
        throw new Error("should not be called");
      });
      expect(await lookup.verifyOwner("craigd.rxd", "not-an-address")).toBe(false);
    });
  });

  describe("isNameActive", () => {
    it("is true when the name resolves and is not available", async () => {
      const lookup = makeLookup(() => ({ owner: HASHX, available: false }));
      expect(await lookup.isNameActive("craigd.rxd")).toBe(true);
    });

    it("is false when unregistered", async () => {
      const lookup = makeLookup(() => null);
      expect(await lookup.isNameActive("nobody.rxd")).toBe(false);
    });

    it("fails closed (false) if the RPC call errors", async () => {
      const lookup = makeLookup(() => {
        throw new Error("RXinDexer unreachable");
      });
      expect(await lookup.isNameActive("craigd.rxd")).toBe(false);
    });
  });
});
