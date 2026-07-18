import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { createRedirectSchema } from "@/lib/api-schemas";
import { getRequestMeta, recordAuditLog } from "@/lib/audit";
import { getSession } from "@/lib/auth/session";
import { checkStepUpForWrite } from "@/lib/auth/step-up";
import { prisma } from "@/lib/db";
import { getNamespace } from "@/lib/namespaces";
import { requireClaimedNameOwnership } from "@/lib/ownership/sync";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  DEFAULT_REDIRECT_STATUS,
  MAX_REDIRECTS_PER_NAME,
  isRedirectFeatureEnabled,
} from "@/lib/redirect/constants";
import {
  hasNonRedirectRecordAt,
  redirectWouldLoop,
  writeRedirectDnsRecords,
} from "@/lib/redirect/service";
import { validateDestinationUrl, validateRedirectHost } from "@/lib/redirect/validation";

export async function GET(
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

    const auth = await requireClaimedNameOwnership(ns, decodeURIComponent(rawName), session.address);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const redirects = await prisma.urlRedirect.findMany({
      where: { namespace: ns.key, claimedName: auth.name },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ redirects });
  } catch (err) {
    return handleApiError(err, "Failed to list redirects.");
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ namespace: string; name: string }> },
) {
  try {
    const { namespace: key, name: rawName } = await params;
    const ns = getNamespace(key);

    if (!isRedirectFeatureEnabled(ns.key)) {
      return NextResponse.json({ error: "URL redirects are not enabled for this namespace." }, { status: 403 });
    }

    const session = await getSession(ns.key);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const auth = await requireClaimedNameOwnership(ns, decodeURIComponent(rawName), session.address);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const stepUp = await checkStepUpForWrite(ns.key, session.address);
    if (!stepUp.ok) {
      return NextResponse.json({ error: stepUp.error }, { status: stepUp.status });
    }

    // Shares the DNS-write budget with record writes (same bucket key).
    const rateLimit = await checkRateLimit(`dns-write:${ns.key}:${session.address}`);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${rateLimit.retryAfterSeconds}s.` },
        { status: 429 },
      );
    }

    const body = createRedirectSchema.parse(await req.json());

    const hostResult = validateRedirectHost(body.hostname, auth.name, ns);
    if (!hostResult.ok) {
      return NextResponse.json({ error: hostResult.error }, { status: 400 });
    }
    const { relativeHost, fqdn } = hostResult.value;

    const destResult = validateDestinationUrl(body.destinationUrl);
    if (!destResult.ok) {
      return NextResponse.json({ error: destResult.error }, { status: 400 });
    }
    const destinationUrl = destResult.value;
    const statusCode = body.statusCode ?? DEFAULT_REDIRECT_STATUS;

    if (await redirectWouldLoop(ns.key, fqdn, destinationUrl)) {
      return NextResponse.json(
        { error: "This redirect points back to itself (a redirect loop)." },
        { status: 400 },
      );
    }

    // Conflict: a normal DNS record already lives at this hostname.
    if (await hasNonRedirectRecordAt(ns.key, fqdn)) {
      return NextResponse.json(
        { error: "A DNS record already exists at this hostname. Delete it before creating a redirect here." },
        { status: 409 },
      );
    }

    // A DISABLED row (e.g. left by a prior ownership transfer) at this fqdn is
    // reactivated in place; an ACTIVE one is a genuine duplicate.
    const existing = await prisma.urlRedirect.findUnique({
      where: { namespace_fqdn: { namespace: ns.key, fqdn } },
    });
    if (existing && existing.status === "ACTIVE") {
      return NextResponse.json({ error: "A redirect already exists for this hostname." }, { status: 409 });
    }

    // Enforce the cap on any row that will become ACTIVE - including reactivating
    // a DISABLED row (an ACTIVE duplicate already 409'd above, so `existing` here
    // is null or DISABLED and either way adds one to the active count).
    const activeCount = await prisma.urlRedirect.count({
      where: { namespace: ns.key, claimedName: auth.name, status: "ACTIVE" },
    });
    if (activeCount >= MAX_REDIRECTS_PER_NAME) {
      return NextResponse.json(
        { error: `Maximum of ${MAX_REDIRECTS_PER_NAME} redirects per name reached.` },
        { status: 400 },
      );
    }

    await writeRedirectDnsRecords(ns, auth.name, fqdn, relativeHost);

    const saved = existing
      ? await prisma.urlRedirect.update({
          where: { id: existing.id },
          data: {
            claimedName: auth.name,
            relativeHost,
            destinationUrl,
            statusCode,
            status: "ACTIVE",
            disabledReason: null,
            createdByWallet: session.address,
          },
        })
      : await prisma.urlRedirect.create({
          data: {
            namespace: ns.key,
            claimedName: auth.name,
            fqdn,
            relativeHost,
            destinationUrl,
            statusCode,
            createdByWallet: session.address,
          },
        });

    const { ipAddress, userAgent } = getRequestMeta(req);
    await recordAuditLog({
      namespace: ns.key,
      address: session.address,
      claimedName: auth.name,
      action: "CREATE",
      fqdn,
      type: "REDIRECT",
      oldValue: null,
      newValue: `${statusCode} ${destinationUrl}`,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ redirect: saved }, { status: 201 });
  } catch (err) {
    return handleApiError(err, "Failed to create redirect.");
  }
}
