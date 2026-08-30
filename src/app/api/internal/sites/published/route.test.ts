import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The read-only published-sites listing SURF's scanner calls.
 *
 * Two properties matter: the shared-secret gate actually gates (this is the
 * one internal route with no per-request ownership check, so the secret is
 * the whole fence), and only ACTIVE sites are returned — a site disabled by
 * a name transfer must vanish from directory cards, not linger.
 */

const findMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { managedSite: { findMany: (...a: unknown[]) => findMany(...a) } },
}));

vi.mock("@/lib/namespaces", () => {
  class NamespaceNotFoundError extends Error {}
  return {
    NamespaceNotFoundError,
    getNamespace: (key: string) => {
      if (key !== "radiant") throw new NamespaceNotFoundError(`Unknown namespace "${key}".`);
      return { key: "radiant", tld: "rxd" };
    },
  };
});

const { GET } = await import("./route");

const SECRET = "s".repeat(40);

function get(query: string, secret?: string): Promise<Response> {
  return GET(
    new Request(`http://internal/api/internal/sites/published?${query}`, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }),
  );
}

beforeEach(() => {
  findMany.mockReset();
  process.env.INTERNAL_API_SECRET = SECRET;
  delete process.env.SITE_HOSTING_ENABLED;
});

describe("GET /api/internal/sites/published", () => {
  it("refuses without the shared secret", async () => {
    const res = await get("namespace=radiant&name=bob.rxd");
    expect(res.status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret", async () => {
    const res = await get("namespace=radiant&name=bob.rxd", "x".repeat(40));
    expect(res.status).toBe(403);
  });

  it("refuses when the server has no usable secret configured", async () => {
    process.env.INTERNAL_API_SECRET = "short";
    const res = await get("namespace=radiant&name=bob.rxd", "short");
    expect(res.status).toBe(403);
  });

  it("404s an unknown namespace", async () => {
    const res = await get("namespace=doge&name=bob.rxd", SECRET);
    expect(res.status).toBe(404);
  });

  it("400s a malformed name", async () => {
    const res = await get("namespace=radiant&name=not-a-wave-name", SECRET);
    expect(res.status).toBe(400);
  });

  it("lists only ACTIVE sites, trailing dots stripped", async () => {
    findMany.mockResolvedValueOnce([
      {
        fqdn: "bob.rxd.zone.",
        relativeHost: "@",
        target: "EXTERNAL",
        updatedAt: new Date("2026-08-30T00:00:00Z"),
      },
      {
        fqdn: "blog.bob.rxd.zone.",
        relativeHost: "blog",
        target: "EXTERNAL",
        updatedAt: new Date("2026-08-30T00:00:00Z"),
      },
    ]);

    const res = await get("namespace=radiant&name=BOB.rxd", SECRET);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { namespace: "radiant", claimedName: "bob.rxd", status: "ACTIVE" },
      }),
    );
    expect(body.name).toBe("bob.rxd");
    expect(body.sites.map((s: { fqdn: string }) => s.fqdn)).toEqual(["bob.rxd.zone", "blog.bob.rxd.zone"]);
    expect(body.sites[1].hostname).toBe("blog");
  });

  it("404s while the site feature is killed", async () => {
    process.env.SITE_HOSTING_ENABLED = "false";
    const res = await get("namespace=radiant&name=bob.rxd", SECRET);
    expect(res.status).toBe(404);
  });
});
