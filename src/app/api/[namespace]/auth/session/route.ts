import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getNamespace, NamespaceNotFoundError } from "@/lib/namespaces";

export async function GET(_req: Request, { params }: { params: Promise<{ namespace: string }> }) {
  try {
    const { namespace: key } = await params;
    const ns = getNamespace(key);

    const session = await getSession(ns.key);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    return NextResponse.json({ address: session.address });
  } catch (err) {
    if (err instanceof NamespaceNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
