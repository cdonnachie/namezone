import { describe, expect, it } from "vitest";
import { getNamespace, listAllNamespaces, listEnabledNamespaces, NamespaceNotFoundError } from "./registry";

describe("namespace registry", () => {
  it("resolves the avian namespace", () => {
    const ns = getNamespace("avian");
    expect(ns.key).toBe("avian");
    expect(ns.tld).toBe("avn");
    expect(ns.dnsZone).toBe("avn.zone");
  });

  it("throws NamespaceNotFoundError for an unknown key", () => {
    expect(() => getNamespace("nonexistent")).toThrow(NamespaceNotFoundError);
  });

  it("resolves the radiant namespace", () => {
    const ns = getNamespace("radiant");
    expect(ns.key).toBe("radiant");
    expect(ns.tld).toBe("rxd");
    expect(ns.dnsZone).toBe("rxd.zone");
  });

  it("is case-insensitive", () => {
    expect(getNamespace("AVIAN").key).toBe("avian");
  });

  it("listEnabledNamespaces includes both namespaces", () => {
    const enabled = listEnabledNamespaces();
    expect(enabled.some((ns) => ns.key === "avian")).toBe(true);
    expect(enabled.some((ns) => ns.key === "radiant")).toBe(true);
  });

  it("listAllNamespaces includes both namespaces", () => {
    const all = listAllNamespaces();
    expect(all.some((ns) => ns.key === "avian")).toBe(true);
    expect(all.some((ns) => ns.key === "radiant")).toBe(true);
  });

  it("radiant's signing scheme works, but ownership lookups are unconfigured (mock, empty) pending RXinDexer", async () => {
    const radiant = getNamespace("radiant");

    // No RADIANT_MOCK_OWNERS configured in tests - the mock lookup reports
    // nothing found rather than throwing (see ownership/radiant/mock-provider.ts).
    await expect(radiant.adapter.getNamesByOwner("anyone")).resolves.toEqual([]);
    await expect(radiant.adapter.getOwnerAddress("bob.rxd")).resolves.toBeNull();
    await expect(radiant.adapter.verifyOwner("bob.rxd", "anyone")).resolves.toBe(false);
    await expect(radiant.adapter.isNameActive("bob.rxd")).resolves.toBe(false);

    const message = radiant.adapter.buildLoginChallengeMessage({
      address: "anyone",
      nonce: "n",
      issuedAt: new Date(),
      expiresAt: new Date(),
    });
    expect(message).toContain("Radiant");
    expect(radiant.adapter.verifySignedMessage("anyone", "message", "not-a-real-signature")).toBe(false);
  });
});
