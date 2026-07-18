import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { RESERVED_ROOT_HOSTS } from "@/lib/dns/constants";

/**
 * Lets each namespace's own custom domain (e.g. avn.zone, rxd.zone) serve
 * that namespace directly at "/" instead of requiring the /avian or
 * /radiant path segment - visiting avn.zone/connect transparently serves
 * what's at /avian/connect, with no visible redirect.
 *
 * Also routes managed URL-redirect subdomains (e.g. x.craigd.rxd.zone) to the
 * redirect service at /_redirect. In production only redirect hosts (whose
 * A/AAAA point at the redirect service) ever reach this app under a managed
 * zone; ordinary records a user manages resolve to their own hosts and never
 * arrive here.
 *
 * Mirrors the dnsZone defaults in src/lib/namespaces/{avian,radiant}.ts, but
 * is deliberately NOT imported from there: that module composes each
 * namespace's OwnershipAdapter at import time, which for Radiant pulls in
 * RadiantElectrumClient's `node:net` socket - a Node built-in unsupported in
 * the Edge Runtime middleware executes in. Keep this map in sync by hand if
 * AVIAN_DNS_ZONE/RADIANT_DNS_ZONE ever change. (RESERVED_ROOT_HOSTS is a pure
 * constant with no such imports, so it's safe to pull in here.)
 */
const AVIAN_ZONE = (process.env.AVIAN_DNS_ZONE ?? "avn.zone").trim().toLowerCase();
const RADIANT_ZONE = (process.env.RADIANT_DNS_ZONE ?? "rxd.zone").trim().toLowerCase();

const NAMESPACE_BY_HOST: Record<string, string> = {
  [AVIAN_ZONE]: "avian",
  [RADIANT_ZONE]: "radiant",
};

const MANAGED_ZONES = [AVIAN_ZONE, RADIANT_ZONE];

/**
 * A host is a redirect candidate when it sits below a managed zone (deeper
 * than the bare zone) and the label directly under the zone is not one of the
 * operator's reserved root hosts (ns1/ns2/www.<zone> stay the operator's).
 */
function isRedirectHostCandidate(host: string): boolean {
  for (const zone of MANAGED_ZONES) {
    if (host === zone || !host.endsWith(`.${zone}`)) continue;
    const sub = host.slice(0, -(zone.length + 1)); // labels before ".<zone>"
    const labelUnderZone = sub.split(".").pop() ?? "";
    if (RESERVED_ROOT_HOSTS.includes(labelUnderZone)) return false;
    return true;
  }
  return false;
}

/** Paths the namespace custom-domain rewrite must leave untouched (API + static files). */
function isNonPagePath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/") || /\.[^/]+$/.test(pathname);
}

export function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  if (!host) return NextResponse.next();

  // Redirect subdomains: every path/method is served by the redirect service.
  if (isRedirectHostCandidate(host)) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-redirect-host", host);
    const url = request.nextUrl.clone();
    url.pathname = "/redirect-serve";
    url.search = "";
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  // Namespace custom domain (bare zone) → serve that namespace at "/".
  const namespaceKey = NAMESPACE_BY_HOST[host];
  if (!namespaceKey) return NextResponse.next();

  const { pathname } = request.nextUrl;
  // Leave API routes and static assets alone (they resolve correctly as-is).
  if (isNonPagePath(pathname)) return NextResponse.next();
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
  // Run on everything except Next's own internal assets. Broader than a
  // page-only matcher so redirect hosts are handled on every path (incl. /api
  // and dotted paths); the handler itself decides what to do per host.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
