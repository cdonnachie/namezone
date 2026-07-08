import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { getSession } from "@/lib/auth/session";
import { getNamespace } from "@/lib/namespaces";
import { getOwnedNameSummaries } from "@/lib/ownership/names-for-owner";

export async function GET(_req: Request, { params }: { params: Promise<{ namespace: string }> }) {
  try {
    const { namespace: key } = await params;
    const ns = getNamespace(key);

    const session = await getSession(ns.key);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const summaries = await getOwnedNameSummaries(ns, session.address);
    const names = summaries.map((s) => ({
      name: s.name,
      zone: s.zone,
      recordCount: s.recordCount,
      lastUpdated: s.lastUpdated.toISOString(),
      transferJustDetected: s.transferJustDetected,
    }));

    return NextResponse.json({ names });
  } catch (err) {
    return handleApiError(err, "Failed to load names.");
  }
}
