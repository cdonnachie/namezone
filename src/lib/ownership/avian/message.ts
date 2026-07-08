import { verifyBitcoinStyleSignedMessage } from "../signmessage";

/**
 * Avian uses a Bitcoin-derived (UTXO, base58check P2PKH-style address)
 * signed-message scheme: `signmessage <address> <message>` in an Avian
 * wallet/daemon produces a base64 signature that recovers to the address's
 * public key hash.
 *
 * Avian is a fork of Ravencoin and kept Ravencoin's original message magic
 * string rather than rebranding it, so the wire-level prefix is still
 * "Raven Signed Message:\n" (not "Avian Signed Message:\n"). Override via
 * AVIAN_MESSAGE_PREFIX if a future Avian Core release changes this.
 * Verified against real Avian Core signmessage output - see message.test.ts.
 */
const MESSAGE_PREFIX = process.env.AVIAN_MESSAGE_PREFIX ?? "Raven Signed Message:\n";

export function buildAvianLoginChallengeMessage(params: {
  address: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  const { address, nonce, issuedAt, expiresAt } = params;
  return [
    "Avian Name Zone wants you to sign in with your Avian address.",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expires At: ${expiresAt.toISOString()}`,
  ].join("\n");
}

/**
 * Verifies a base64-encoded signed-message signature against the claimed
 * Avian address. Returns false (never throws) on any malformed input.
 */
export function verifyAvianSignedMessage(
  address: string,
  message: string,
  signatureBase64: string,
): boolean {
  return verifyBitcoinStyleSignedMessage({
    address,
    message,
    signatureBase64,
    messagePrefix: MESSAGE_PREFIX,
  });
}
