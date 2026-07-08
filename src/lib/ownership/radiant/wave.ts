import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { decodeRadiantAddress } from "./address";
import type { RadiantElectrumClient } from "./electrum-client";

const DEFAULT_LOOKUP_LIMIT = 1000;

/**
 * Builds the legacy P2PKH scriptPubKey for a hash160:
 * OP_DUP OP_HASH160 PUSH20 <hash160> OP_EQUALVERIFY OP_CHECKSIG.
 */
function p2pkhScriptPubKey(hash160: Uint8Array): Uint8Array {
  const script = new Uint8Array(25);
  script.set([0x76, 0xa9, 0x14], 0);
  script.set(hash160, 3);
  script.set([0x88, 0xac], 23);
  return script;
}

/**
 * RXinDexer/ElectrumX's "hashX" identifier: the first 11 bytes of
 * sha256(scriptPubKey), NOT reversed and NOT the same as the standard
 * Electrum wallet "scripthash" (which is the full 32-byte sha256, reversed).
 * Ported from the reference wave_reverse_lookup.py's hashx_from_scriptpubkey.
 * One-way - given only a hashX there is no way to recover the address it
 * came from, which is why verifyOwner below compares hashXes rather than
 * trying to turn a hashX back into an address.
 */
function electrumXHashX(scriptPubKey: Uint8Array): string {
  return bytesToHex(sha256(scriptPubKey).slice(0, 11));
}

/** Derives the ElectrumX owner hashX for a Radiant P2PKH address, or undefined if invalid. */
export function hashXFromRadiantAddress(address: string): string | undefined {
  const hash160 = decodeRadiantAddress(address);
  if (!hash160) return undefined;
  return electrumXHashX(p2pkhScriptPubKey(hash160));
}

/** "txid_vout" (as returned by wave.reverse_lookup) -> "txid:vout" (as glyph.get_token expects). */
function refToGlyphId(ref: string): string {
  const splitIndex = ref.lastIndexOf("_");
  if (splitIndex === -1) return ref;
  return `${ref.slice(0, splitIndex)}:${ref.slice(splitIndex + 1)}`;
}

interface WaveReverseLookupHit {
  ref?: string;
  owner?: string;
  zone?: unknown;
  name?: string;
  domain?: string;
  full_name?: string;
  [key: string]: unknown;
}

const NAME_KEYS = new Set(["name"]);
const DOMAIN_KEYS = new Set(["domain"]);

