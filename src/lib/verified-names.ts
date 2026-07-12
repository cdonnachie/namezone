import { prisma } from "@/lib/db";
import { normalize } from "@/lib/dns/validation";

/**
 * Core-team verified names: an operator-curated registry marking which names
 * are genuinely run by a chain's core team, so visitors can distinguish an
 * official site from any other owner's (the "I own brand.avn but a stranger
 * owning it wouldn't be sanctioned" problem).
 *
 * Configured via VERIFIED_TEAM_NAMES, a JSON map of full source name -> the
 * team-held owner address (one flat map covers every namespace, since names
 * carry their TLD):
 *   VERIFIED_TEAM_NAMES={"brand.avn":"RTeamAddr...","brand.rxd":"1TeamAddr..."}
 *
 * A name only counts as verified while its CURRENT owner matches the
 * configured address - checked against the ClaimedName cache, which the
 * per-visit ownership checks and the background watcher keep honest. Selling
 * the asset drops the badge automatically (the watcher marks the row
 * TRANSFERRED within one sweep); revocation is just editing the env var.
 * The cache deliberately stands in for a live chain lookup so the public
 * surfaces (lookup page, /official, the JSON API) never fan out to chain RPC.
 */

/** Parses the VERIFIED_TEAM_NAMES JSON map; malformed config verifies nobody. */
export function parseVerifiedTeamNames(
  raw: string | undefined = process.env.VERIFIED_TEAM_NAMES,
): Map<string, string> {
  const entries = new Map<string, string>();
  if (!raw?.trim()) return entries;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[verified-names] VERIFIED_TEAM_NAMES is not valid JSON; treating as empty.");
    return entries;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.error("[verified-names] VERIFIED_TEAM_NAMES must be a JSON object; treating as empty.");
    return entries;
  }
  for (const [name, address] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof address === "string" && address.trim()) {
      entries.set(normalize(name), address.trim());
    }
  }
  return entries;
}

/** The configured team addresses for names under one namespace's TLD. */
export function configuredVerifiedNamesFor(
  ns: Pick<VerifiedNamespace, "tld">,
  config: Map<string, string> = parseVerifiedTeamNames(),
): Map<string, string> {
  const suffix = `.${ns.tld}`;
  return new Map([...config].filter(([name]) => name.endsWith(suffix)));
}

interface VerifiedNamespace {
  key: string;
  tld: string;
}

/** True while `name` is on the verified list AND its current owner matches. */
export async function isVerifiedTeamName(ns: VerifiedNamespace, name: string): Promise<boolean> {
  const expected = configuredVerifiedNamesFor(ns).get(normalize(name));
  if (!expected) return false;
  const row = await prisma.claimedName.findUnique({
    where: { namespace_name: { namespace: ns.key, name: normalize(name) } },
  });
  return !!row && row.status === "ACTIVE" && row.ownerAddress === expected;
}

/**
 * The namespace's currently-verified names, sorted. Configured names that
 * fail verification (transferred, never claimed) are silently omitted - no
 * "formerly official" leakage on public surfaces.
 */
export async function listVerifiedTeamNames(ns: VerifiedNamespace): Promise<string[]> {
  const configured = configuredVerifiedNamesFor(ns);
  if (configured.size === 0) return [];
  const rows = await prisma.claimedName.findMany({
    where: { namespace: ns.key, name: { in: [...configured.keys()] }, status: "ACTIVE" },
  });
  return rows
    .filter((row) => row.ownerAddress === configured.get(row.name))
    .map((row) => row.name)
    .sort();
}
