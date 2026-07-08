import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import bs58 from "bs58";
import * as varuint from "varuint-bitcoin";

/**
 * Bitcoin-style "signmessage" signing and verification, shared by every
 * UTXO-chain namespace (Avian, Radiant). Replaces the unmaintained
 * bitcoinjs-message -> secp256k1 -> elliptic dependency chain with
 * @noble/curves, which is audited, actively maintained, and already used by
 * the Radiant address code. Verified byte-for-byte compatible against a real
 * Avian Core signmessage signature (see avian/message.test.ts's REAL_*
 * fixtures).
 *
 * The scheme (Bitcoin Core's src/util/message.cpp, mirrored by every fork):
 *   hash  = sha256d(CompactSize(prefix) || prefix || CompactSize(msg) || msg)
 *   sig   = 65 bytes: header || r || s, base64-encoded, where
 *   header = 27 + recoveryId (0..3) + (4 if the pubkey is compressed)
 * Verification recovers the public key from (hash, sig) and compares its
 * hash160 against the one inside the claimed base58check address - the
 * address's version byte itself is chain-specific and irrelevant here.
 */

/** sha256d of both strings serialized with Bitcoin's CompactSize length prefix. */
export function magicHash(message: string, rawPrefix: string): Uint8Array {
  const prefixBytes = Buffer.from(rawPrefix, "utf8");
  const messageBytes = Buffer.from(message, "utf8");
  const payload = Buffer.concat([
    Buffer.from(varuint.encode(prefixBytes.length).buffer),
    prefixBytes,
    Buffer.from(varuint.encode(messageBytes.length).buffer),
    messageBytes,
  ]);
  return sha256(sha256(payload));
}

/**
 * Base58check-decodes any single-version-byte P2PKH address and returns its
 * 20-byte hash160, or undefined if the encoding/checksum/length is invalid.
 * Deliberately version-agnostic: Avian uses 0x3c ("R..."), Radiant 0x00
 * ("1...") - which chain the address belongs to is the caller's concern.
 */
function hash160FromBase58Address(address: string): Uint8Array | undefined {
  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(address);
  } catch {
    return undefined;
  }
  if (decoded.length !== 25) return undefined; // 1 version + 20 hash160 + 4 checksum
  const payload = decoded.subarray(0, 21);
  const checksum = decoded.subarray(21);
  const expected = sha256(sha256(payload)).subarray(0, 4);
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expected[i]) return undefined;
  }
  return payload.subarray(1);
}

/**
 * Verifies a base64 signmessage signature against a P2PKH address.
 * Returns false (never throws) on any malformed input. Only legacy P2PKH
 * header bytes (27..34) are accepted - segwit variants (35..42) don't exist
 * on Avian/Radiant.
 */
export function verifyBitcoinStyleSignedMessage(params: {
  address: string;
  message: string;
  signatureBase64: string;
  messagePrefix: string;
}): boolean {
  try {
    const addressHash160 = hash160FromBase58Address(params.address);
    if (!addressHash160) return false;

    const sigBytes = Buffer.from(params.signatureBase64, "base64");
    if (sigBytes.length !== 65) return false;
    const header = sigBytes[0];
    if (header < 27 || header > 34) return false;
    const recoveryId = (header - 27) & 3;
    const compressed = header >= 31;

    const signature = secp256k1.Signature.fromBytes(sigBytes.subarray(1), "compact").addRecoveryBit(recoveryId);
    const publicKey = signature.recoverPublicKey(magicHash(params.message, params.messagePrefix)).toBytes(compressed);
    const recoveredHash160 = ripemd160(sha256(publicKey));

    for (let i = 0; i < 20; i++) {
      if (recoveredHash160[i] !== addressHash160[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Produces a signmessage-compatible base64 signature (RFC6979 deterministic,
 * low-S, matching Bitcoin Core). Currently only exercised by tests - the
 * server never holds user private keys - but kept alongside verify so the
 * two halves of the scheme stay in one place.
 */
export function signBitcoinStyleMessage(params: {
  privateKey: Uint8Array;
  message: string;
  messagePrefix: string;
  compressed?: boolean;
}): string {
  const compressed = params.compressed ?? true;
  const hash = magicHash(params.message, params.messagePrefix);
  // "recovered" format = 65 bytes: recoveryId (0..3) || r || s
  const recovered = secp256k1.sign(hash, params.privateKey, { prehash: false, format: "recovered" });
  const header = 27 + recovered[0] + (compressed ? 4 : 0);
  return Buffer.concat([Buffer.from([header]), recovered.subarray(1)]).toString("base64");
}
