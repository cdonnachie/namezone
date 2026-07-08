import { sha256 } from "@noble/hashes/sha2.js";
import bs58 from "bs58";

// 1-byte version + 20-byte hash160 + 4-byte checksum.
const P2PKH_DECODED_LENGTH = 25;
// Radiant kept Bitcoin's original address format rather than assigning its
// own version byte the way Avian/Ravencoin did, so mainnet addresses are
// legacy P2PKH and start with "1", same as Bitcoin.
const RADIANT_P2PKH_VERSION = 0x00;

function doubleSha256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((byte, i) => byte === b[i]);
}

/**
 * Decodes a base58check-encoded Radiant address into its 20-byte hash160,
 * or returns undefined if it isn't a well-formed legacy P2PKH address
 * (decodable, correct length, valid checksum, correct version byte). Pure
 * computation - no RPC/Electrum call needed.
 */
export function decodeRadiantAddress(address: string): Uint8Array | undefined {
  if (!address) return undefined;
  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(address.trim());
  } catch {
    return undefined;
  }
  if (decoded.length !== P2PKH_DECODED_LENGTH) return undefined;

  const payload = decoded.slice(0, decoded.length - 4);
  const checksum = decoded.slice(decoded.length - 4);
  const expectedChecksum = doubleSha256(payload).slice(0, 4);
  if (!bytesEqual(checksum, expectedChecksum)) return undefined;
  if (payload[0] !== RADIANT_P2PKH_VERSION) return undefined;

  return payload.slice(1);
}

export function isValidRadiantAddress(address: string): boolean {
  return decodeRadiantAddress(address) !== undefined;
}
