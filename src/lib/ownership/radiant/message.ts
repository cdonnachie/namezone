import { verifyBitcoinStyleSignedMessage } from "../signmessage";

/**
 * Radiant kept Bitcoin's address format (see ./address.ts), and its wallet
 * signmessage flow follows suit with the standard "Bitcoin Signed Message:\n"
 * magic prefix. Confirmed working against real signatures produced by the
 * Photonic wallet.
 *
 * RADIANT_MESSAGE_PREFIX overrides this if some other Radiant wallet turns
 * out to use a custom prefix.
 */
const MESSAGE_PREFIX = process.env.RADIANT_MESSAGE_PREFIX ?? "Bitcoin Signed Message:\n";

/**
 * Prefixed with Photonic's recognized-challenge shape,
 * "<namespace>:wallet-connect:v1:<sessionId>:...", using our own nonce as
 * the session id - Photonic's own protocol.ts documents this as purely a
 * "recognized" trust badge in its UI ("non-matching challenges are still
 * signable, never auto-rejected"), so this is a nice-to-have, not required.
 * Everything after that prefix is free-form: the regex only anchors the
 * start, so we keep our human-readable statement there for the manual
 * copy/paste flow, where the user is reading raw text, not going through
 * Photonic's structured connect protocol (which would render `origin`/`app`
 * fields for display instead).
 *
 * Also deliberately a single line with no newlines/tabs/other control
 * characters - Photonic's signer (`@lib/sign`'s `hasControlChars`) rejects
 * any character below 0x20 or 0x7F outright, so a "\n"-joined multi-line
 * message like Avian's (see ../avian/message.ts) fails there.
 */
const CONNECT_NAMESPACE = "radiant"; // matches radiantNamespace.key

export function buildRadiantLoginChallengeMessage(params: {
  address: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  const { address, nonce, issuedAt, expiresAt } = params;
  const statement = [
    "Radiant Wave Zone wants you to sign in with your Radiant address.",
    `Address: ${address}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expires At: ${expiresAt.toISOString()}`,
  ].join(" | ");
  return `${CONNECT_NAMESPACE}:wallet-connect:v1:${nonce}:${statement}`;
}

/**
 * Verifies a base64-encoded signed-message signature against the claimed
 * Radiant address. Returns false (never throws) on any malformed input.
 */
export function verifyRadiantSignedMessage(
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
