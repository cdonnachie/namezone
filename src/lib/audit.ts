import { prisma } from "@/lib/db";
import type { AuditAction } from "@prisma/client";

export async function recordAuditLog(params: {
  namespace: string;
  address: string;
  claimedName: string;
  action: AuditAction;
  fqdn: string;
  type: string;
  oldValue?: string | null;
  newValue?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await prisma.auditLog.create({ data: params });
}

export function getRequestMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ipAddress = forwardedFor ? forwardedFor.split(",")[0]?.trim() : null;
  const userAgent = req.headers.get("user-agent");
  return { ipAddress: ipAddress ?? null, userAgent };
}
