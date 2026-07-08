import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { requireClaimedNameOwnership } from "@/lib/ownership/sync";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { reconcileClaimedNameRecordsWithPowerDns } from "@/lib/dns/reconcile";
import { sourceNameToBaseFqdn } from "@/lib/dns/validation";
import { getNamespace } from "@/lib/namespaces";
import { DnsManager } from "./dns-manager";

export default async function DnsManagementPage({
  params,
}: {
  params: Promise<{ namespace: string; name: string }>;
}) {
  const { namespace: key, name: rawName } = await params;
  let ns;
  try {
    ns = getNamespace(key);
  } catch {
    notFound();
  }

  const session = await getSession(ns.key);
  if (!session) redirect(`/${ns.key}/connect`);

  const auth = await requireClaimedNameOwnership(ns, decodeURIComponent(rawName), session.address);

  if (!auth.ok) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Cannot manage {auth.name}</CardTitle>
            <CardDescription>{auth.error}</CardDescription>
          </CardHeader>
        </Card>
        <Button asChild variant="outline" className="mt-4">
          <Link href={`/${ns.key}/dashboard`}>
            <ArrowLeft className="size-4" /> Back to dashboard
          </Link>
        </Button>
      </div>
    );
  }

  await reconcileClaimedNameRecordsWithPowerDns(ns, [auth.name]);

  const records = await prisma.dnsRecord.findMany({
    where: { namespace: ns.key, claimedName: auth.name, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href={`/${ns.key}/dashboard`}>
          <ArrowLeft className="size-4" /> Back to dashboard
        </Link>
      </Button>

      {auth.transferJustDetected && (
        <Alert className="mb-6 border-amber-500/30 bg-amber-500/10">
          <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
          <AlertTitle>Ownership transfer detected</AlertTitle>
          <AlertDescription>
            This name&apos;s ownership changed since it was last managed. All previous DNS
            records were disabled and removed from PowerDNS - they are not inherited. Recreate
            whatever records you need below.
          </AlertDescription>
        </Alert>
      )}

      <DnsManager
        namespace={ns.key}
        address={session.address}
        name={auth.name}
        zone={sourceNameToBaseFqdn(auth.name, ns)}
        initialRecords={records.map((r) => ({
          id: r.id,
          claimedName: r.claimedName,
          fqdn: r.fqdn,
          relativeHost: r.relativeHost,
          type: r.type,
          value: r.value,
          ttl: r.ttl,
          isAcmeChallenge: r.isAcmeChallenge,
          expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
