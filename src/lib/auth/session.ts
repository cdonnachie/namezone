import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE_NAME = "ans_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 12; // 12 hours

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  // 32+ chars: session JWTs are HS256-signed, so AUTH_SECRET is the only
  // thing standing between an offline brute-force and forging any session.
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET environment variable must be set to a strong random value (>=32 chars), e.g. `openssl rand -base64 32`.",
    );
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  address: string;
  namespace: string;
}

export async function createSessionToken(namespace: string, address: string): Promise<string> {
  return new SignJWT({ address, namespace })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.address !== "string" || typeof payload.namespace !== "string") return null;
    return { address: payload.address, namespace: payload.namespace };
  } catch {
    return null;
  }
}

/**
 * Reads and verifies the session cookie from the current request (Server
 * Components / Route Handlers). Requires the session to have been minted
 * for `namespace` - a session authenticated against Avian can't be reused
 * to act on Radiant (or vice versa), since they're different chain
 * identities even if the address string happened to match. Switching
 * namespaces requires a fresh sign-in.
 */
export async function getSession(namespace: string): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session || session.namespace !== namespace) return null;
  return session;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
