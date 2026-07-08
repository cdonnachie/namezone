import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import type { NamespaceConfig } from "@/lib/namespaces/types";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function createLoginChallenge(
  namespace: NamespaceConfig,
  address: string,
): Promise<{ message: string; nonce: string }> {
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
  const message = namespace.adapter.buildLoginChallengeMessage({ address, nonce, issuedAt, expiresAt });

  await prisma.userSession.create({
    data: { namespace: namespace.key, address, nonce, message, expiresAt },
  });

  return { message, nonce };
}

export type VerifyLoginResult =
  | { ok: true; address: string }
  | { ok: false; error: string };

/**
 * Verifies a signed login challenge: the message must match one issued for
 * this address within this namespace, must not be expired or already used,
 * and the signature must recover to the claimed address per the
 * namespace's own signing scheme.
 */
export async function verifyLoginChallenge(
  namespace: NamespaceConfig,
  address: string,
  message: string,
  signature: string,
): Promise<VerifyLoginResult> {
  const session = await prisma.userSession.findFirst({
    where: { namespace: namespace.key, address, message, verified: false },
    orderBy: { createdAt: "desc" },
  });

  if (!session) {
    return { ok: false, error: "No matching login challenge found. Please request a new one." };
  }
  if (session.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "Login challenge has expired. Please request a new one." };
  }

  const validSignature = namespace.adapter.verifySignedMessage(address, message, signature);
  if (!validSignature) {
    return { ok: false, error: "Signature verification failed." };
  }

  // updateMany with `verified: false` in the WHERE (not a plain update by id)
  // so marking the challenge used is atomic: two concurrent verify requests
  // for the same challenge can both pass the findFirst above, but only one
  // can win this conditional write - the other sees count 0 and is rejected.
  const claimed = await prisma.userSession.updateMany({
    where: { id: session.id, verified: false },
    data: { verified: true },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "Login challenge already used. Please request a new one." };
  }

  return { ok: true, address };
}

/**
 * Deletes login-challenge rows that can never be used again: unverified
 * challenges past their 5-minute expiry, and verified ones older than 30
 * days (verified rows are never read back - sessions are stateless JWTs -
 * they're only kept a while as login history). Without this, the
 * unauthenticated challenge endpoint would grow UserSession without bound.
 * Called from the cron sweep (POST /api/cron/verify-ownership).
 */
export async function cleanupExpiredLoginChallenges(): Promise<{ deleted: number }> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [expired, oldVerified] = await Promise.all([
    prisma.userSession.deleteMany({ where: { verified: false, expiresAt: { lt: now } } }),
    prisma.userSession.deleteMany({ where: { verified: true, createdAt: { lt: thirtyDaysAgo } } }),
  ]);
  return { deleted: expired.count + oldVerified.count };
}
