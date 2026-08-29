import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { relativeHostToFqdn, validateCnameTarget, validateRelativeHost } from "@/lib/dns/validation";
import { getNamespace, type NamespaceConfig } from "@/lib/namespaces";
import { requireClaimedNameOwnership } from "@/lib/ownership/sync";
import { checkRateLimit } from "@/lib/rate-limit";
import { hasManagedRedirectAt } from "@/lib/redirect/service";
import { isSelfHostingEnabled, isSiteFeatureEnabled, MAX_SITES_PER_NAME } from "@/lib/site/constants";
import { hasNonSiteRecordAt, removeSiteDnsRecords, SiteConflictError, writeSiteDnsRecords, type SiteTarget } from "@/lib/site/service";
import { prisma } from "@/lib/db";

// Prisma, PowerDNS and the chain adapters require the Node.js runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Shared-secret gate for every method here. Mandatory: this one writes DNS. */
function authorized(req: Request): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || secret.length < 32) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const provided = authHeader.replace(/^Bearer\s+/i, "") || req.headers.get("x-internal-secret") || "";
  return safeCompare(provided, secret);
}

interface ResolvedTarget {
  ns: NamespaceConfig;
  name: string;
  fqdn: string;
  relativeHost: string;
}

/**
 * Resolves {namespace, name, address, hostname} to a writable fqdn, re-checking
 * on-chain ownership every time.
 *
 * The address is supplied by the caller rather than read from a session, so the
 * ownership check is the ONLY thing standing between a companion app and
 * someone else's name. It is deliberately re-run on every call: a session
 * minted an hour ago is not evidence the address still owns the name now.
 */
async function resolveTarget(body: {
  namespace?: unknown;
  name?: unknown;
  address?: unknown;
  hostname?: unknown;
}): Promise<ResolvedTarget | NextResponse> {
  const ns = getNamespace(typeof body.namespace === "string" ? body.namespace : "");

  const address = typeof body.address === "string" ? body.address.trim() : "";
  const rawName = typeof body.name === "string" ? body.name : "";
  if (!address || !rawName) {
    return NextResponse.json({ error: "name and address are required." }, { status: 400 });
  }

  const auth = await requireClaimedNameOwnership(ns, rawName, address);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const hostResult = validateRelativeHost(typeof body.hostname === "string" && body.hostname ? body.hostname : "@");
  if (!hostResult.ok) {
    return NextResponse.json({ error: hostResult.error }, { status: 400 });
  }

  return {
    ns,
    name: auth.name,
    relativeHost: hostResult.value,
    fqdn: relativeHostToFqdn(hostResult.value, auth.name, ns),
  };
}

/**
 * Websites published under a name:
 *   GET /api/internal/sites?namespace=radiant&name=bob.rxd&address=<addr>
 */