/** Recursively finds the first non-empty value under any of `keys`, depth-first. Mirrors deep_find_first in the reference script. */
function deepFindFirst(obj: unknown, keys: Set<string>): unknown {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindFirst(item, keys);
      if (found !== undefined && found !== null && found !== "") return found;
    }
    return undefined;
  }
  if (obj && typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      if (keys.has(key) && value !== undefined && value !== null && value !== "") return value;
    }
    for (const value of Object.values(obj)) {
      const found = deepFindFirst(value, keys);
      if (found !== undefined && found !== null && found !== "") return found;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * A name that already contains a dot is already fully-qualified (e.g.
 * wave.reverse_lookup's own `name` field comes back as "spacex.rxd", not
 * "spacex") - only bare labels get a domain appended. Getting this backwards
 * is exactly the bug in RXinDexer's own `full_name` field on reverse_lookup
 * hits, which double-suffixes to "spacex.rxd.rxd" - don't repeat it here.
 */
function qualify(name: string, domain: string | undefined): string {
  return name.includes(".") ? name : `${name}.${domain ?? "rxd"}`;
}

/**
 * Best-effort extraction of a Wave full name from a wave.reverse_lookup hit
 * or a glyph.get_token response - their exact shape varies, so this checks
 * several known layouts before falling back to a recursive search. Ported
 * from the reference script's extract_wave_name/deep_find_first, but returns
 * the resolved full name directly rather than separate name/domain parts to
 * avoid the double-suffix trap above.
 */
function extractWaveName(obj: unknown): string | undefined {
  const record = asRecord(obj);
  if (!record) return undefined;

  const name = asNonEmptyString(record.name);
  if (name) return qualify(name, asNonEmptyString(record.domain));

  // Only reached when `name` itself is absent. glyph.get_token's own
  // full_name has been observed as already correctly single-suffixed
  // ("craigd.rxd") in that case, so it's used as-is.
  const fullName = asNonEmptyString(record.full_name);
  if (fullName) return fullName;

  const attrs = asRecord(record.attrs);
  if (attrs) {
    const attrName = asNonEmptyString(attrs.name);
    if (attrName) return qualify(attrName, asNonEmptyString(attrs.domain));
  }

  const metadata = asRecord(record.metadata);
  if (metadata) {
    const metaName = asNonEmptyString(metadata.name);
    if (metaName) return qualify(metaName, asNonEmptyString(metadata.domain));

    const metaAttrs = asRecord(metadata.attrs);
    if (metaAttrs) {
      const metaAttrName = asNonEmptyString(metaAttrs.name);
      if (metaAttrName) return qualify(metaAttrName, asNonEmptyString(metaAttrs.domain));
    }
  }

  const token = asRecord(record.token);
  if (token) {
    const tokenName = extractWaveName(token);
    if (tokenName) return tokenName;
  }

  const deepName = asNonEmptyString(deepFindFirst(record, NAME_KEYS));
  if (deepName) return qualify(deepName, asNonEmptyString(deepFindFirst(record, DOMAIN_KEYS)));

  return undefined;
}

/**
 * Resolves all Wave names owned by `address` via RXinDexer's `wave.reverse_lookup`
 * (owner hashX -> refs) plus `glyph.get_token` enrichment when a hit doesn't
 * already carry its name - the same two-step lookup as the reference
 * wave_reverse_lookup.py tool. Returns full names like "bob.rxd".
 */
export async function getWaveNamesByOwner(
  client: RadiantElectrumClient,
  address: string,
  limit = DEFAULT_LOOKUP_LIMIT,
): Promise<string[]> {
  const hashX = hashXFromRadiantAddress(address);
  if (!hashX) return [];

  const hits = await client.call<WaveReverseLookupHit[] | null>("wave.reverse_lookup", [hashX, limit]);
  if (!hits || hits.length === 0) return [];

  const names: string[] = [];
  for (const hit of hits) {
    if (!hit || typeof hit !== "object" || !hit.ref) continue;

    let name = extractWaveName(hit);
    if (!name) {
      const token = await client.call<unknown>("glyph.get_token", [refToGlyphId(hit.ref)]).catch(() => undefined);
      name = extractWaveName(token);
    }
    if (name) names.push(name.toLowerCase());
  }
  return names.sort();
}

export interface WaveResolveResult {
  /** Bare label, e.g. "craigd" (unlike reverse_lookup's already-qualified `name`). */
  name?: string;
  ref?: string;
  /** The name's actual resolved owner address - use this, not `zone`, which is separate user-set DNS-style data. */
  target?: string;
  zone?: unknown;
  /** Truncated hashX, same one-way format as wave.reverse_lookup's `owner`. */
  owner?: string;
  available?: boolean;
}

const RXD_SUFFIX = ".rxd";

/**
 * Forward name -> owner lookup via RXinDexer's `wave.resolve`. Real example
 * (REST mirror of the same call, GET /wave/resolve/craigd.rxd):
 *   { name: "craigd", ref: "901a7118...ad4_0", target: "14XmXG3dSBWZUukGT3xzS9zxpiZ53vgx1i",
 *     zone: { address: "14XmXG3dSBWZUukGT3xzS9zxpiZ53vgx1i" },
 *     owner: "e4bf68e0c8eb9018f15fa0", available: false }
 *
 * Takes our full name (e.g. "craigd.rxd", matching what validateSourceName
 * normalizes names to) but strips the ".rxd" suffix before calling - unlike
 * the REST endpoint, which accepts "craigd.rxd" in its URL and strips it
 * server-side, the raw JSON-RPC method wants the bare label ("craigd") and
 * errors ("Invalid character: .") if given the suffixed form, confirmed
 * against a live call. Returns null if unregistered.
 */
export async function resolveWaveName(client: RadiantElectrumClient, name: string): Promise<WaveResolveResult | null> {
  const bareLabel = name.toLowerCase().endsWith(RXD_SUFFIX) ? name.slice(0, -RXD_SUFFIX.length) : name;
  const result = await client.call<WaveResolveResult | null>("wave.resolve", [bareLabel]);
  return result ?? null;
}
