import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { getSession } from "@/lib/auth/session";
import { createHandoffToken, getHandoffApp, isAllowedRedirectUri } from "@/lib/auth/handoff";
import { getNamespace } from "@/lib/namespaces";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Completes a companion-app sign-in handoff:
 *   POST /api/[namespace]/auth/authorize  { redirectUri }
 *
 * The caller must already hold a Name Zone session for this namespace — that
 * session is the proof of wallet ownership being handed on. We mint a
 * short-lived token naming the session's address and return the URL to send
 * the browser to; the app on the other end verifies it and mints its own
 * session.
 *
 * This route only ever acts on the *session's* address. Nothing in the request
 * body selects an identity, so a malicious page cannot ask for a token for
 * someone else.
 */
export async function POST(req: Request, { params }: { params: Promise<{ namespace: string }> }) {
  try {
    const { namespace: key } = await params;
    const ns = getNamespace(key);

    const app = getHandoffApp();
    if (!app) {
      return NextResponse.json({ error: "App sign-in is not enabled." }, { status: 404 });
    }

    const session = await getSession(ns.key);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const rateLimit = await checkRateLimit(`authorize:${session.address}`, 20, 60_000);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: "Too many sign-in attempts. Please try again shortly." }, { status: 429 });
    }

    const body = (await req.json().catch(() => ({}))) as { redirectUri?: unknown };
    const redirectUri = typeof body.redirectUri === "string" ? body.redirectUri : "";
    if (!isAllowedRedirectUri(redirectUri, app)) {
      // Never echo the rejected value: this is the check that stops a token
      // being delivered to an attacker-chosen URL.
      return NextResponse.json({ error: "That redirect target is not allowed." }, { status: 400 });
    }

    const token = await createHandoffToken({ namespace: ns.key, address: session.address, app });
    if (!token) {
      return NextResponse.json({ error: "App sign-in is not enabled." }, { status: 404 });
    }

    // Not written to AuditLog: that table is DNS-record shaped (claimedName,
    // fqdn, type are all required) and drives the per-name history on the
    // settings page. An app authorization has none of those, and inventing
    // placeholder values would pollute a table the UI renders.
    console.info(`[handoff] ${ns.key} authorized ${app.id} for ${session.address}`);

    const target = new URL(redirectUri);
    target.searchParams.set("token", token);
    return NextResponse.json({ redirectTo: target.toString() });
  } catch (err) {
    return handleApiError(err, "Failed to authorize the app.");
  }
}
