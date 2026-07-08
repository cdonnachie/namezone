// Mirrors Photonic's own protocol.ts constants/shape (not our protocol - we
// don't import their package, just replicate the wire format we were shown).
const PHOTONIC_PROTOCOL = "photonic-connect";
const PHOTONIC_VERSION = 1;
const PHOTONIC_CONNECT_URL = "https://photonic-wallet.com/#/connect";

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
 * on an address mismatch, instead of "no origin was provided". Opens
 * Photonic's own hosted wallet in a new tab; the user still copies the
 * resulting signature back here - there's no redirect/callback field in
 * Photonic's SignRequest shape to return to us automatically.
 */
export function buildPhotonicConnectUrl(params: { challenge: string; address: string; origin: string }): string {
  const request = {
    protocol: PHOTONIC_PROTOCOL,
    v: PHOTONIC_VERSION,
    t: "sign-request" as const,
    challenge: params.challenge,
    origin: params.origin,
    app: "Radiant Wave Zone",
    address: params.address,
  };
  return `${PHOTONIC_CONNECT_URL}?req=${toBase64Url(JSON.stringify(request))}`;
}
