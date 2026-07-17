import { describe, expect, it } from "vitest";
import { extractChallengeNonce, parseCallbackHash } from "./photonic-callback";

describe("extractChallengeNonce", () => {
  it("pulls the hex nonce out of a real challenge message", () => {
    const message =
      "radiant:wallet-connect:v1:a1b2c3d4e5f60718293a4b5c6d7e8f90:Radiant Wave Zone wants you to sign in...";
    expect(extractChallengeNonce(message)).toBe("a1b2c3d4e5f60718293a4b5c6d7e8f90");
  });

  it("returns null for messages without the connect prefix", () => {
    expect(extractChallengeNonce("Avian Name Zone login challenge")).toBeNull();
    expect(extractChallengeNonce("")).toBeNull();
  });
});

describe("parseCallbackHash", () => {
  it("parses a full fragment with or without the leading #", () => {
    const expected = { nonce: "abc123", address: "1Boat", signature: "c2ln" };
    expect(parseCallbackHash("#nonce=abc123&address=1Boat&signature=c2ln")).toEqual(expected);
    expect(parseCallbackHash("nonce=abc123&address=1Boat&signature=c2ln")).toEqual(expected);
  });

  it("URL-decodes values (base64 signatures contain + and =)", () => {
    const p = parseCallbackHash("#nonce=n&address=a&signature=AB%2BcD%3D%3D");
    expect(p?.signature).toBe("AB+cD==");
  });

  it("returns null when any field is missing", () => {
    expect(parseCallbackHash("#address=a&signature=s")).toBeNull();
    expect(parseCallbackHash("#nonce=n&signature=s")).toBeNull();
    expect(parseCallbackHash("#nonce=n&address=a")).toBeNull();
    expect(parseCallbackHash("")).toBeNull();
  });
});
