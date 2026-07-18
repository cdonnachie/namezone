import { prisma } from "@/lib/db";
import { listEnabledNamespaces } from "@/lib/namespaces";

/**
 * Normalizes a request Host header into an absolute FQDN (lowercased, no port,
 * single trailing dot) matching how redirect fqdns are stored.
 * "X.Craigd.RXD.Zone:443" -> "x.craigd.rxd.zone."
 */
export function normalizeRedirectHost(rawHost: string): string {
  let host = rawHost.trim().toLowerCase();
  const colon = host.indexOf(":");
  if (colon !== -1) host = host.slice(0, colon); // strip port (redirect hosts are names, never IPv6 literals)
  if (host.endsWith(".")) host = host.slice(0, -1);
  return `${host}.`;
}

/** True if an absolute fqdn falls within one of the enabled namespaces' zones. */
export function isManagedRedirectZone(fqdnWithDot: string): boolean {
  const host = fqdnWithDot.endsWith(".") ? fqdnWithDot.slice(0, -1) : fqdnWithDot;
  return listEnabledNamespaces().some((ns) => host === ns.dnsZone || host.endsWith(`.${ns.dnsZone}`));
}

export type EnabledRedirect = { fqdn: string; destinationUrl: string; statusCode: number };

/**
 * Looks up an enabled redirect for a request Host. Returns null for anything
 * outside a managed zone (so we never touch the DB for junk hosts) or with no
 * active redirect. This is the single lookup the redirect service and the TLS
 * authorize endpoint share.
 */
export async function findEnabledRedirectByFqdn(rawHost: string): Promise<EnabledRedirect | null> {
  if (!rawHost) return null;
  const fqdn = normalizeRedirectHost(rawHost);
  if (!isManagedRedirectZone(fqdn)) return null;
  const row = await prisma.urlRedirect.findFirst({
    where: { fqdn, status: "ACTIVE" },
    select: { fqdn: true, destinationUrl: true, statusCode: true },
  });
  return row;
}
