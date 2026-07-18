import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getOwnedNameSummaries } from "@/lib/ownership/names-for-owner";
import { getSession } from "@/lib/auth/session";
import { getNamespace } from "@/lib/namespaces";
import { NAMES_VIEW_COOKIE, NamesBrowser } from "./names-browser";

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

  // The card/list preference lives in a cookie (not localStorage) so this
  // server render can paint the chosen view directly - localStorage is only
  // readable after hydration, which made list view flash cards on refresh.
  const initialView =
    (await cookies()).get(NAMES_VIEW_COOKIE)?.value === "list" ? ("list" as const) : ("cards" as const);

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
        <NamesBrowser
          namespace={ns.key}
          initialView={initialView}
          names={names.map((n) => ({
            name: n.name,
            zone: n.zone,
            recordCount: n.recordCount,
            lastUpdated: n.lastUpdated.toISOString(),
            transferJustDetected: n.transferJustDetected,
          }))}
        />
      )}
    </div>
  );
}
