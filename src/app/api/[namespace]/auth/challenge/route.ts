import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { challengeRequestSchema } from "@/lib/api-schemas";
import { getRequestMeta } from "@/lib/audit";
import { createLoginChallenge } from "@/lib/auth/challenge";
import { getNamespace, NamespaceNotFoundError } from "@/lib/namespaces";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request, { params }: { params: Promise<{ namespace: string }> }) {
  try {
    const { namespace: key } = await params;
    const ns = getNamespace(key);

    const json = await req.json();
    const { address } = challengeRequestSchema.parse(json);

    // Limited per address AND per IP: the address is attacker-chosen, so on
    // its own it's trivially rotated to mint unlimited challenge rows. The
    // IP comes from X-Forwarded-For (spoofable unless behind a trusted
    // proxy), so this is defense in depth - the hard bound on table growth
    // is the periodic cleanup in /api/cron/verify-ownership. Without a
    // proxy the IP is null and all callers share one "unknown" bucket,
    // hence the more generous per-IP limit.
    const { ipAddress } = getRequestMeta(req);
    const [byAddress, byIp] = await Promise.all([
      checkRateLimit(`auth-challenge:${ns.key}:${address}`, 10, 60_000),
      checkRateLimit(`auth-challenge-ip:${ipAddress ?? "unknown"}`, 30, 60_000),
    ]);
    if (!byAddress.allowed || !byIp.allowed) {
      return NextResponse.json(
        { error: "Too many challenge requests. Please try again shortly." },
        { status: 429 },
      );
    }

    const { message, nonce } = await createLoginChallenge(ns, address);
    return NextResponse.json({ message, nonce });
  } catch (err) {
    if (err instanceof NamespaceNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    console.error("[api/auth/challenge]", err);
    return NextResponse.json({ error: "Failed to create login challenge." }, { status: 500 });
  }
}
