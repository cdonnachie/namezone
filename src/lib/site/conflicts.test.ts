import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The guards that stop a published site and anything else claiming the same
 * hostname.
 *
 * These matter more than most: without them a publish would overwrite whatever
 * a name already served — a GitHub Pages site, another host's A records — and
 * the first anyone would know is their site going dark. The write path also
 * re-checks immediately before replacing an rrset, because the API-level check
 * leaves a window in which a record could appear.
 */

const findFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    dnsRecord: { findFirst: (...a: unknown[]) => findFirst(...a), findMany: vi.fn(async () => []) },
    managedSite: { findFirst: (...a: unknown[]) => findFirst(...a), deleteMany: vi.fn() },
  },
}));

vi.mock("@/lib/powerdns/client", () => ({ getPowerDnsClient: () => ({}) }));

const { hasNonSiteRecordAt, hasManagedSiteAt } = await import("./service");

beforeEach(() => {
  findFirst.mockReset();
});

describe("hasNonSiteRecordAt", () => {
  it("is true when a record the owner wrote is active there", async () => {
    findFirst.mockResolvedValueOnce({ id: "rec_1" });
    await expect(hasNonSiteRecordAt("radiant", "craigd.rxd.zone.")).resolves.toBe(true);
  });

  it("is false at a hostname with nothing on it", async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(hasNonSiteRecordAt("radiant", "unused.rxd.zone.")).resolves.toBe(false);
  });

  it("ignores the site's own records, so a redeploy is not a conflict", async () => {
    findFirst.mockResolvedValueOnce(null);
    await hasNonSiteRecordAt("radiant", "craigd.rxd.zone.");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isManagedSite: false, status: "ACTIVE" }),
      }),
    );
  });

  it("scopes the check to one namespace and one hostname", async () => {
    findFirst.mockResolvedValueOnce(null);
    await hasNonSiteRecordAt("radiant", "blog.craigd.rxd.zone.");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ namespace: "radiant", fqdn: "blog.craigd.rxd.zone." }),
      }),
    );
  });
});

describe("hasManagedSiteAt", () => {
  it("is true when a site is published there", async () => {
    findFirst.mockResolvedValueOnce({ id: "site_1" });
    await expect(hasManagedSiteAt("radiant", "craigd.rxd.zone.")).resolves.toBe(true);
  });

  it("is false otherwise", async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(hasManagedSiteAt("radiant", "craigd.rxd.zone.")).resolves.toBe(false);
  });

  it("only counts ACTIVE sites, so a disabled one frees its hostname", async () => {
    findFirst.mockResolvedValueOnce(null);
    await hasManagedSiteAt("radiant", "craigd.rxd.zone.");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "ACTIVE" }) }),
    );
  });
});
