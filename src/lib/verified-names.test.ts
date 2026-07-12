import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configuredVerifiedNamesFor, parseVerifiedTeamNames } from "./verified-names";

// Calling parseVerifiedTeamNames(undefined) falls through to process.env via
// the default parameter, so clear any ambient VERIFIED_TEAM_NAMES (e.g. from
// the developer's .env) for the duration of this suite.
const savedEnv = process.env.VERIFIED_TEAM_NAMES;
beforeAll(() => {
  delete process.env.VERIFIED_TEAM_NAMES;
});
afterAll(() => {
  if (savedEnv !== undefined) process.env.VERIFIED_TEAM_NAMES = savedEnv;
});

describe("parseVerifiedTeamNames", () => {
  it("returns empty for unset or blank config", () => {
    expect(parseVerifiedTeamNames(undefined).size).toBe(0);
    expect(parseVerifiedTeamNames("").size).toBe(0);
    expect(parseVerifiedTeamNames("   ").size).toBe(0);
  });

  it("returns empty for malformed JSON rather than throwing", () => {
    expect(parseVerifiedTeamNames("{not json").size).toBe(0);
  });

  it("returns empty for JSON that is not an object", () => {
    expect(parseVerifiedTeamNames('["brand.avn"]').size).toBe(0);
    expect(parseVerifiedTeamNames('"brand.avn"').size).toBe(0);
  });

  it("normalizes names and trims addresses", () => {
    const config = parseVerifiedTeamNames('{" Brand.AVN ":" RTeamAddr "}');
    expect(config.get("brand.avn")).toBe("RTeamAddr");
  });

  it("drops entries with missing or non-string addresses", () => {
    const config = parseVerifiedTeamNames('{"a.avn":"", "b.avn":42, "c.avn":"RAddr"}');
    expect(config.size).toBe(1);
    expect(config.get("c.avn")).toBe("RAddr");
  });
});

describe("configuredVerifiedNamesFor", () => {
  const config = parseVerifiedTeamNames(
    '{"brand.avn":"RTeamAddr","demo.avn":"RTeamAddr2","brand.rxd":"1TeamAddr"}',
  );

  it("filters the flat map down to one namespace's TLD", () => {
    const avian = configuredVerifiedNamesFor({ tld: "avn" }, config);
    expect([...avian.keys()].sort()).toEqual(["brand.avn", "demo.avn"]);
    const radiant = configuredVerifiedNamesFor({ tld: "rxd" }, config);
    expect([...radiant.keys()]).toEqual(["brand.rxd"]);
  });

  it("returns empty for a TLD with no configured names", () => {
    expect(configuredVerifiedNamesFor({ tld: "mewc" }, config).size).toBe(0);
  });

  it("does not suffix-match across TLD boundaries", () => {
    // "xavn" must not pick up ".avn" names - the dot is part of the suffix.
    const withTrick = parseVerifiedTeamNames('{"brand.xavn":"RAddr"}');
    expect(configuredVerifiedNamesFor({ tld: "avn" }, withTrick).size).toBe(0);
  });
});
