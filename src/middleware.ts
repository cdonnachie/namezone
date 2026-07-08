import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Lets each namespace's own custom domain (e.g. avn.zone, rxd.zone) serve
 * that namespace directly at "/" instead of requiring the /avian or
 * /radiant path segment - visiting avn.zone/connect transparently serves
 * what's at /avian/connect, with no visible redirect.
 *
 * Mirrors the dnsZone defaults in src/lib/namespaces/{avian,radiant}.ts, but
 * is deliberately NOT imported from there: that module composes each
 * namespace's OwnershipAdapter at import time, which for Radiant pulls in
 * RadiantElectrumClient's `node:net` socket - a Node built-in unsupported in
 * the Edge Runtime middleware executes in. Keep this map in sync by hand if
 * AVIAN_DNS_ZONE/RADIANT_DNS_ZONE ever change.
 */
const NAMESPACE_BY_HOST: Record<string, string> = {
  [(process.env.AVIAN_DNS_ZONE ?? "avn.zone").trim().toLowerCase()]: "avian",
  [(process.env.RADIANT_DNS_ZONE ?? "rxd.zone").trim().toLowerCase()]: "radiant",
};

export function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  const namespaceKey = host ? NAMESPACE_BY_HOST[host] : undefined;
  if (!namespaceKey) return NextResponse.next();

  const { pathname } = request.nextUrl;
  // Already namespace-prefixed - e.g. an internal absolute link like
  // /avian/dashboard, which resolves correctly on any domain regardless of
  // this middleware. Rewriting again would double-prefix to /avian/avian/...
  if (pathname === `/${namespaceKey}` || pathname.startsWith(`/${namespaceKey}/`)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${namespaceKey}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
