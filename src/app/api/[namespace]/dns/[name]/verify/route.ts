import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
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
 *
 * Two modes:
 *  - { hostname, type, value }: check one record.
 *  - { all: true }: check every active record for this name (ACME challenge
 *    TXTs included) in one request. Lookups are grouped per (fqdn, type)
 *    rrset, so e.g. four apex A records cost a single DNS query.
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

    const body = (await req.json()) as {
      all?: boolean;
      hostname?: string;
      type?: string;
      value?: string;
    };

    if (body.all === true) {
      return NextResponse.json(await verifyAllRecords(ns.key, auth.name));
    }

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

async function verifyAllRecords(namespaceKey: string, claimedName: string) {
  // Includes ACME challenge TXTs - "is my challenge visible yet?" is the
  // propagation question people ask most (certbot waits on exactly this).
  const records = await prisma.dnsRecord.findMany({
    where: { namespace: namespaceKey, claimedName, status: "ACTIVE" },
  });

  // One lookup per (fqdn, type) rrset - every value at that name/type comes
  // back in a single answer set.
  const groups = new Map<string, { fqdn: string; type: DohRecordType }>();
  for (const r of records) {
    if (!VERIFY_TYPES.includes(r.type as DohRecordType)) continue;
    groups.set(`${r.fqdn}|${r.type}`, { fqdn: r.fqdn, type: r.type as DohRecordType });
  }

  const lookups = new Map<string, { answers: string[]; resolver: string } | null>();
  await Promise.all(
    [...groups.entries()].map(async ([groupKey, { fqdn, type }]) => {
      try {
        lookups.set(groupKey, await lookupPublicDns(fqdn, type));
      } catch {
        lookups.set(groupKey, null); // resolver unreachable; report as failed, not "missing"
      }
    }),
  );

  const results = records
    .filter((r) => VERIFY_TYPES.includes(r.type as DohRecordType))
    .map((r) => {
      const lookup = lookups.get(`${r.fqdn}|${r.type}`);
      if (!lookup) {
        return { id: r.id, fqdn: r.fqdn, type: r.type, visible: false, matched: false, answers: [], failed: true };
      }
      const expected = normalizeDohAnswer(r.type as DohRecordType, r.value);
      return {
        id: r.id,
        fqdn: r.fqdn,
        type: r.type,
        visible: lookup.answers.length > 0,
        matched: lookup.answers.includes(expected),
        answers: lookup.answers,
        resolver: lookup.resolver,
      };
    });

  return { results };
}
