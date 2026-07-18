import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Readiness: verifies required dependencies (the database) before reporting the
// instance ready to serve traffic. Returns 503 when a dependency is unreachable.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[ready] database dependency check failed", err);
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
