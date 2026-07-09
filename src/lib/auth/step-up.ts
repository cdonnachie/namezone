import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

/**
 * Step-up ("confirm changes with my wallet") support: an opt-in,
 * per-address second factor for DNS writes. When AddressSetting.
 * requireSignedWrites is on, a valid session cookie alone isn't enough to
 * write - the browser must also hold a short-lived step-up cookie, minted
 * only by POST /api/[namespace]/auth/step-up after verifying a fresh
 * wallet signature. A session hijacked on a shared computer therefore
 * can't change records (or disable the setting): the attacker has the
 * cookie but not the wallet.
 *
 * The proof is a second JWT cookie rather than a DB timestamp so it's
 * scoped to the browser that actually signed (a confirmation on your home
 * PC doesn't unlock a stale session elsewhere), and expires on its own.
 */
export const STEP_UP_COOKIE_NAME = "namezone_stepup";
export const STEP_UP_DURATION_SECONDS = 60 * 10; // 10 minutes

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET environment variable must be set to a strong random value (>=32 chars), e.g. `openssl rand -base64 32`.",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createStepUpToken(namespace: string, address: string): Promise<string> {
  return new SignJWT({ address, namespace, purpose: "step-up" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STEP_UP_DURATION_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifyStepUpToken(
  token: string,
  namespace: string,
  address: string,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return (
      payload.purpose === "step-up" && payload.namespace === namespace && payload.address === address
    );
  } catch {
    return false;
  }
}

export async function setStepUpCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(STEP_UP_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STEP_UP_DURATION_SECONDS,
  });
}

/** True when this namespace+address has opted into signed-write confirmation. */
export async function isStepUpRequired(namespace: string, address: string): Promise<boolean> {
  const setting = await prisma.addressSetting.findUnique({
    where: { namespace_address: { namespace, address } },
    select: { requireSignedWrites: true },
  });
  return setting?.requireSignedWrites ?? false;
}

/** Reads and verifies the step-up cookie for the current request. */
export async function hasValidStepUp(namespace: string, address: string): Promise<boolean> {
  const store = await cookies();
  const token = store.get(STEP_UP_COOKIE_NAME)?.value;
  if (!token) return false;
  return verifyStepUpToken(token, namespace, address);
}

export type StepUpCheck = { ok: true } | { ok: false; error: string; status: number };

/**
 * Gate for DNS write routes (and for turning the setting itself OFF):
 * passes trivially when the address hasn't opted in; otherwise requires a
 * live step-up cookie. Returns 403 with a machine-readable marker the
 * client uses to open the "confirm with your wallet" dialog.
 */
export const STEP_UP_REQUIRED_ERROR = "STEP_UP_REQUIRED";

export async function checkStepUpForWrite(namespace: string, address: string): Promise<StepUpCheck> {
  if (!(await isStepUpRequired(namespace, address))) return { ok: true };
  if (await hasValidStepUp(namespace, address)) return { ok: true };
  return { ok: false, error: STEP_UP_REQUIRED_ERROR, status: 403 };
}
