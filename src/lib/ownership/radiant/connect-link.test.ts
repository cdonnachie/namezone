import { describe, expect, it } from "vitest";
import { buildPhotonicConnectUrl } from "./connect-link";

function reqParam(url: string): string {
  const match = /[?&]req=([^&]+)/.exec(url);
  if (!match) throw new Error("no req param found");
  return match[1];
}

function decodeReqParam(url: string): Record<string, unknown> {
  const base64 = reqParam(url).replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
}

describe("buildPhotonicConnectUrl", () => {
  const params = {
    challenge: "radiant:wallet-connect:v1:abc:hello",
    address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
    origin: "https://rxd.zone",
  };

  it("points at Photonic's connect route with a req param", () => {
    const url = buildPhotonicConnectUrl(params);
    expect(url.startsWith("https://photonic-wallet.com/#/connect?req=")).toBe(true);
  });

  it("encodes a base64url SignRequest envelope with no padding/unsafe chars", () => {
    const url = buildPhotonicConnectUrl(params);
    expect(reqParam(url)).not.toMatch(/[+/=]/);
  });

  it("round-trips the challenge, origin, address, and app label", () => {
    const url = buildPhotonicConnectUrl(params);
    expect(decodeReqParam(url)).toMatchObject({
      protocol: "photonic-connect",
      v: 1,
      t: "sign-request",
      challenge: params.challenge,
      origin: params.origin,
      app: "Radiant Wave Zone",
      address: params.address,
    });
  });

  it("carries the callback URL when given", () => {
    const url = buildPhotonicConnectUrl({
      ...params,
      callback: "https://rxd.zone/radiant/photonic-callback",
    });
    expect(decodeReqParam(url).callback).toBe("https://rxd.zone/radiant/photonic-callback");
  });

  it("omits the callback key entirely when absent or blank", () => {
    expect(decodeReqParam(buildPhotonicConnectUrl(params))).not.toHaveProperty("callback");
    expect(decodeReqParam(buildPhotonicConnectUrl({ ...params, callback: "" }))).not.toHaveProperty(
      "callback",
    );
  });
});
