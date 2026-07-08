import { describe, expect, it } from "vitest";
import { isValidRadiantAddress } from "./address";

// Radiant kept Bitcoin's exact address format (legacy P2PKH, version byte
// 0x00), so any real, well-known Bitcoin legacy address exercises the same
// base58check/version-byte logic without needing a live Radiant address.
const BITCOIN_GENESIS_ADDRESS = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"; // version 0x00
const BITCOIN_P2SH_ADDRESS = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"; // version 0x05, valid checksum, wrong version

describe("isValidRadiantAddress", () => {
  it("accepts a well-formed legacy P2PKH address", () => {
    expect(isValidRadiantAddress(BITCOIN_GENESIS_ADDRESS)).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(isValidRadiantAddress(`  ${BITCOIN_GENESIS_ADDRESS}  `)).toBe(true);
  });

  it("rejects a checksum-valid address with the wrong version byte (P2SH, not P2PKH)", () => {
    expect(isValidRadiantAddress(BITCOIN_P2SH_ADDRESS)).toBe(false);
  });

  it("rejects a tampered checksum", () => {
    const tampered = `${BITCOIN_GENESIS_ADDRESS.slice(0, -1)}${BITCOIN_GENESIS_ADDRESS.endsWith("a") ? "b" : "a"}`;
    expect(isValidRadiantAddress(tampered)).toBe(false);
  });

  it("rejects a truncated address", () => {
    expect(isValidRadiantAddress(BITCOIN_GENESIS_ADDRESS.slice(0, -3))).toBe(false);
  });

  it("rejects characters outside the base58 alphabet", () => {
    expect(isValidRadiantAddress("0OIl-not-base58")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidRadiantAddress("")).toBe(false);
  });
});
