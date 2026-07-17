/**
 * Shared contract for the Photonic sign-in callback (ported from the surf
 * project, where it shipped first). Kept dependency-free so both the client
 * callback page and the connect/step-up dialogs can import it - no server
 * imports, safe in the browser bundle.
 *
 * Flow: the connect flow / step-up dialog opens Photonic with a `callback`
 * URL pointing at PHOTONIC_CALLBACK_PATH. After signing, Photonic redirects
 * its tab to the callback with the result in the URL *fragment* (never sent
 * to a server). The callback page parses it, broadcasts it on
 * PHOTONIC_CALLBACK_CHANNEL, and the still-open originating tab (same
 * origin) auto-fills and submits. Photonic builds without callback support
 * ignore the field and the manual signature paste still works.
 */

// Radiant-prefixed (Photonic is Radiant-only), so the URL works as-is both
// on the canonical host and on the rxd.zone custom domain - the middleware
// passes already-namespace-prefixed paths through untouched.
export const PHOTONIC_CALLBACK_PATH = "/radiant/photonic-callback";
export const PHOTONIC_CALLBACK_CHANNEL = "namezone:photonic-signin";

export interface PhotonicCallbackPayload {
  /** Echoes the challenge nonce so the originating tab can match its pending request. */
  nonce: string;
  address: string;
  signature: string;
}

// Matches buildRadiantLoginChallengeMessage's prefix; the nonce is
// randomBytes(16).toString("hex") (see src/lib/auth/challenge.ts).
const NONCE_RE = /^radiant:wallet-connect:v1:([a-f0-9]+):/;

/** Pull the nonce out of a challenge message (client-safe; mirrors the server). */
export function extractChallengeNonce(message: string): string | null {
  return message.match(NONCE_RE)?.[1] ?? null;
}

/**
 * Parse a callback fragment (`#nonce=…&address=…&signature=…`) into a
 * payload, or null if any field is missing. Tolerates a leading `#`.
 */
export function parseCallbackHash(hash: string): PhotonicCallbackPayload | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const nonce = params.get("nonce");
  const address = params.get("address");
  const signature = params.get("signature");
  if (!nonce || !address || !signature) return null;
  return { nonce, address, signature };
}
