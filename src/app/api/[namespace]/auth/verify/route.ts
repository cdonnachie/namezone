import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { verifyRequestSchema } from "@/lib/api-schemas";
import { getRequestMeta } from "@/lib/audit";
import { verifyLoginChallenge } from "@/lib/auth/challenge";
import { createSessionToken, setSessionCookie } from "@/lib/auth/session";
import { getNamespace, NamespaceNotFoundError } from "@/lib/namespaces";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request, { params }: { params: Promise<{ namespace: string }> }) {
  try {
    const { namespace: key } = await params;
    const ns = getNamespace(key);

    const json = await req.json();
    const { address, message, signature } = verifyRequestSchema.parse(json);

    // Per-address AND per-IP, for the same reason as the challenge route:
    // the address alone is attacker-chosen and trivially rotated. See that
    // route for the X-Forwarded-For caveats.
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

    const token = await createSessionToken(ns.key, result.address);
    await setSessionCookie(token);

    return NextResponse.json({ address: result.address });
  } catch (err) {
    if (err instanceof NamespaceNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    console.error("[api/auth/verify]", err);
    return NextResponse.json({ error: "Failed to verify signature." }, { status: 500 });
  }
}
