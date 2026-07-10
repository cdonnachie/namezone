import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getNamespace } from "@/lib/namespaces";

export async function GET(req: Request, { params }: { params: Promise<{ namespace: string }> }) {
  try {
    const { namespace: key } = await params;
    const ns = getNamespace(key);

    const session = await getSession(ns.key);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    // Optional ?name= narrows to one claimed name (the per-name "recent
    // changes" panel). Still scoped to the caller's own address.
    const name = new URL(req.url).searchParams.get("name")?.trim().toLowerCase() || undefined;

    const logs = await prisma.auditLog.findMany({
      where: { namespace: ns.key, address: session.address, ...(name ? { claimedName: name } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ logs });
  } catch (err) {
    return handleApiError(err, "Failed to load audit log.");
  }
}
