import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cleanupExpiredLoginChallenges } from "@/lib/auth/challenge";
import { sweepAllClaimedNamesForOwnershipChanges } from "@/lib/dns/ownership-watcher";
import { cleanupExpiredRateLimitBuckets } from "@/lib/rate-limit";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Background ownership watcher, triggered externally on a schedule (system
 * cron, systemd timer, Vercel Cron, GitHub Actions schedule, etc. - see
 * README). Re-verifies every tracked name's current on-chain owner across
 * all enabled namespaces and disables DNS records for any name that changed
 * hands, even if nobody has visited the app since the transfer.
 *
 * Protected by a shared secret (CRON_SECRET) rather than a user session,
 * since this is meant to be called by infrastructure, not a browser.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const provided = authHeader.replace(/^Bearer\s+/i, "") || req.headers.get("x-cron-secret") || "";

  if (!safeCompare(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await sweepAllClaimedNamesForOwnershipChanges();
    // Piggyback DB housekeeping on the same schedule: expired login
    // challenges and closed rate-limit windows are both minted by
    // unauthenticated endpoints, so without a periodic purge those tables
    // grow without bound (see cleanupExpiredLoginChallenges /
    // cleanupExpiredRateLimitBuckets).
    const [challenges, buckets] = await Promise.all([
      cleanupExpiredLoginChallenges(),
      cleanupExpiredRateLimitBuckets(),
    ]);
    return NextResponse.json({
      ...result,
      cleanup: { expiredChallengesDeleted: challenges.deleted, staleRateLimitBucketsDeleted: buckets.deleted },
    });
  } catch (err) {
    console.error("[cron/verify-ownership]", err);
    return NextResponse.json({ error: "Ownership sweep failed." }, { status: 500 });
  }
}
