import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { sourceNameToBaseFqdn } from "@/lib/dns/validation";
import { getNamespace } from "@/lib/namespaces";
import { listVerifiedTeamNames } from "@/lib/verified-names";

/**
 * Public list of core-team verified names for one namespace, for explorers,
 * wallets, and community tools. Only names passing live verification (on the
 * list AND currently owned by the registered team address) are returned.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ namespace: string }> }) {
  try {
    const { namespace: key } = await params;
    const ns = getNamespace(key);

    const verified = await listVerifiedTeamNames(ns);
    const names = verified.map((name) => ({
      name,
      zone: sourceNameToBaseFqdn(name, ns).replace(/\.$/, ""),
    }));

    return NextResponse.json(
      { namespace: ns.key, names },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (err) {
    return handleApiError(err, "Failed to load verified names.");
  }
}
