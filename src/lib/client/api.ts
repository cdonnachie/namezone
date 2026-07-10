export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body?.error ?? "Request failed.", res.status);
  }
  return body as T;
}

export interface ChallengeResponse {
  message: string;
  nonce: string;
}
export function requestChallenge(namespace: string, address: string) {
  return request<ChallengeResponse>(`/api/${namespace}/auth/challenge`, {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

/** Resolves a source name (e.g. "bob.rxd") to its current on-chain owner address. */
export function resolveOwner(namespace: string, name: string) {
  return request<{ name: string; address: string }>(
    `/api/${namespace}/resolve?name=${encodeURIComponent(name)}`,
  );
}

export interface VerifyResponse {
  address: string;
}
export function verifyChallenge(
  namespace: string,
  address: string,
  message: string,
  signature: string,
  options?: { sharedComputer?: boolean },
) {
  return request<VerifyResponse>(`/api/${namespace}/auth/verify`, {
    method: "POST",
    body: JSON.stringify({ address, message, signature, sharedComputer: options?.sharedComputer }),
  });
}

export function logout(namespace: string) {
  return request<{ ok: true }>(`/api/${namespace}/auth/logout`, { method: "POST" });
}

/** Machine-readable error body returned when a write needs a fresh signature. */
export const STEP_UP_REQUIRED_ERROR = "STEP_UP_REQUIRED";

/** Mints the short-lived step-up cookie from a fresh challenge signature. */
export function stepUp(namespace: string, address: string, message: string, signature: string) {
  return request<{ ok: true }>(`/api/${namespace}/auth/step-up`, {
    method: "POST",
    body: JSON.stringify({ address, message, signature }),
  });
}

export function fetchSecuritySettings(namespace: string) {
  return request<{ requireSignedWrites: boolean }>(`/api/${namespace}/settings`);
}

export function updateSecuritySettings(namespace: string, requireSignedWrites: boolean) {
  return request<{ requireSignedWrites: boolean }>(`/api/${namespace}/settings`, {
    method: "PUT",
    body: JSON.stringify({ requireSignedWrites }),
  });
}

export interface ClaimedNameSummary {
  name: string;
  zone: string;
  recordCount: number;
  lastUpdated: string;
  transferJustDetected: boolean;
}
export function fetchOwnedNames(namespace: string) {
  return request<{ names: ClaimedNameSummary[] }>(`/api/${namespace}/names`);
}

export type BasicRecordType = "A" | "AAAA" | "CNAME";
/** Types creatable via the general Add Record flow, incl. email types (allowlist-gated server-side). */
export type EditableRecordType = BasicRecordType | "MX" | "TXT";

export interface DnsRecordDto {
  id: string;
  claimedName: string;
  fqdn: string;
  relativeHost: string;
  type: BasicRecordType | "TXT" | "MX";
  value: string;
  ttl: number;
  isAcmeChallenge: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export function fetchDnsRecords(namespace: string, name: string) {
  return request<{ name: string; zone: string; records: DnsRecordDto[] }>(
    `/api/${namespace}/dns/${encodeURIComponent(name)}`,
  );
}

export function createOrUpdateRecord(
  namespace: string,
  name: string,
  data: { hostname: string; type: EditableRecordType; value: string },
) {
  return request<{ record: DnsRecordDto }>(`/api/${namespace}/dns/${encodeURIComponent(name)}/records`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteRecord(
  namespace: string,
  name: string,
  data: { hostname: string; type: EditableRecordType; value?: string },
) {
  return request<{ ok: true }>(`/api/${namespace}/dns/${encodeURIComponent(name)}/records`, {
    method: "DELETE",
    body: JSON.stringify(data),
  });
}

export function createAcmeChallenge(
  namespace: string,
  name: string,
  data: { hostname: string; value: string; expiryHours?: number },
) {
  return request<{ record: DnsRecordDto }>(`/api/${namespace}/dns/${encodeURIComponent(name)}/acme`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteAcmeChallenge(namespace: string, name: string, data: { hostname: string; value: string }) {
  return request<{ ok: true }>(`/api/${namespace}/dns/${encodeURIComponent(name)}/acme`, {
    method: "DELETE",
    body: JSON.stringify(data),
  });
}

export interface AuditLogDto {
  id: string;
  claimedName: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "DISABLE";
  fqdn: string;
  type: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}
export function fetchAuditLogs(namespace: string, name?: string) {
  const qs = name ? `?name=${encodeURIComponent(name)}` : "";
  return request<{ logs: AuditLogDto[] }>(`/api/${namespace}/audit${qs}`);
}

export interface VerifyRecordResult {
  fqdn: string;
  type: string;
  resolver: string;
  /** The public resolver returned at least one answer of this type. */
  visible: boolean;
  /** One of those answers matches the value we hold. */
  matched: boolean;
  answers: string[];
}
export function verifyRecordPropagation(
  namespace: string,
  name: string,
  data: { hostname: string; type: string; value: string },
) {
  return request<VerifyRecordResult>(`/api/${namespace}/dns/${encodeURIComponent(name)}/verify`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
