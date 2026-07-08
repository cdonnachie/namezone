import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { verifyRequestSchema } from "@/lib/api-schemas";
import { getRequestMeta } from "@/lib/audit";
import { verifyLoginChallenge } from "@/lib/auth/challenge";
import { getSession } from "@/lib/auth/session";
import { createStepUpToken, setStepUpCookie } from "@/lib/auth/step-up";
import { getNamespace, NamespaceNotFoundError } from "@/lib/namespaces";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Mints the short-lived step-up cookie after verifying a FRESH wallet
 * signature over a normal login challenge (same challenge/signature flow
 * as sign-in, same single-use nonce store). Requires an active session for
 * the same address - this endpoint elevates an existing session, it never
 * creates one.
 */
export async function POST(req: Request, { params }: { params: Promise<{ namespace: string }> }) {
  try {
    const { namespace: key } = await params;
    const ns = getNamespace(key);

    const session = await getSession(ns.key);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const json = await req.json();
    const { address, message, signature } = verifyRequestSchema.parse(json);

    if (address !== session.address) {
      return NextResponse.json(
        { error: "Step-up signature must be from the signed-in address." },
        { status: 403 },
      );
    }

    const { ipAddress } = getRequestMeta(req);
    const [byAddress, byIp] = await Promise.all([
      checkRateLimit(`auth-verify:${ns.key}:${address}`, 10, 60_000),
      checkRateLimit(`auth-verify-ip:${ipAddress ?? "unknown"}`, 30, 60_000),
    ]);
    if (!byAddress.allowed || !byIp.allowed) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please try again shortly." },
        { status: 429 },
      );
    }

    const result = await verifyLoginChallenge(ns, address, message, signature);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }

    const token = await createStepUpToken(ns.key, address);
    await setStepUpCookie(token);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NamespaceNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    console.error("[api/auth/step-up]", err);
    return NextResponse.json({ error: "Failed to verify signature." }, { status: 500 });
  }
}
