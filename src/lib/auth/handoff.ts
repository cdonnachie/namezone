import { SignJWT, jwtVerify } from "jose";

/**
 * Sign-in handoff for companion apps.
 *
 * Name Zone owns the wallet flow — the challenge, the Photonic deep link, the
 * signature check — so a sibling app (Wave Creator, say) should never rebuild
 * any of it. Instead the user is sent here, signs in the normal way, approves
 * the app on a consent screen, and is redirected back carrying a short-lived
 * token that names the address they proved they control.
 *
 * The token deliberately does NOT reuse AUTH_SECRET. A handoff token carries
 * the same {address, namespace} shape as a session token, so if both were
 * signed with the same key, `verifySessionToken` — which has no reason to
 * check `aud` — would happily accept a handoff token as a full session cookie.
 * A separate secret makes that confusion impossible rather than merely
 * unlikely, and it means a companion app never holds the key that mints Name
 * Zone's own sessions.
 */

/** Deliberately short: this token only has to survive one redirect. */
const HANDOFF_DURATION_SECONDS = 120;

const AUDIENCE = "namezone-handoff-v1";

export interface HandoffApp {
  id: string;
  name: string;
  redirectUris: string[];
}

export interface HandoffPayload {
  address: string;
  namespace: string;
  app: string;
}

function readSecret(): Uint8Array | null {
  const secret = process.env.HANDOFF_SECRET;
  // Same bar as AUTH_SECRET: HS256 means this key is all that stands between
  // an offline brute-force and forging a sign-in for any address.
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

/**
 * The companion app this instance will hand sessions to, or null when the
 * feature is not configured. Like the redirect feature, it lights up simply by
 * being configured — no per-app code.
 */
export function getHandoffApp(): HandoffApp | null {
  if (!readSecret()) return null;

  const redirectUris = (process.env.HANDOFF_REDIRECT_URIS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (redirectUris.length === 0) return null;

  return {
    id: process.env.HANDOFF_APP_ID ?? "wave-creator",
    name: process.env.HANDOFF_APP_NAME ?? "Wave Creator",
    redirectUris,
  };
}

export function isHandoffEnabled(): boolean {
  return getHandoffApp() !== null;
}

/**
 * Whether `uri` is a redirect target we are willing to send a token to.
 *
 * Exact string match against the allowlist, never a prefix or origin test: a
 * prefix match on "https://create.example.com" also accepts
 * "https://create.example.com.evil.test", and an origin match would let any
 * path on a partly-trusted host receive the token.
 */
export function isAllowedRedirectUri(uri: string, app: HandoffApp): boolean {
  return app.redirectUris.includes(uri);
}

/**
 * Mint a handoff token for an address that has just proved ownership.
 * `jti` lets the receiving app reject a token replayed inside the short
 * window before it expires.
 */
export async function createHandoffToken(params: {
  namespace: string;
  address: string;
  app: HandoffApp;
}): Promise<string | null> {
  const key = readSecret();
  if (!key) return null;

  return new SignJWT({ address: params.address, namespace: params.namespace, app: params.app.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience(AUDIENCE)
    .setJti(crypto.randomUUID())
    .setExpirationTime(`${HANDOFF_DURATION_SECONDS}s`)
    .sign(key);
}

/** Verify a handoff token. Exported for tests; the consumer is the companion app. */
export async function verifyHandoffToken(token: string): Promise<HandoffPayload | null> {
  const key = readSecret();
  if (!key) return null;

  try {
    const { payload } = await jwtVerify(token, key, { audience: AUDIENCE });
    if (
      typeof payload.address !== "string" ||
      typeof payload.namespace !== "string" ||
      typeof payload.app !== "string"
    ) {
      return null;
    }
    return { address: payload.address, namespace: payload.namespace, app: payload.app };
  } catch {
    return null;
  }
}
