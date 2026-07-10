import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { getSession } from "@/lib/auth/session";
import { isEmailEnabledName } from "@/lib/dns/email";
import { lookupPublicDns, normalizeDohAnswer, type DohRecordType } from "@/lib/dns/doh";
import { relativeHostToFqdn, validateRelativeHost } from "@/lib/dns/validation";
import { getNamespace } from "@/lib/namespaces";
import { requireClaimedNameOwnership } from "@/lib/ownership/sync";
import { checkRateLimit } from "@/lib/rate-limit";

const VERIFY_TYPES: readonly DohRecordType[] = ["A", "AAAA", "CNAME", "MX", "TXT"];

/**
 * POST /api/[namespace]/dns/[name]/verify
 *
 * Read-only propagation check: asks a public resolver (Cloudflare, falling
 * back to Google) whether a record is visible to the wider internet yet, and
 * whether the visible value matches what we have. This is what separates
 * "Synced" (written to our PowerDNS) from "the internet can actually see it" -
 * the gap novice users most often fall into.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ namespace: string; name: string }> },
) {
  try {
    const { namespace: key, name: rawName } = await params;
    const ns = getNamespace(key);

    const session = await getSession(ns.key);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    // Ownership required so this can't be used as an anonymous DoH proxy.
    const auth = await requireClaimedNameOwnership(ns, decodeURIComponent(rawName), session.address);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const rate = await checkRateLimit(`dns-verify:${session.address}`, 30);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: `Too many checks. Try again in ${rate.retryAfterSeconds}s.` },
        { status: 429 },
      );
    }

    const body = (await req.json()) as { hostname?: string; type?: string; value?: string };
    const type = body.type?.trim().toUpperCase() as DohRecordType;
    if (!VERIFY_TYPES.includes(type)) {
      return NextResponse.json({ error: "Unsupported record type." }, { status: 400 });
    }

    const emailEnabled = isEmailEnabledName(auth.name);
    const hostResult = validateRelativeHost(body.hostname ?? "", { allowEmailLabels: emailEnabled });
    if (!hostResult.ok) {
      return NextResponse.json({ error: hostResult.error }, { status: 400 });
    }
    const fqdn = relativeHostToFqdn(hostResult.value, auth.name, ns, { allowEmailLabels: emailEnabled });

    const { resolver, answers } = await lookupPublicDns(fqdn, type);

    // Normalize the expected value the same way the resolver answers are.
    const expected = body.value ? normalizeDohAnswer(type, body.value) : null;
    const visible = answers.length > 0;
    const matched = expected !== null && answers.includes(expected);

    return NextResponse.json({ fqdn, type, resolver, visible, matched, answers });
  } catch (err) {
    return handleApiError(err, "Failed to check the record. The public resolver may be unreachable.");
  }
}
