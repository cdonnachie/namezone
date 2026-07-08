import { beforeAll, describe, expect, it } from "vitest";
import { createStepUpToken, verifyStepUpToken } from "./step-up";
import { createSessionToken } from "./session";

// The token functions sign with AUTH_SECRET; set a valid one for the suite.
beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long-xx";
});

const NS = "radiant";
const ADDR = "14XmXG3dSBWZUukGT3xzS9zxpiZ53vgx1i";

describe("step-up token", () => {
  it("verifies a fresh token for the same namespace + address", async () => {
    const token = await createStepUpToken(NS, ADDR);
    expect(await verifyStepUpToken(token, NS, ADDR)).toBe(true);
  });

  it("rejects a token for a different address", async () => {
    const token = await createStepUpToken(NS, ADDR);
    expect(await verifyStepUpToken(token, NS, "1OtherAddressXXXXXXXXXXXXXXXXXXXXXX")).toBe(false);
  });

  it("rejects a token minted for a different namespace (no cross-namespace reuse)", async () => {
    const token = await createStepUpToken(NS, ADDR);
    expect(await verifyStepUpToken(token, "avian", ADDR)).toBe(false);
  });

  it("rejects a plain session token as a step-up token (purpose is enforced)", async () => {
    // A hijacked session cookie must not double as step-up proof.
    const sessionToken = await createSessionToken(NS, ADDR);
    expect(await verifyStepUpToken(sessionToken, NS, ADDR)).toBe(false);
  });

  it("rejects a garbage / tampered token without throwing", async () => {
    expect(await verifyStepUpToken("not.a.jwt", NS, ADDR)).toBe(false);
    const token = await createStepUpToken(NS, ADDR);
    expect(await verifyStepUpToken(`${token}x`, NS, ADDR)).toBe(false);
  });
});
