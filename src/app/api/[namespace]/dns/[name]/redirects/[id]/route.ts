import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { updateRedirectSchema } from "@/lib/api-schemas";
import { getRequestMeta, recordAuditLog } from "@/lib/audit";
import { getSession } from "@/lib/auth/session";
import { checkStepUpForWrite } from "@/lib/auth/step-up";
import { prisma } from "@/lib/db";
import { getNamespace } from "@/lib/namespaces";
import { requireClaimedNameOwnership } from "@/lib/ownership/sync";
import { checkRateLimit } from "@/lib/rate-limit";
import { isRedirectFeatureEnabled } from "@/lib/redirect/constants";
import {
  hasNonRedirectRecordAt,
  redirectWouldLoop,
  removeRedirectDnsRecords,
  writeRedirectDnsRecords,
} from "@/lib/redirect/service";
import { validateDestinationUrl } from "@/lib/redirect/validation";

type RouteParams = { params: Promise<{ namespace: string; name: string; id: string }> };

/**
 * Shared preamble: namespace + session + live ownership + step-up + rate limit,
 * then loads the redirect and confirms it belongs to this owner's name.
 * Returns either an error response or the resolved context.
 */
async function authorizeRedirectMutation(req: Request, params: RouteParams["params"]) {
  const { namespace: key, name: rawName, id } = await params;
  const ns = getNamespace(key);

  const session = await getSession(ns.key);
  if (!session) {
    return { error: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }

  const auth = await requireClaimedNameOwnership(ns, decodeURIComponent(rawName), session.address);
  if (!auth.ok) {
    return { error: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  }

  const stepUp = await checkStepUpForWrite(ns.key, session.address);
  if (!stepUp.ok) {
    return { error: NextResponse.json({ error: stepUp.error }, { status: stepUp.status }) };
  }

  const rateLimit = await checkRateLimit(`dns-write:${ns.key}:${session.address}`);
  if (!rateLimit.allowed) {
    return {
      error: NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${rateLimit.retryAfterSeconds}s.` },
        { status: 429 },
      ),
    };
  }

  const redirect = await prisma.urlRedirect.findFirst({
    where: { id, namespace: ns.key, claimedName: auth.name },
  });
  if (!redirect) {
    return { error: NextResponse.json({ error: "Redirect not found." }, { status: 404 }) };
  }

  return { ns, session, name: auth.name, redirect };
}

export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const ctx = await authorizeRedirectMutation(req, params);
    if ("error" in ctx) return ctx.error;
    const { ns, session, name, redirect } = ctx;

    const body = updateRedirectSchema.parse(await req.json());

    let destinationUrl = redirect.destinationUrl;
    if (body.destinationUrl !== undefined) {
      const destResult = validateDestinationUrl(body.destinationUrl);
      if (!destResult.ok) {
        return NextResponse.json({ error: destResult.error }, { status: 400 });
      }
      destinationUrl = destResult.value;
    }

    const statusCode = body.statusCode ?? redirect.statusCode;

    // Re-check for loops whenever the redirect will END UP active - not only when
    // the destination changes. Re-enabling a redirect must re-validate too, since
    // another redirect forming a loop with it may have been created while it was
    // disabled (and therefore invisible to that create's loop check).
    const willBeActive = body.enabled === undefined ? redirect.status === "ACTIVE" : body.enabled;
    if (willBeActive && (await redirectWouldLoop(ns.key, redirect.fqdn, destinationUrl))) {
      return NextResponse.json(
        { error: "This redirect points back to itself (a redirect loop)." },
        { status: 400 },
      );
    }

    let status = redirect.status;

    // Enable/disable toggles the DNS records that make the host resolve.
    if (body.enabled !== undefined) {
      if (body.enabled && redirect.status !== "ACTIVE") {
        if (!isRedirectFeatureEnabled(ns.key)) {
          return NextResponse.json(
            { error: "URL redirects are not enabled for this namespace." },
            { status: 403 },
          );
        }
        if (await hasNonRedirectRecordAt(ns.key, redirect.fqdn)) {
          return NextResponse.json(
            { error: "A DNS record now exists at this hostname. Remove it before re-enabling the redirect." },
            { status: 409 },
          );
        }
        await writeRedirectDnsRecords(ns, name, redirect.fqdn, redirect.relativeHost);
        status = "ACTIVE";
      } else if (!body.enabled && redirect.status === "ACTIVE") {
        await removeRedirectDnsRecords(ns, redirect.fqdn);
        status = "DISABLED";
      }
    }

    const saved = await prisma.urlRedirect.update({
      where: { id: redirect.id },
      data: { destinationUrl, statusCode, status, disabledReason: null },
    });

    const { ipAddress, userAgent } = getRequestMeta(req);
    await recordAuditLog({
      namespace: ns.key,
      address: session.address,
      claimedName: name,
      action: "UPDATE",
      fqdn: redirect.fqdn,
      type: "REDIRECT",
      oldValue: `${redirect.statusCode} ${redirect.destinationUrl} (${redirect.status})`,
      newValue: `${statusCode} ${destinationUrl} (${status})`,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ redirect: saved });
  } catch (err) {
    return handleApiError(err, "Failed to update redirect.");
  }
}

export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const ctx = await authorizeRedirectMutation(req, params);
    if ("error" in ctx) return ctx.error;
    const { ns, session, name, redirect } = ctx;

    await removeRedirectDnsRecords(ns, redirect.fqdn);
    await prisma.urlRedirect.delete({ where: { id: redirect.id } });

    const { ipAddress, userAgent } = getRequestMeta(req);
    await recordAuditLog({
      namespace: ns.key,
      address: session.address,
      claimedName: name,
      action: "DELETE",
      fqdn: redirect.fqdn,
      type: "REDIRECT",
      oldValue: `${redirect.statusCode} ${redirect.destinationUrl}`,
      newValue: null,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "Failed to delete redirect.");
  }
}
