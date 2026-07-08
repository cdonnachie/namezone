import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { magicHash, signBitcoinStyleMessage, verifyBitcoinStyleSignedMessage } from "./signmessage";

// The ground-truth compatibility proof against a REAL wallet-produced
// signature lives in avian/message.test.ts (Avian Core signmessage output,
// custom "Raven Signed Message:\n" prefix). These tests cover the scheme
// mechanics themselves with self-generated keys.

const PREFIX = "Bitcoin Signed Message:\n";

function addressFromPrivateKey(privateKey: Uint8Array, compressed: boolean, version = 0x00): string {
  const publicKey = secp256k1.getPublicKey(privateKey, compressed);
  const hash160 = ripemd160(sha256(publicKey));
  const payload = new Uint8Array(1 + hash160.length);
  payload[0] = version;
  payload.set(hash160, 1);
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload);
  full.set(checksum, payload.length);
  return bs58.encode(full);
}

const PRIVATE_KEY = new Uint8Array(32).fill(11);
const MESSAGE = "hello signmessage";

describe("magicHash", () => {
  it("matches bitcoinjs-message's magicHash output (captured cross-implementation vectors)", () => {
    // sha256d(0x18 || "Bitcoin Signed Message:\n" || CompactSize(msg) || msg),
    // captured from bitcoinjs-message@2.2.0's magicHash() before it was
    // removed - regression-pins wire compatibility with what every
    // Bitcoin-derived wallet computes.
    expect(Buffer.from(magicHash("", PREFIX)).toString("hex")).toBe(
      "80e795d4a4caadd7047af389d9f7f220562feb6196032e2131e10563352c4bcc",
    );
    expect(Buffer.from(magicHash("hello signmessage", PREFIX)).toString("hex")).toBe(
      "845bd979342a1e439d6f739140f41bac867e9bc8ea3578425ffb824562bde54d",
    );
  });

  it("uses byte length, not character count, for non-ASCII messages", () => {
    // "é" is 1 char but 2 UTF-8 bytes; a char-count varint would collide
    // these two distinct messages' framing.
    expect(magicHash("é", PREFIX)).not.toEqual(magicHash("e", PREFIX));
  });
});

describe("sign/verify round trip", () => {
  for (const compressed of [true, false]) {
    it(`round-trips with a ${compressed ? "compressed" : "uncompressed"} key`, () => {
      const address = addressFromPrivateKey(PRIVATE_KEY, compressed);
      const signature = signBitcoinStyleMessage({
        privateKey: PRIVATE_KEY,
        message: MESSAGE,
        messagePrefix: PREFIX,
        compressed,
      });
      expect(
        verifyBitcoinStyleSignedMessage({ address, message: MESSAGE, signatureBase64: signature, messagePrefix: PREFIX }),
      ).toBe(true);
    });
  }

  it("fails when the compression flag in the header doesn't match the address", () => {
    // Same key, but the address was derived from the uncompressed pubkey
    // while the signature claims compressed - different hash160s.
    const address = addressFromPrivateKey(PRIVATE_KEY, false);
    const signature = signBitcoinStyleMessage({
      privateKey: PRIVATE_KEY,
      message: MESSAGE,
      messagePrefix: PREFIX,
      compressed: true,
    });
    expect(
      verifyBitcoinStyleSignedMessage({ address, message: MESSAGE, signatureBase64: signature, messagePrefix: PREFIX }),
    ).toBe(false);
  });

  it("fails under a different message prefix", () => {
    const address = addressFromPrivateKey(PRIVATE_KEY, true);
    const signature = signBitcoinStyleMessage({
      privateKey: PRIVATE_KEY,
      message: MESSAGE,
      messagePrefix: PREFIX,
    });
    expect(
      verifyBitcoinStyleSignedMessage({
        address,
        message: MESSAGE,
        signatureBase64: signature,
        messagePrefix: "Raven Signed Message:\n",
      }),
    ).toBe(false);
  });
});

describe("verifyBitcoinStyleSignedMessage input handling", () => {
  const address = addressFromPrivateKey(PRIVATE_KEY, true);
  const signature = signBitcoinStyleMessage({ privateKey: PRIVATE_KEY, message: MESSAGE, messagePrefix: PREFIX });

  it("rejects signatures that aren't 65 bytes", () => {
    const short = Buffer.from(signature, "base64").subarray(0, 64).toString("base64");
    expect(
      verifyBitcoinStyleSignedMessage({ address, message: MESSAGE, signatureBase64: short, messagePrefix: PREFIX }),
    ).toBe(false);
  });

  it("rejects non-P2PKH header bytes (segwit range)", () => {
    const bytes = Buffer.from(signature, "base64");
    bytes[0] = 39; // segwit bech32 range - doesn't exist on Avian/Radiant
    expect(
      verifyBitcoinStyleSignedMessage({
        address,
        message: MESSAGE,
        signatureBase64: bytes.toString("base64"),
        messagePrefix: PREFIX,
      }),
    ).toBe(false);
  });

  it("rejects an address with a corrupted checksum", () => {
    const decoded = Buffer.from(bs58.decode(address));
    decoded[24] ^= 0xff;
    expect(
      verifyBitcoinStyleSignedMessage({
        address: bs58.encode(decoded),
        message: MESSAGE,
        signatureBase64: signature,
        messagePrefix: PREFIX,
      }),
    ).toBe(false);
  });

  it("returns false (not a throw) for garbage inputs", () => {
    expect(
      verifyBitcoinStyleSignedMessage({
        address: "not-an-address",
        message: MESSAGE,
        signatureBase64: "%%%",
        messagePrefix: PREFIX,
      }),
    ).toBe(false);
  });
});
