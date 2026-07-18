import { NextResponse } from "next/server";
import { isRedirectStatusCode, redirectCacheControl } from "@/lib/redirect/constants";
import { findEnabledRedirectByFqdn } from "@/lib/redirect/lookup";

// Prisma requires the Node.js runtime (the redirect lookup hits the database).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Applied to every response so error/landing pages can't be framed, sniffed,
// or leak a referrer. The redirect service never reflects request data into
// headers beyond the validated, stored Location value.
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
};

function landing(status: number, title: string, message: string): NextResponse {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#0b0d12;color:#e7e9ee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#9aa0ad;margin:0}</style></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
  });
}

/**
 * The public redirect service. Middleware rewrites any request whose Host is a
 * redirect subdomain of a managed zone here, passing the original host in
 * `x-redirect-host`. Looks up the enabled redirect and returns a Location
 * response — it never fetches or proxies the destination, and never accepts a
 * destination from the query string.
 */
async function handler(req: Request): Promise<NextResponse> {
  const host = req.headers.get("x-redirect-host") ?? req.headers.get("host") ?? "";
  try {
    const redirect = await findEnabledRedirectByFqdn(host);
    if (!redirect || !isRedirectStatusCode(redirect.statusCode)) {
      return landing(404, "Not found", "No redirect is configured for this address.");
    }
    // Defense in depth: the stored URL is validated on write (no control
    // chars), but strip any CR/LF before it reaches a header regardless.
    const location = redirect.destinationUrl.replace(/[\r\n]/g, "");
    return new NextResponse(null, {
      status: redirect.statusCode,
      headers: {
        Location: location,
        "Cache-Control": redirectCacheControl(redirect.statusCode),
        ...SECURITY_HEADERS,
      },
    });
  } catch (err) {
    console.error("[redirect] lookup failed for host", host, err);
    return landing(500, "Temporarily unavailable", "This redirect could not be served right now.");
  }
}

export {
  handler as GET,
  handler as HEAD,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as OPTIONS,
};