export async function GET(req: Request) {
  try {
    if (!authorized(req)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (!isSiteFeatureEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const resolved = await resolveTarget({
      namespace: searchParams.get("namespace"),
      name: searchParams.get("name"),
      address: searchParams.get("address"),
      hostname: "@",
    });
    if (resolved instanceof NextResponse) return resolved;

    const sites = await prisma.managedSite.findMany({
      where: { namespace: resolved.ns.key, claimedName: resolved.name },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      selfHostingAvailable: isSelfHostingEnabled(resolved.ns.key),
      sites: sites.map((s) => ({
        fqdn: s.fqdn.replace(/\.$/, ""),
        hostname: s.relativeHost,
        target: s.target,
        cnameTarget: s.cnameTarget,
        status: s.status,
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleApiError(err, "Failed to load sites.");
  }
}

/**
 * Point a hostname at a published website:
 *   POST /api/internal/sites
 *   { namespace, name, address, hostname?, target: "SELF_HOSTED" | "EXTERNAL", cnameTarget? }
 *
 * Idempotent: publishing to the same hostname twice rewrites the records
 * rather than failing, which is what a redeploy needs.
 */
export async function POST(req: Request) {
  try {
    if (!authorized(req)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (!isSiteFeatureEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const resolved = await resolveTarget(body);
    if (resolved instanceof NextResponse) return resolved;
    const { ns, name, fqdn, relativeHost } = resolved;

    const rateLimit = await checkRateLimit(`internal-sites:${name}`, 20, 60_000);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: "Too many publishes for this name." }, { status: 429 });
    }

    let target: SiteTarget;
    if (body.target === "SELF_HOSTED") {
      if (!isSelfHostingEnabled(ns.key)) {
        return NextResponse.json({ error: "Self-hosting is not configured on this server." }, { status: 400 });
      }
      target = { kind: "SELF_HOSTED" };
    } else if (body.target === "EXTERNAL") {
      const value = validateCnameTarget(typeof body.cnameTarget === "string" ? body.cnameTarget : "", fqdn, name, ns);
      if (!value.ok) return NextResponse.json({ error: value.error }, { status: 400 });
      target = { kind: "EXTERNAL", cnameTarget: value.value };
    } else {
      return NextResponse.json({ error: 'target must be "SELF_HOSTED" or "EXTERNAL".' }, { status: 400 });
    }

    // A redirect owns its hostname exclusively, and vice versa.
    if (await hasManagedRedirectAt(ns.key, fqdn)) {
      return NextResponse.json(
        { error: "A URL redirect already exists at this hostname. Delete it before publishing here." },
        { status: 409 },
      );
    }
    if (await hasNonSiteRecordAt(ns.key, fqdn)) {
      return NextResponse.json(
        { error: "A DNS record already exists at this hostname. Delete it before publishing here." },
        { status: 409 },
      );
    }

    const existing = await prisma.managedSite.findUnique({
      where: { namespace_fqdn: { namespace: ns.key, fqdn } },
    });
    if (!existing) {
      const count = await prisma.managedSite.count({
        where: { namespace: ns.key, claimedName: name, status: "ACTIVE" },
      });
      if (count >= MAX_SITES_PER_NAME) {
        return NextResponse.json(
          { error: `Maximum of ${MAX_SITES_PER_NAME} published websites per name reached.` },
          { status: 400 },
        );
      }
    }

    // Row first, then DNS: writeSiteDnsRecords stamps records isManagedSite,
    // and reconcile re-derives that flag from this row. If DNS then fails, an
    // ACTIVE row with no records is harmless and self-heals on the next
    // publish; records with no row would look like hand-typed ones forever.
    await prisma.managedSite.upsert({
      where: { namespace_fqdn: { namespace: ns.key, fqdn } },
      create: {
        namespace: ns.key,
        claimedName: name,
        fqdn,
        relativeHost,
        target: target.kind,
        cnameTarget: target.kind === "EXTERNAL" ? target.cnameTarget : null,
        createdByWallet: String(body.address),
      },
      update: {
        target: target.kind,
        cnameTarget: target.kind === "EXTERNAL" ? target.cnameTarget : null,
        status: "ACTIVE",
        disabledReason: null,
        relativeHost,
        claimedName: name,
      },
    });

    try {
      await writeSiteDnsRecords(ns, name, fqdn, relativeHost, target);
    } catch (err) {
      if (err instanceof SiteConflictError) {
        if (!existing) {
          await prisma.managedSite.deleteMany({ where: { namespace: ns.key, fqdn } });
        }
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({
      published: true,
      fqdn: fqdn.replace(/\.$/, ""),
      url: `https://${fqdn.replace(/\.$/, "")}`,
      target: target.kind,
    });
  } catch (err) {
    return handleApiError(err, "Failed to publish the site.");
  }
}

/**
 * Stop pointing a hostname at a website:
 *   DELETE /api/internal/sites
 *   { namespace, name, address, hostname? }
 */
export async function DELETE(req: Request) {
  try {
    if (!authorized(req)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (!isSiteFeatureEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const resolved = await resolveTarget(body);
    if (resolved instanceof NextResponse) return resolved;

    await removeSiteDnsRecords(resolved.ns, resolved.fqdn);
    return NextResponse.json({ published: false, fqdn: resolved.fqdn.replace(/\.$/, "") });
  } catch (err) {
    return handleApiError(err, "Failed to remove the site.");
  }
}
