export type RedirectStatusCode = 301 | 302 | 307 | 308;

export interface UrlRedirectDto {
  id: string;
  claimedName: string;
  fqdn: string;
  relativeHost: string;
  destinationUrl: string;
  statusCode: RedirectStatusCode;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Shape shared by a Prisma UrlRedirect row (Date fields) and its JSON-serialized
 * form (string fields), so one mapper serves both the SSR initial render and
 * client fetches - keeping the row->DTO transform in a single place.
 */
interface RedirectRowLike {
  id: string;
  claimedName: string;
  fqdn: string;
  relativeHost: string;
  destinationUrl: string;
  statusCode: number;
  status: "ACTIVE" | "DISABLED";
  createdAt: Date | string;
  updatedAt: Date | string;
}

const iso = (d: Date | string): string => (typeof d === "string" ? d : d.toISOString());

export function toUrlRedirectDto(row: RedirectRowLike): UrlRedirectDto {
  return {
    id: row.id,
    claimedName: row.claimedName,
    fqdn: row.fqdn,
    relativeHost: row.relativeHost,
    destinationUrl: row.destinationUrl,
    statusCode: row.statusCode as RedirectStatusCode,
    enabled: row.status === "ACTIVE",
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
