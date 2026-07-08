import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { signBitcoinStyleMessage } from "../signmessage";
import { buildRadiantLoginChallengeMessage, verifyRadiantSignedMessage } from "./message";

// Self-generated keypair/address (not a captured Photonic fixture like
// ../avian/message.test.ts's REAL_* constants). Proves the wiring - default
// Bitcoin Signed Message prefix, address decoding, base64 signature parsing -
// round-trips correctly; the prefix choice itself has been confirmed
// separately against real signatures produced by the Photonic wallet.
function p2pkhAddressFromPrivateKey(privateKey: Uint8Array): string {
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  const hash160 = ripemd160(sha256(publicKey));
  const payload = new Uint8Array(1 + hash160.length);
  payload[0] = 0x00;
  payload.set(hash160, 1);
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload);
  full.set(checksum, payload.length);
  return bs58.encode(full);
}

const PRIVATE_KEY = new Uint8Array(32).fill(7);
const ADDRESS = p2pkhAddressFromPrivateKey(PRIVATE_KEY);
const MESSAGE = buildRadiantLoginChallengeMessage({
  address: ADDRESS,
  nonce: "deadbeefdeadbeefdeadbeefdeadbeef",
  issuedAt: new Date("2026-07-07T00:00:00.000Z"),
  expiresAt: new Date("2026-07-07T00:05:00.000Z"),
});
const SIGNATURE = signBitcoinStyleMessage({
  privateKey: PRIVATE_KEY,
  message: MESSAGE,
  messagePrefix: "Bitcoin Signed Message:\n",
  compressed: true,
});

// Photonic's own recognized-challenge shape (see its protocol.ts) - re-declared
// here since it's the wallet's code, not ours, to import directly.
const PHOTONIC_CONNECT_CHALLENGE_RE = /^[a-z0-9.-]+:wallet-connect:v\d+:/i;

describe("buildRadiantLoginChallengeMessage", () => {
  it("contains no control characters (Photonic's wallet refuses to sign messages that do)", () => {
    for (let i = 0; i < MESSAGE.length; i++) {
      const code = MESSAGE.charCodeAt(i);
      expect(code, `char ${JSON.stringify(MESSAGE[i])} at index ${i}`).toBeGreaterThanOrEqual(0x20);
      expect(code).not.toBe(0x7f);
    }
  });

  it("matches Photonic's recognized wallet-connect challenge shape", () => {
    expect(PHOTONIC_CONNECT_CHALLENGE_RE.test(MESSAGE)).toBe(true);
  });
});

describe("verifyRadiantSignedMessage", () => {
  it("verifies a signature produced with the assumed default Bitcoin message prefix", () => {
    expect(verifyRadiantSignedMessage(ADDRESS, MESSAGE, SIGNATURE)).toBe(true);
  });

  it("rejects the signature against a different address", () => {
    const otherAddress = p2pkhAddressFromPrivateKey(new Uint8Array(32).fill(9));
    expect(verifyRadiantSignedMessage(otherAddress, MESSAGE, SIGNATURE)).toBe(false);
  });

  it("rejects the signature against a tampered message", () => {
    expect(verifyRadiantSignedMessage(ADDRESS, `${MESSAGE}x`, SIGNATURE)).toBe(false);
  });

  it("returns false (not a throw) for a garbage signature string", () => {
    expect(verifyRadiantSignedMessage(ADDRESS, MESSAGE, "not-base64!!")).toBe(false);
  });

  it("returns false (not a throw) for a malformed address", () => {
    expect(verifyRadiantSignedMessage("not-an-address", MESSAGE, SIGNATURE)).toBe(false);
  });
});
