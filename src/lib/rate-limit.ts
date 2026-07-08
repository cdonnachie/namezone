import { prisma } from "@/lib/db";

const WINDOW_MS = 60_000; // 1 minute fixed window
const DEFAULT_LIMIT = Number(process.env.RATE_LIMIT_DNS_WRITES_PER_MINUTE ?? 20);

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * Simple fixed-window rate limiter backed by the database, keyed per caller
 * (e.g. "dns-write:<address>"). Good enough for single-instance / low-write
 * workloads; swap for a Redis-backed sliding window if scaling out.
 */
export async function checkRateLimit(
  key: string,
  limit: number = DEFAULT_LIMIT,
  windowMs: number = WINDOW_MS,
): Promise<RateLimitResult> {
  const now = new Date();
  const bucket = await prisma.rateLimitBucket.findUnique({ where: { key } });

  if (!bucket || bucket.windowEnd.getTime() <= now.getTime()) {
    const windowEnd = new Date(now.getTime() + windowMs);
    await prisma.rateLimitBucket.upsert({
      where: { key },
      create: { key, count: 1, windowEnd },
      update: { count: 1, windowEnd },
    });
    return { allowed: true };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((bucket.windowEnd.getTime() - now.getTime()) / 1000),
    };
  }

  await prisma.rateLimitBucket.update({
    where: { key },
    data: { count: { increment: 1 } },
  });
  return { allowed: true };
}

/**
 * Deletes buckets whose window has ended. Buckets are keyed per
 * caller-supplied value (address, IP), so unauthenticated endpoints mint a
 * new row per unique key - without this sweep the table grows without
 * bound. Called from the cron sweep (POST /api/cron/verify-ownership).
 */
export async function cleanupExpiredRateLimitBuckets(): Promise<{ deleted: number }> {
  const result = await prisma.rateLimitBucket.deleteMany({
    where: { windowEnd: { lt: new Date() } },
  });
  return { deleted: result.count };
}
