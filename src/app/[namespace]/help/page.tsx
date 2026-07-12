import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getNamespace } from "@/lib/namespaces";
import { HelpTabs } from "./help-tabs";

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
  // Shown in the "Report abuse" card below - a visible abuse contact is a
  // Public Suffix List inclusion requirement, so keep this section (and the
  // inbox behind it) alive for as long as the zones are PSL-listed.
  const abuseEmail = process.env.ABUSE_CONTACT_EMAIL ?? "craig.donnachie@gmail.com";

  const basics = (
    <>
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

      <Card>
        <CardHeader>
          <CardTitle>How do I know a site is official?</CardTitle>
          <CardDescription>
            Every name under {ns.dnsZone} is run by whoever owns it on-chain - so an
            official-sounding name isn&apos;t automatically the {ns.chainName} team&apos;s.
            Names genuinely operated by the core team show a &quot;Core team&quot; badge on the{" "}
            <Link
              href={`/${ns.key}/lookup`}
              className="font-medium text-primary underline underline-offset-4"
            >
              DNS lookup page
            </Link>{" "}
            and are listed on the{" "}
            <Link
              href={`/${ns.key}/official`}
              className="font-medium text-primary underline underline-offset-4"
            >
              official sites page
            </Link>
            . The badge is tied to on-chain ownership, so if a team name were ever sold it
            disappears automatically. And don&apos;t trust a badge shown on a website itself -
            anyone can copy an image; check the name here instead.
          </CardDescription>
        </CardHeader>
      </Card>
    </>
  );

  const records = (
    <>
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

      <Card id="hosting">
        <CardHeader>
          <CardTitle>Hosting a site on your own server</CardTitle>
          <CardDescription>
            You&apos;ve pointed {example ? example.zone : ns.dnsZone} at your server&apos;s IP -
            here&apos;s how to serve it with HTTPS. Two good setups, easiest first. Both need
            ports 80 and 443 reachable from the internet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium">Caddy (easiest - HTTPS is automatic)</p>
            <p className="text-muted-foreground">
              <a
                href="https://caddyserver.com/docs/install"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline underline-offset-4"
              >
                Caddy
              </a>{" "}
              obtains and renews certificates by itself - no certbot, no TXT records, nothing to
              remember. This Caddyfile is the entire configuration:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
              {`${example ? example.zone : ns.dnsZone} {\n    reverse_proxy localhost:3000\n}`}
            </pre>
            <p className="mt-2 text-muted-foreground">
              Serving static files instead of an app? Replace the{" "}
              <code className="font-mono">reverse_proxy</code> line with{" "}
              <code className="font-mono">root * /var/www/site</code> and{" "}
              <code className="font-mono">file_server</code>.
            </p>
          </div>
          <div>
            <p className="font-medium">nginx + certbot</p>
            <p className="text-muted-foreground">
              Add a server block for your hostname, then let certbot fetch the certificate and
              wire up automatic renewal:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
              {`server {\n    listen 80;\n    listen [::]:80;\n    server_name ${example ? example.zone : ns.dnsZone};\n    root /var/www/site;   # or proxy_pass to your app\n}`}
            </pre>
            <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
              {`sudo certbot --nginx -d ${example ? example.zone : ns.dnsZone}`}
            </pre>
            <p className="mt-2 text-muted-foreground">
              To install certbot itself, follow the per-OS instructions at{" "}
              <a
                href="https://certbot.eff.org/instructions"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline underline-offset-4"
              >
                certbot.eff.org
              </a>
              .
            </p>
          </div>
          <div>
            <p className="font-medium">Can&apos;t open port 80?</p>
            <p className="text-muted-foreground">
              If your server sits behind a firewall or CGNAT and can&apos;t be reached on port
              80, use the &quot;Add SSL Challenge&quot; button and the DNS-01 flow described in
              the next section instead - it proves ownership through DNS, so no inbound
              connection is needed. The trade-off: certificates issued that way don&apos;t renew
              automatically.
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
          <p>
            One caveat: certificates issued through this manual DNS-01 flow{" "}
            <span className="font-medium text-foreground">don&apos;t renew automatically</span>{" "}
            - you&apos;ll repeat the paste-a-TXT-record step roughly every 90 days when the
            certificate expires. If your server is reachable on port 80, the setups in
            &quot;Hosting a site on your own server&quot; above get you a certificate that
            renews itself - only use this flow when they can&apos;t work.
          </p>
        </CardContent>
      </Card>

      <Card id="privacy">
        <CardHeader>
          <CardTitle>Your IP address is public</CardTitle>
          <CardDescription>
            DNS records are public information - anyone on the internet can look up the IP
            behind {example ? example.zone : ns.dnsZone}. If you point an A record at your home
            connection, you&apos;re publishing your home IP, which reveals your rough location
            and ISP and gives attackers a direct target. And passive-DNS services archive every
            answer they see: deleting the record later doesn&apos;t unpublish the IP it once
            held, so pick a setup you&apos;re comfortable with <em>before</em> creating the
            record. If that bothers you, you have options.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium">Use a small VPS instead</p>
            <p className="text-muted-foreground">
              Point your A record at a cheap VPS and host your site there (or have the VPS
              reverse-proxy to your home machine). Visitors only ever see the VPS&apos;s IP -
              your home IP never appears in DNS.
            </p>
          </div>
          <div>
            <p className="font-medium">Or use a tunnel with a CNAME</p>
            <p className="text-muted-foreground">
              Tunnel providers that support custom domains (ngrok&apos;s paid tier, Pangolin,
              and similar) give you a hostname to use as a CNAME target. Your machine keeps an
              outbound connection open to the provider, so you need no inbound ports, no port
              forwarding, and no published IP - this also works behind CGNAT. Note that plain
              Cloudflare Tunnel won&apos;t work here, because it requires adding{" "}
              {ns.dnsZone} - a zone you don&apos;t own - to a Cloudflare account.
            </p>
          </div>
          <div>
            <p className="font-medium">Delete CNAMEs you stop using (subdomain takeover)</p>
            <p className="text-muted-foreground">
              A CNAME keeps vouching for its target even after you cancel the service behind
              it. On many platforms an attacker can re-register your abandoned target hostname
              and then serve their own content - with a valid certificate - as your{" "}
              {example ? example.zone : ns.dnsZone} name. When you stop using a tunnel or
              hosting provider, delete the CNAME record at the same time.
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );

  const security = (
    <Card>
      <CardHeader>
        <CardTitle>Building a site on your subdomain? Read this first</CardTitle>
        <CardDescription>
          Every subdomain under {ns.dnsZone} is run by a different, independent name owner.
          Browsers use the{" "}
          <a
            href="https://publicsuffix.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline underline-offset-4"
          >
            Public Suffix List
          </a>{" "}
          to decide where one &quot;site&quot; ends and the next begins - we have applied to
          have {ns.dnsZone} listed, but until that lands, browsers treat all of{" "}
          {ns.dnsZone} as one site. If your subdomain hosts anything with logins or sessions,
          follow these rules.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <p className="font-medium">
            Never set a <code className="font-mono">Domain=</code> cookie
          </p>
          <p className="text-muted-foreground">
            A cookie scoped to the parent domain is readable and settable by{" "}
            <em>every other subdomain owner</em>. Don&apos;t do this:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {`Set-Cookie: session=abc123; Domain=.${ns.dnsZone}   # NEVER - shared with everyone`}
          </pre>
        </div>
        <div>
          <p className="font-medium">
            Use <code className="font-mono">__Host-</code> prefixed cookies
          </p>
          <p className="text-muted-foreground">
            The <code className="font-mono">__Host-</code> prefix makes the browser itself
            enforce that the cookie belongs to your hostname only - other subdomains can
            neither read it nor plant a lookalike that shadows yours. This works today, with
            or without the PSL:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {`Set-Cookie: __Host-session=abc123; Path=/; Secure; HttpOnly; SameSite=Lax`}
          </pre>
        </div>
        <div>
          <p className="font-medium">Don&apos;t rely on SameSite alone for CSRF protection</p>
          <p className="text-muted-foreground">
            Until the PSL listing lands, a request from any other {ns.dnsZone} subdomain
            counts as &quot;same-site&quot; to the browser, so{" "}
            <code className="font-mono">SameSite=Lax/Strict</code> won&apos;t block it. If
            your site has state-changing endpoints, also verify a CSRF token or check the{" "}
            <code className="font-mono">Origin</code> header against your exact hostname.
          </p>
        </div>
        <div>
          <p className="font-medium">What&apos;s already safe</p>
          <p className="text-muted-foreground">
            <code className="font-mono">localStorage</code>,{" "}
            <code className="font-mono">sessionStorage</code>, and IndexedDB are scoped to
            your exact hostname and are already isolated from other subdomains. And treat
            neighbouring subdomains the way you&apos;d treat any unrelated website - they
            belong to other people.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Once {ns.dnsZone} is accepted onto the Public Suffix List, browsers will enforce
          this isolation automatically - these practices are still good hygiene afterwards.
        </p>
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Help &amp; FAQ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Plain-language answers for managing DNS on your {ns.chainName} name.
        </p>
      </div>

      <HelpTabs basics={basics} records={records} security={security} />

      {/* Deliberately outside the tabs: /help#abuse is the abuse-contact URL
          cited in the Public Suffix List PR and must always be visible. */}
      <Card id="abuse">
        <CardHeader>
          <CardTitle>Report abuse</CardTitle>
          <CardDescription>
            Each site under {ns.dnsZone} is operated independently by whoever owns the
            corresponding {ns.chainName} name - not by us. If you believe a {ns.dnsZone}{" "}
            subdomain is hosting phishing, malware, or other abusive content, please report it
            to{" "}
            <a href={`mailto:${abuseEmail}`} className="font-medium text-primary underline underline-offset-4">
              {abuseEmail}
            </a>{" "}
            with the full hostname and a short description. We review every report and can
            disable the offending DNS records.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
