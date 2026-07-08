import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { NamespaceNotFoundError } from "@/lib/namespaces";
import { PowerDnsError } from "@/lib/powerdns/client";

export function handleApiError(err: unknown, fallbackMessage: string): NextResponse {
  if (err instanceof NamespaceNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof ZodError) {
    return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  if (err instanceof PowerDnsError) {
    console.error("[powerdns]", err.status, err.body);
    return NextResponse.json({ error: "Failed to sync DNS change to PowerDNS." }, { status: 502 });
  }
  console.error(fallbackMessage, err);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
