import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { reconcileClaimedNameRecordsWithPowerDns } from "@/lib/dns/reconcile";
import { sourceNameToBaseFqdn } from "@/lib/dns/validation";
import { getNamespace } from "@/lib/namespaces";
import { requireClaimedNameOwnership } from "@/lib/ownership/sync";

export async function GET(
  _req: Request,
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

    await reconcileClaimedNameRecordsWithPowerDns(ns, [auth.name]);

    const records = await prisma.dnsRecord.findMany({
      where: { namespace: ns.key, claimedName: auth.name, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      name: auth.name,
      zone: sourceNameToBaseFqdn(auth.name, ns),
      records,
    });
  } catch (err) {
    return handleApiError(err, "Failed to load DNS records.");
  }
}
