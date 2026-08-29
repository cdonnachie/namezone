import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createHandoffToken,
  getHandoffApp,
  isAllowedRedirectUri,
  isHandoffEnabled,
  verifyHandoffToken,
} from "./handoff";

const SECRET = "s".repeat(40);
const REDIRECT = "https://create.rxd.zone/api/auth/wave/callback";

const ENV_KEYS = [
  "HANDOFF_SECRET",
  "HANDOFF_REDIRECT_URIS",
  "HANDOFF_APP_ID",
  "HANDOFF_APP_NAME",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.HANDOFF_SECRET = SECRET;
  process.env.HANDOFF_REDIRECT_URIS = REDIRECT;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("handoff configuration", () => {
  it("is enabled once a secret and a redirect target are set", () => {
    expect(isHandoffEnabled()).toBe(true);
    expect(getHandoffApp()?.id).toBe("wave-creator");
  });

  it("is disabled without a redirect allowlist", () => {
    process.env.HANDOFF_REDIRECT_URIS = "";
    expect(isHandoffEnabled()).toBe(false);
  });

  it("rejects a secret too short to resist an offline brute-force", () => {
    process.env.HANDOFF_SECRET = "short";
    expect(isHandoffEnabled()).toBe(false);
  });

  it("takes app identity from the environment", () => {
    process.env.HANDOFF_APP_ID = "other-app";
    process.env.HANDOFF_APP_NAME = "Other App";
    expect(getHandoffApp()).toMatchObject({ id: "other-app", name: "Other App" });
  });
});

describe("isAllowedRedirectUri", () => {
  const app = { id: "wave-creator", name: "Wave Creator", redirectUris: [REDIRECT] };

  it("accepts an exact match", () => {
    expect(isAllowedRedirectUri(REDIRECT, app)).toBe(true);
  });

  it("rejects a lookalike host that merely starts with an allowed one", () => {
    expect(isAllowedRedirectUri("https://create.rxd.zone.evil.test/api/auth/wave/callback", app)).toBe(false);
  });

  it("rejects a different path on an allowed host", () => {
    expect(isAllowedRedirectUri("https://create.rxd.zone/anything-else", app)).toBe(false);
  });

  it("rejects an empty target", () => {
    expect(isAllowedRedirectUri("", app)).toBe(false);
  });
});

describe("handoff tokens", () => {
  const app = { id: "wave-creator", name: "Wave Creator", redirectUris: [REDIRECT] };

  it("round-trips the address and namespace", async () => {
    const token = await createHandoffToken({ namespace: "radiant", address: "1Owner", app });
    expect(token).toBeTruthy();
    await expect(verifyHandoffToken(token!)).resolves.toMatchObject({
      address: "1Owner",
      namespace: "radiant",
      app: "wave-creator",
    });
  });

  it("does not verify under a different secret", async () => {
    const token = await createHandoffToken({ namespace: "radiant", address: "1Owner", app });
    process.env.HANDOFF_SECRET = "d".repeat(40);
    await expect(verifyHandoffToken(token!)).resolves.toBeNull();
  });

  it("rejects a session token, which carries the same claim shape", async () => {
    // The whole reason handoff uses its own secret: were both signed with
    // AUTH_SECRET, these two token types would be interchangeable.
    const { SignJWT } = await import("jose");
    const sessionShaped = await new SignJWT({ address: "1Owner", namespace: "radiant", app: "wave-creator" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(new TextEncoder().encode(SECRET));
    // Same key, but no handoff audience.
    await expect(verifyHandoffToken(sessionShaped)).resolves.toBeNull();
  });

  it("rejects a malformed token", async () => {
    await expect(verifyHandoffToken("not.a.token")).resolves.toBeNull();
  });

  it("mints a distinct jti each time, so a replay is detectable downstream", async () => {
    const [a, b] = await Promise.all([
      createHandoffToken({ namespace: "radiant", address: "1Owner", app }),
      createHandoffToken({ namespace: "radiant", address: "1Owner", app }),
    ]);
    expect(a).not.toBe(b);
  });
});
