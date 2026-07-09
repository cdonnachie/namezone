import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { getRequestMeta } from "@/lib/audit";
import { validateSourceName } from "@/lib/dns/validation";
import { getNamespace } from "@/lib/namespaces";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Public name -> owner-address lookup (GET /api/[namespace]/resolve?name=bob.rxd),
 * backed by the namespace's on-chain adapter. Used by the connect flow so
 * users can type their name instead of their address - ownership is public
 * on-chain data (same as the lookup page), so no session is required, but
 * it's IP rate-limited since each call can hit the chain backend.
 */
export async function GET(req: Request, { params }: { params: Promise<{ namespace: string }> }) {
  try {
    const { namespace: key } = await params;
    const ns = getNamespace(key);

    const { searchParams } = new URL(req.url);
    const parsed = validateSourceName(searchParams.get("name") ?? "", ns);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { ipAddress } = getRequestMeta(req);
    const rateLimit = await checkRateLimit(`resolve-ip:${ipAddress ?? "unknown"}`, 30, 60_000);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: "Too many lookups. Please try again shortly." }, { status: 429 });
    }

    let address: string | null;
    try {
      address = await ns.adapter.getOwnerAddress(parsed.value);
    } catch {
      // Backend (RXinDexer/aviand) unreachable - distinct from "no owner".
      return NextResponse.json(
        { error: "Name lookup is temporarily unavailable. Enter your address directly instead." },
        { status: 502 },
      );
    }
    if (!address) {
      return NextResponse.json({ error: `"${parsed.value}" is not registered.` }, { status: 404 });
    }

    return NextResponse.json({ name: parsed.value, address });
  } catch (err) {
    return handleApiError(err, "Failed to resolve name.");
  }
}
