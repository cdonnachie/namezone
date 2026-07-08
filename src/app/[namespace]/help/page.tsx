import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getNamespace } from "@/lib/namespaces";

export default async function HelpPage({
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

  const example = ns.exampleNames[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Help &amp; FAQ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Plain-language answers for managing DNS on your {ns.chainName} name.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What is DNS?</CardTitle>
          <CardDescription>
            DNS (Domain Name System) is the phonebook of the internet - it maps a hostname like{" "}
            {example ? example.zone : ns.dnsZone} to the actual server that should answer for it.
            When someone visits your site, their browser looks up the DNS record you created here
            to find where to connect.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Owning a name vs. managing DNS</CardTitle>
          <CardDescription>
            Owning a single {ns.chainName} name (like {example?.source ?? "bob"}) gives you full
            control over everything under its zone. You don&apos;t need to separately register
            www, test, api, or any other hostname - once you own the base name, you can add or
            remove records for any hostname beneath it at any time.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Record types</CardTitle>
          <CardDescription>The three record types you can create here, and when to use each.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium">A record</p>
            <p className="text-muted-foreground">
              Points a hostname at an IPv4 address (e.g. 203.0.113.20). Use this if your host
              gives you a plain numeric IP address to point at.
            </p>
          </div>
          <div>
            <p className="font-medium">AAAA record</p>
            <p className="text-muted-foreground">
              The same idea as an A record, but for an IPv6 address (e.g. 2001:db8::1) instead of
              an IPv4 one. Only use this if your host specifically gave you an IPv6 address.
            </p>
          </div>
          <div>
            <p className="font-medium">CNAME record</p>
            <p className="text-muted-foreground">
              Points a hostname at another hostname instead of an IP address - e.g. pointing{" "}
              www at your-site.github.io. Most hosting providers (GitHub Pages, Vercel, Netlify)
              give you a hostname to use as a CNAME target. A hostname can have A/AAAA records or
              a single CNAME, but never both at once.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Getting an SSL certificate (HTTPS)</CardTitle>
          <CardDescription>
            What the &quot;Add SSL Challenge&quot; button and TXT records are for.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            To get a free SSL certificate (so your site shows the padlock/https), certificate
            authorities like Let&apos;s Encrypt need proof that you actually control the domain.
            Tools like Certbot do this with a &quot;DNS-01 challenge&quot;: they ask you to
            publish a specific, random text value in a TXT record under{" "}
            <code className="font-mono">_acme-challenge</code>, then check that it&apos;s there.
          </p>
          <p>
            The &quot;Add SSL Challenge&quot; button creates that TXT record for you - paste in
            the value your ACME client (Certbot, etc.) gives you, save, and let the client
            continue. These records are temporary and expire automatically; you don&apos;t need
            to remember to clean them up.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Why do changes take a moment to appear?</CardTitle>
          <CardDescription>
            Every record here has a 300-second (5 minute) TTL (&quot;time to live&quot;) - that&apos;s
            how long other DNS servers around the internet are allowed to cache your old answer
            before checking again. After saving a change, it can take up to five minutes to be
            visible everywhere.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who can change my records?</CardTitle>
          <CardDescription>
            Only the current on-chain owner of a {ns.chainName} name can manage its DNS here -
            every write is checked against live {ns.chainName} ownership first. If the name is
            ever transferred to a new owner, the previous owner&apos;s records are disabled
            automatically and the new owner starts with a clean slate.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
