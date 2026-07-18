import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { requireClaimedNameOwnership } from "@/lib/ownership/sync";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { reconcileClaimedNameRecordsWithPowerDns } from "@/lib/dns/reconcile";
import { isEmailEnabledName } from "@/lib/dns/email";
import { sourceNameToBaseFqdn } from "@/lib/dns/validation";
import { isRedirectFeatureEnabled } from "@/lib/redirect/constants";
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
    // 403 = the name exists but this wallet isn't its current owner. That's
    // usually a name that changed hands (sold, transferred, or connected with
    // the wrong wallet), so explain the situation instead of a bare error.
    const notOwner = auth.status === 403;
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Cannot manage {auth.name}</CardTitle>
            <CardDescription>{auth.error}</CardDescription>
          </CardHeader>
          {notOwner && (
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Ownership is decided by the blockchain, so this page follows whichever wallet
                currently holds the name:
              </p>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  <span className="font-medium text-foreground">Just bought this name?</span>{" "}
                  Disconnect and sign in again with the wallet address that{" "}
                  <em>received</em> it - that wallet is the owner now.
                </li>
                <li>
                  <span className="font-medium text-foreground">Sold or transferred it away?</span>{" "}
                  This is expected. Its DNS records were disabled automatically when ownership
                  changed, and the new owner starts from a clean slate.
                </li>
                <li>
                  <span className="font-medium text-foreground">Have several wallets?</span> Check
                  you&apos;re connected with the one that holds this name.
                </li>
              </ul>
            </CardContent>
          )}
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
    where: { namespace: ns.key, claimedName: auth.name, status: "ACTIVE", isManagedRedirect: false },
    orderBy: { createdAt: "asc" },
  });

  const redirects = await prisma.urlRedirect.findMany({
    where: { namespace: ns.key, claimedName: auth.name },
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
        emailEnabled={isEmailEnabledName(auth.name)}
        redirectEnabled={isRedirectFeatureEnabled(ns.key)}
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
        initialRedirects={redirects.map((r) => ({
          id: r.id,
          claimedName: r.claimedName,
          fqdn: r.fqdn,
          relativeHost: r.relativeHost,
          destinationUrl: r.destinationUrl,
          statusCode: r.statusCode as 301 | 302 | 307 | 308,
          enabled: r.status === "ACTIVE",
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
