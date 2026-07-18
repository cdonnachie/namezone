import { NextResponse } from "next/server";

// Liveness: the process is up and serving. No dependency checks - see /api/ready.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
