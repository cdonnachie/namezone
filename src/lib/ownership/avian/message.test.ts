import { describe, expect, it } from "vitest";
import { verifyAvianSignedMessage } from "./message";

/**
 * Real signmessage output captured from an actual Avian Core node, used as
 * a ground-truth regression vector. This caught a real bug: bitcoinjs-message's
 * magicHash only auto-prepends a compact-size length prefix to the *message*,
 * not to the custom message prefix itself, so a plain "Raven Signed
 * Message:\n" prefix silently failed to verify against genuine Avian Core
 * signatures until the length byte was added (see message.ts).
 */
const REAL_ADDRESS = "RChTMyBr6eqFbS1W5WQoJmeCyuEDDpnXuN";
const REAL_MESSAGE = [
  "Avian Name Zone wants you to sign in with your Avian address.",
  "",
  "Address: RChTMyBr6eqFbS1W5WQoJmeCyuEDDpnXuN",
  "Nonce: 616387444e53ac29f10d200cc3dd2aab",
  "Issued At: 2026-07-06T19:27:26.160Z",
  "Expires At: 2026-07-06T19:32:26.160Z",
].join("\n");
const REAL_SIGNATURE =
  "IO9s4+3Qdml5YwCYsYBQnybbeLPpAZLFLmTa6EC9QUu+WQoOvRbk+da41bLl7kW04NiPY/sNn2R1eIiJag271M8=";

describe("verifyAvianSignedMessage", () => {
  it("verifies a real signature produced by Avian Core's signmessage RPC", () => {
    expect(verifyAvianSignedMessage(REAL_ADDRESS, REAL_MESSAGE, REAL_SIGNATURE)).toBe(true);
  });

  it("rejects the signature against a different address", () => {
    expect(
      verifyAvianSignedMessage("RG3nCbBiP8CBrJUFdEDWxvSCPKukumS1Fr", REAL_MESSAGE, REAL_SIGNATURE),
    ).toBe(false);
  });

  it("rejects the signature against a tampered message", () => {
    expect(verifyAvianSignedMessage(REAL_ADDRESS, `${REAL_MESSAGE}x`, REAL_SIGNATURE)).toBe(false);
  });

  it("rejects a corrupted signature", () => {
    const corrupted = `${REAL_SIGNATURE.slice(0, -4)}AAAA`;
    expect(verifyAvianSignedMessage(REAL_ADDRESS, REAL_MESSAGE, corrupted)).toBe(false);
  });

  it("returns false (not a throw) for a garbage signature string", () => {
    expect(verifyAvianSignedMessage(REAL_ADDRESS, REAL_MESSAGE, "not-base64!!")).toBe(false);
  });

  it("returns false (not a throw) for a malformed address", () => {
    expect(verifyAvianSignedMessage("not-an-address", REAL_MESSAGE, REAL_SIGNATURE)).toBe(false);
  });
});
