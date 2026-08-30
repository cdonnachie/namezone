import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { validateSourceName } from "@/lib/dns/validation";
import { getNamespace } from "@/lib/namespaces";
import { isSiteFeatureEnabled } from "@/lib/site/constants";
import { prisma } from "@/lib/db";

// Prisma requires the Node.js runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Same shared-secret gate as the sibling sites route. */
function authorized(req: Request): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || secret.length < 32) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const provided = authHeader.replace(/^Bearer\s+/i, "") || req.headers.get("x-internal-secret") || "";
  return safeCompare(provided, secret);
}

/**
 * The ACTIVE managed sites under a name — read-only, no address required.
 *
 *   GET /api/internal/sites/published?namespace=radiant&name=bob.rxd
 *
 * Exists for SURF's scanner: a directory card for a name can list the
 * subsites its owner has published. Unlike the sibling route, there is no
 * ownership check — this endpoint writes nothing, and everything it returns
 * is already public knowledge (each fqdn is a live DNS record anyone can
 * query). The shared secret gates who may ask, not what is revealed.
 */
export async function GET(req: Request) {
  try {
    if (!authorized(req)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (!isSiteFeatureEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const ns = getNamespace(searchParams.get("namespace") ?? "");
    const parsed = validateSourceName(searchParams.get("name") ?? "", ns);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const sites = await prisma.managedSite.findMany({
      where: { namespace: ns.key, claimedName: parsed.value, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      name: parsed.value,
      sites: sites.map((s) => ({
        fqdn: s.fqdn.replace(/\.$/, ""),
        hostname: s.relativeHost,
        target: s.target,
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleApiError(err, "Failed to load published sites.");
  }
}
