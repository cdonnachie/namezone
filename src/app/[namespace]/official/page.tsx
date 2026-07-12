import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { sourceNameToBaseFqdn } from "@/lib/dns/validation";
import { getNamespace } from "@/lib/namespaces";
import { listVerifiedTeamNames } from "@/lib/verified-names";

/**
 * Public registry of core-team verified names - the canonical page to link
 * when someone asks "is this site really run by the team?". Names configured
 * but currently failing verification (transferred, never claimed) are
 * omitted entirely rather than shown as "formerly official".
 */
export default async function OfficialSitesPage({
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

  const names = await listVerifiedTeamNames(ns);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Official {ns.chainName} sites</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Names operated by the {ns.chainName} project itself. Anything under {ns.dnsZone} that
          isn&apos;t listed here is run by an independent name owner &mdash; treat it like any
          unrelated website.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BadgeCheck className="size-5 text-primary" /> Verified official names
          </CardTitle>
          <CardDescription>
            Verification is tied to on-chain ownership, not just the name: a name only appears
            here while the wallet holding it matches the address the project registered with us.
            If the name is ever sold or transferred, it drops off this list automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {names.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No verified team names are published yet.
            </p>
          ) : (
            <ul className="divide-y">
              {names.map((name) => {
                const zone = sourceNameToBaseFqdn(name, ns).replace(/\.$/, "");
                return (
                  <li key={name} className="flex flex-wrap items-center gap-2 py-3">
                    <Badge className="font-sans">
                      <BadgeCheck className="size-3.5" /> Official
                    </Badge>
                    <a
                      href={`https://${zone}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 break-all font-mono text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {zone} <ArrowUpRight className="size-3.5" />
                    </a>
                    <Link
                      href={`/${ns.key}/lookup?name=${encodeURIComponent(name)}`}
                      className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      view DNS records
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 text-xs text-muted-foreground">
        Site owners: a &quot;verified&quot; badge displayed on a website itself proves nothing
        &mdash; anyone can copy an image. Link to your own{" "}
        <Link href={`/${ns.key}/lookup`} className="underline underline-offset-2 hover:text-foreground">
          DNS lookup page
        </Link>{" "}
        instead, where the badge is rendered by this service and can&apos;t be faked.
      </p>

      <p className="mt-2 text-xs text-muted-foreground">
        Work on the {ns.chainName} project and have a name that should be listed here? Reach out
        in the community Discord or via the{" "}
        <Link href={`/${ns.key}/help#abuse`} className="underline underline-offset-2 hover:text-foreground">
          contact address on the help page
        </Link>{" "}
        with the name and the team wallet address that holds it.
      </p>
    </div>
  );
}
