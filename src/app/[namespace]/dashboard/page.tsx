import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getOwnedNameSummaries } from "@/lib/ownership/names-for-owner";
import { getSession } from "@/lib/auth/session";
import { getNamespace } from "@/lib/namespaces";
import { formatRelativeTime } from "@/lib/utils";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ namespace: string }>;
}) {
  const { namespace: key } = await params;
  let ns;
  try {
    ns = getNamespace(key);
  } catch {
    notFound();
  }

  const session = await getSession(ns.key);
  if (!session) redirect(`/${ns.key}/connect`);

  const names = await getOwnedNameSummaries(ns, session.address);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Your {ns.chainName} names</h1>
        <p className="text-sm text-muted-foreground">
          Verified owner: <span className="font-mono">{session.address}</span>
        </p>
      </div>

      {names.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No {ns.chainName} names found</CardTitle>
            <CardDescription>
              We couldn&apos;t find any {ns.chainName} names owned by this address. If you just
              registered one, ownership may take a moment to sync. Just bought a name from someone?
              Make sure you&apos;re connected with the wallet address that received it &mdash; the
              blockchain decides the owner, and this site follows it.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {names.map((n) => (
            <Card key={n.name} className="flex flex-col">
              <CardHeader className="flex-1">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
                    <Globe className="size-4 shrink-0 text-muted-foreground" />
                    <span className="break-all">{n.name}</span>
                  </CardTitle>
                  <Badge variant="secondary" className="shrink-0">
                    {n.recordCount} record{n.recordCount === 1 ? "" : "s"}
                  </Badge>
                </div>
                <CardDescription className="break-all font-mono">{n.zone}</CardDescription>
                {n.transferJustDetected && (
                  <Badge className="mt-2 w-fit bg-amber-500/15 text-amber-600 hover:bg-amber-500/15 dark:text-amber-400">
                    Ownership recently transferred to you - old records were disabled
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="flex items-center justify-between pt-0">
                <span className="text-xs text-muted-foreground">
                  Updated {formatRelativeTime(n.lastUpdated)}
                </span>
                <Button asChild size="sm">
                  <Link href={`/${ns.key}/dashboard/${encodeURIComponent(n.name)}`}>
                    Manage <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
