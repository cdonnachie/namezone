// Mirrors Photonic's own protocol.ts constants/shape (not our protocol - we
// don't import their package, just replicate the wire format we were shown).
const PHOTONIC_PROTOCOL = "photonic-connect";
const PHOTONIC_VERSION = 1;

// Overridable for local Photonic dev (e.g. http://localhost:5173/#/connect).
// Must be NEXT_PUBLIC_ - this runs in the browser - so it's inlined at build
// time; set it before `next build`, not just at runtime.
const PHOTONIC_CONNECT_URL =
  process.env.NEXT_PUBLIC_PHOTONIC_CONNECT_URL ?? "https://photonic-wallet.com/#/connect";

function toBase64Url(utf8: string): string {
  const bytes = new TextEncoder().encode(utf8);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Builds a Photonic "Connect & Sign" deep link carrying our challenge as a
 * structured SignRequest envelope (see Photonic's protocol.ts) rather than a
 * bare string, so its UI can show which site is asking (origin/app) and warn
 * on an address mismatch. Opens Photonic's own hosted wallet in a new tab.
 *
 * `callback` is a same-origin URL Photonic redirects to after signing, with
 * the result in the URL fragment (see ./photonic-callback.ts) - the
 * originating tab picks it up over a BroadcastChannel and signs in without
 * a manual paste. Photonic builds without callback support ignore the field
 * and the user copies the signature back manually - nothing breaks.
 */
export function buildPhotonicConnectUrl(params: {
  challenge: string;
  address: string;
  origin: string;
  callback?: string;
}): string {
  const request = {
    protocol: PHOTONIC_PROTOCOL,
    v: PHOTONIC_VERSION,
    t: "sign-request" as const,
    challenge: params.challenge,
    origin: params.origin,
    app: "Radiant Wave Zone",
    address: params.address,
    // undefined keys drop out of JSON.stringify, so a blank is simply omitted.
    callback: params.callback || undefined,
  };
  return `${PHOTONIC_CONNECT_URL}?req=${toBase64Url(JSON.stringify(request))}`;
}
