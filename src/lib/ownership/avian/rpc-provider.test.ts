import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AviandRpcAnsOwnershipProvider } from "./rpc-provider";

function mockRpcResponse(result: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ result, error: null }),
  } as Response;
}

function mockRpcError(message: string, code = -1) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ result: null, error: { message, code } }),
  } as Response;
}

describe("AviandRpcAnsOwnershipProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeProvider() {
    return new AviandRpcAnsOwnershipProvider({
      url: "http://127.0.0.1:7896",
      user: "test",
      password: "test",
    });
  }

  it("throws when RPC config is missing", () => {
    expect(() => new AviandRpcAnsOwnershipProvider({})).toThrow();
  });

  it("getNamesByOwner returns only owner-token-backed, DNS-safe ANS names", async () => {
    fetchMock.mockResolvedValueOnce(
      mockRpcResponse({
        "CRAIGD.AVN": 1,
        "CRAIGD.AVN!": 1,
        "SOME_OTHER_ASSET": 5, // unrelated asset, no owner-token suffix
        "SOME_OTHER_ASSET!": 1, // owner token but not under the .AVN namespace
        "_BAD.AVN!": 1, // owner token but not a DNS-safe label once lowercased
      }),
    );

    const provider = makeProvider();
    const names = await provider.getNamesByOwner("RChTMyBr6eqFbS1W5WQoJmeCyuEDDpnXuN");

    expect(names).toEqual(["craigd.avn"]);
  });

  it("getNamesByOwner returns an empty list if the RPC call fails", async () => {
    fetchMock.mockResolvedValueOnce(mockRpcError("address not found"));
    const provider = makeProvider();
    expect(await provider.getNamesByOwner("RNonexistent")).toEqual([]);
  });

  it("verifyOwner returns true when the address holds the owner token", async () => {
    fetchMock.mockResolvedValueOnce(mockRpcResponse({ RChTMyBr6eqFbS1W5WQoJmeCyuEDDpnXuN: 1 }));
    const provider = makeProvider();
    expect(await provider.verifyOwner("craigd.avn", "RChTMyBr6eqFbS1W5WQoJmeCyuEDDpnXuN")).toBe(true);
  });

  it("verifyOwner returns false for a different address", async () => {
    fetchMock.mockResolvedValueOnce(mockRpcResponse({ RChTMyBr6eqFbS1W5WQoJmeCyuEDDpnXuN: 1 }));
    const provider = makeProvider();
    expect(await provider.verifyOwner("craigd.avn", "RSomeoneElse")).toBe(false);
  });

  it("verifyOwner returns false when the name has no holders", async () => {
    fetchMock.mockResolvedValueOnce(mockRpcResponse({}));
    const provider = makeProvider();
    expect(await provider.verifyOwner("unregistered.avn", "RChTMyBr6eqFbS1W5WQoJmeCyuEDDpnXuN")).toBe(false);
  });

  it("verifyOwner returns false (fails closed) if the RPC call errors", async () => {
    fetchMock.mockResolvedValueOnce(mockRpcError("Asset not found"));
    const provider = makeProvider();
    expect(await provider.verifyOwner("craigd.avn", "RChTMyBr6eqFbS1W5WQoJmeCyuEDDpnXuN")).toBe(false);
  });

  it("verifyOwner rejects an ANS name that fails DNS-safety validation", async () => {
    const provider = makeProvider();
    expect(await provider.verifyOwner("_bad.avn", "RChTMyBr6eqFbS1W5WQoJmeCyuEDDpnXuN")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("isNameActive is true when the owner token has exactly one holder", async () => {
    fetchMock.mockResolvedValueOnce(mockRpcResponse({ RChTMyBr6eqFbS1W5WQoJmeCyuEDDpnXuN: 1 }));
    const provider = makeProvider();
    expect(await provider.isNameActive("craigd.avn")).toBe(true);
  });

  it("isNameActive is false when there are no holders", async () => {
    fetchMock.mockResolvedValueOnce(mockRpcResponse({}));
    const provider = makeProvider();
    expect(await provider.isNameActive("unregistered.avn")).toBe(false);
  });

  it("isNameActive fails closed (false) if the RPC call errors, distinct from confirmed-unregistered", async () => {
    fetchMock.mockResolvedValueOnce(mockRpcError("node unreachable"));
    const provider = makeProvider();
    expect(await provider.isNameActive("craigd.avn")).toBe(false);
  });

  it("treats an anomalous multi-holder owner token as unresolved rather than guessing", async () => {
    fetchMock.mockResolvedValueOnce(
      mockRpcResponse({ RAddressOne111111111111111111111: 1, RAddressTwo222222222222222222222: 1 }),
    );
    const provider = makeProvider();
    expect(await provider.isNameActive("craigd.avn")).toBe(false);
  });

  it("getOwnerAddress returns the current holder", async () => {
    fetchMock.mockResolvedValueOnce(mockRpcResponse({ RChTMyBr6eqFbS1W5WQoJmeCyuEDDpnXuN: 1 }));
    const provider = makeProvider();
    expect(await provider.getOwnerAddress("craigd.avn")).toBe("RChTMyBr6eqFbS1W5WQoJmeCyuEDDpnXuN");
  });

  it("getOwnerAddress returns null when unregistered", async () => {
    fetchMock.mockResolvedValueOnce(mockRpcResponse({}));
    const provider = makeProvider();
    expect(await provider.getOwnerAddress("unregistered.avn")).toBe(null);
  });

  it("getOwnerAddress throws (does not return null) when the RPC call fails", async () => {
    // Critical distinction: a transient RPC failure must never look like a
    // confirmed "no owner" to callers like the background ownership
    // watcher, or a node outage during a sweep would disable every
    // tracked name's DNS records.
    fetchMock.mockResolvedValueOnce(mockRpcError("node unreachable"));
    const provider = makeProvider();
    await expect(provider.getOwnerAddress("craigd.avn")).rejects.toThrow();
  });
});
