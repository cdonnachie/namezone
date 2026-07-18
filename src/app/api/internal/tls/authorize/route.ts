import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { findEnabledRedirectByFqdn } from "@/lib/redirect/lookup";
import { isValidAuthorizeDomain } from "@/lib/redirect/tls-authorize";

// Prisma lookup requires the Node.js runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Plain-text responses with no redirect data: Caddy's on_demand_tls `ask`
// treats 200 as "issue allowed" and any other status as "denied". Never leak
// the destination or any other redirect metadata here.
function reply(status: number, body: string): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Caddy on-demand-TLS authorization endpoint:
 *   GET /api/internal/tls/authorize?domain=x.craigd.rxd.zone
 *
 * Returns 200 only when the domain is syntactically valid, inside a managed
 * zone, and backed by an ENABLED redirect - so an arbitrary internet user can
 * never make Caddy mint a certificate for an unrelated or unconfigured host.
 *
 * Should be reachable only from the trusted Caddy/localhost network. When that
 * isolation isn't possible, set REDIRECT_TLS_AUTH_SECRET and have Caddy send it
 * (Authorization: Bearer <secret> or X-Tls-Auth-Secret) for a defense-in-depth
 * application-level check.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const secret = process.env.REDIRECT_TLS_AUTH_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization") ?? "";
    const provided = authHeader.replace(/^Bearer\s+/i, "") || req.headers.get("x-tls-auth-secret") || "";
    if (!safeCompare(provided, secret)) {
      return reply(403, "forbidden");
    }
  }

  // Bound total issuance-check volume as a cert-abuse safeguard, regardless of
  // source. Unknown domains are also rejected below before any issuance, so
  // this mainly caps DB/CPU cost under a flood. The rate limiter doubles as a
  // sampler for the denial log (denied domains are only logged when allowed
  // through here), preventing log flooding.
  const limit = Math.max(1, Number(process.env.REDIRECT_TLS_AUTH_RATE_LIMIT ?? 60) || 60);
  const rl = await checkRateLimit("tls-authorize:global", limit);
  if (!rl.allowed) {
    return reply(429, "rate limited");
  }

  const domain = new URL(req.url).searchParams.get("domain")?.trim().toLowerCase() ?? "";
  if (!isValidAuthorizeDomain(domain)) {
    return reply(400, "invalid domain");
  }

  const redirect = await findEnabledRedirectByFqdn(domain);
  if (!redirect) {
    console.warn("[tls-authorize] denied certificate issuance for", domain);
    return reply(404, "denied");
  }

  return reply(200, "ok");
}
