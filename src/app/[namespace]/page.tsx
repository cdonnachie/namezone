import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ArrowUpRight, BadgeCheck, ShieldCheck, Lock, Globe2, Ban, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { NamespaceLogo } from "@/components/namespace-logo";
import { getSession } from "@/lib/auth/session";
import { sourceNameToBaseFqdn } from "@/lib/dns/validation";
import { getNamespace } from "@/lib/namespaces";
import { listVerifiedTeamNames } from "@/lib/verified-names";

export default async function NamespaceLandingPage({
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
  const primaryHref = session ? `/${ns.key}/dashboard` : `/${ns.key}/connect`;
  const primaryLabel = session ? "Go to Dashboard" : "Connect Wallet";
  const primaryExample = ns.exampleNames[0];
  const verifiedNames = await listVerifiedTeamNames(ns);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="flex flex-col items-center gap-6 py-20 text-center sm:py-28">
        <NamespaceLogo namespace={ns} size={72} priority alt={ns.chainName} />
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Powered by {ns.chainName}
        </p>
        {primaryExample && (
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
            Own <span className="text-primary">{primaryExample.source}</span>,<br />
            manage <span className="text-primary">{primaryExample.zone}</span>.
          </h1>
        )}
        <p className="max-w-xl text-balance text-muted-foreground sm:text-lg">
          Lets verified owners of a {ns.chainName === "Radiant" ? ns.chainName + " Wave Name" : ns.chainName + " Name"}  manage public DNS
          records for their namespace &mdash; point at GitHub Pages, Vercel, or Netlify with a
          CNAME, get a real SSL certificate, no shared registrar required.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href={primaryHref}>
              {primaryLabel} <ArrowRight className="ml-1 size-4" />
            </Link>
          </Button>
          {!session && (
            <Button asChild size="lg" variant="outline">
              <Link href={`/${ns.key}/connect?tab=manual`}>Verify {ns.chainName} Name</Link>
            </Button>
          )}
        </div>
      </section>

      <section className="pb-16">
        <Card>
          <CardHeader>
            <CardTitle>How the mapping works</CardTitle>
            <CardDescription>
              Owning a single {ns.chainName} name gives you full DNS control over its zone.
              {primaryExample && (
                <>
                  {" "}
                  {primaryExample.source} unlocks A, AAAA, and CNAME records anywhere under{" "}
                  {primaryExample.zone}
                </>
              )}{" "}
              &mdash; add @, www, test, api, or any other hostname, no separate registration
              needed per subdomain.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              {ns.exampleNames.map((ex) => (
                <div
                  key={ex.zone}
                  className="flex flex-col items-center gap-2 rounded-lg border bg-muted/30 p-4 text-center"
                >
                  <code className="font-mono text-sm font-medium">{ex.source}</code>
                  <ArrowRight className="size-4 text-muted-foreground" />
                  <code className="font-mono text-sm text-primary">{ex.zone}</code>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {verifiedNames.length > 0 && (
        <section className="pb-16">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BadgeCheck className="size-5 text-primary" /> Official {ns.chainName} team sites
              </CardTitle>
              <CardDescription>
                Verified against on-chain ownership &mdash; every other {ns.dnsZone} subdomain
                is run by an independent name owner.{" "}
                <Link
                  href={`/${ns.key}/official`}
                  className="font-medium text-primary underline underline-offset-4"
                >
                  See the full list
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {verifiedNames.map((name) => {
                const zone = sourceNameToBaseFqdn(name, ns).replace(/\.$/, "");
                return (
                  <a
                    key={name}
                    href={`https://${zone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border bg-muted/30 px-3 py-1.5 font-mono text-sm font-medium transition-colors hover:border-primary/50 hover:bg-accent"
                  >
                    <BadgeCheck className="size-3.5 text-primary" />
                    {zone}
                    <ArrowUpRight className="size-3.5 text-muted-foreground" />
                  </a>
                );
              })}
            </CardContent>
          </Card>
        </section>
      )}

      <section className="pb-16">
        <Alert className="border-primary/30 bg-primary/10 p-4 has-[>svg]:gap-x-3 [&>svg]:text-primary">
          <ShieldAlert className="size-12 self-center" />
          <AlertTitle>Building something with logins on your subdomain?</AlertTitle>
          <AlertDescription>
            Until {ns.dnsZone} is on the Public Suffix List, browsers treat all its subdomains
            as one &quot;site&quot; - so cookies need extra care. It&apos;s two rules, and they&apos;re
            easy:{" "}
            <Link
              href={`/${ns.key}/help#security`}
              className="font-medium text-primary underline underline-offset-4"
            >
              read the security guide
            </Link>
            .
          </AlertDescription>
        </Alert>
      </section>

      <section className="grid gap-4 pb-24 sm:grid-cols-2 lg:grid-cols-4">
        <FeatureCard
          icon={<ShieldCheck className="size-5" />}
          title="Ownership-verified"
          description={`Every write is checked against ${ns.chainName} ownership before it ever reaches PowerDNS.`}
        />
        <FeatureCard
          icon={<Lock className="size-5" />}
          title="Server-side only"
          description="The PowerDNS API key never leaves the server. All writes happen through audited API routes."
        />
        <FeatureCard
          icon={<Globe2 className="size-5" />}
          title="A, AAAA & CNAME"
          description="Host on GitHub Pages, Vercel, or Netlify with a CNAME, and get SSL via a scoped ACME TXT challenge - no MX, NS, or wildcard surprises."
        />
        <FeatureCard
          icon={<Ban className="size-5" />}
          title="Namespace isolation"
          description={`${primaryExample?.source ?? "your name"} can never touch another owner's zone, ${ns.dnsZone} itself, or the nameserver records.`}
        />
      </section>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
