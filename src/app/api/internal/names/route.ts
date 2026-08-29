import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { getNamespace } from "@/lib/namespaces";
import { getOwnedNameSummaries } from "@/lib/ownership/names-for-owner";
import { checkRateLimit } from "@/lib/rate-limit";

// Prisma and the chain adapters require the Node.js runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Names owned by an address, for a co-hosted companion app:
 *   GET /api/internal/names?namespace=radiant&address=<addr>
 *
 * The public equivalent (/api/[namespace]/names) keys off the caller's own
 * session cookie, which a server-to-server caller does not have. This one
 * takes the address explicitly and is therefore gated on a shared secret
 * instead — unlike the TLS-authorize endpoint's optional check, the secret is
 * mandatory here, because this enumerates one person's holdings rather than
 * answering yes/no about a single hostname.
 *
 * Like every /api/internal/* route this must not be reachable from the public
 * internet; the shipped Caddyfile blanket-blocks the path on every public site.
 */
export async function GET(req: Request) {
  try {
    const secret = process.env.INTERNAL_API_SECRET;
    if (!secret || secret.length < 32) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const authHeader = req.headers.get("authorization") ?? "";
    const provided = authHeader.replace(/^Bearer\s+/i, "") || req.headers.get("x-internal-secret") || "";
    if (!safeCompare(provided, secret)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const ns = getNamespace(searchParams.get("namespace") ?? "");
    const address = (searchParams.get("address") ?? "").trim();
    if (!address) {
      return NextResponse.json({ error: "address is required." }, { status: 400 });
    }

    // Each call can hit the chain backend and reconcile against PowerDNS, so
    // an authenticated-but-looping caller still cannot hammer it.
    const rateLimit = await checkRateLimit(`internal-names:${address}`, 30, 60_000);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: "Too many lookups." }, { status: 429 });
    }

    const summaries = await getOwnedNameSummaries(ns, address);
    return NextResponse.json({
      namespace: ns.key,
      address,
      names: summaries.map((s) => ({
        name: s.name,
        // Trailing dot stripped: this is a hostname for display and for
        // building URLs, not a wire-format FQDN. Matches /verified and
        // /api/internal/sites.
        zone: s.zone.replace(/\.$/, ""),
        recordCount: s.recordCount,
        lastUpdated: s.lastUpdated.toISOString(),
      })),
    });
  } catch (err) {
    return handleApiError(err, "Failed to load names.");
  }
}
