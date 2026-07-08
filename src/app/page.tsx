import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { NamespaceLogo } from "@/components/namespace-logo";
import { listAllNamespaces } from "@/lib/namespaces";

export default function PortalPage() {
  const namespaces = listAllNamespaces();

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col items-center justify-center px-4 py-20">
      <div className="mb-12 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Name Zone</h1>
        <p className="mt-3 max-w-xl text-balance text-muted-foreground sm:text-lg">
          Manage public DNS records tied to on-chain name ownership. One DNS gateway, a
          namespace per chain.
        </p>
      </div>

      <div className="grid w-full gap-4 sm:grid-cols-2">
        {namespaces.map((ns) => (
          <Card key={ns.key} className={!ns.enabled ? "opacity-70" : undefined}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <NamespaceLogo namespace={ns} size={32} />
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {ns.displayName}
                    {!ns.enabled && <Badge variant="secondary">Coming soon</Badge>}
                  </CardTitle>
                  <CardDescription className="font-mono">{ns.dnsZone}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {ns.enabled ? (
                <Button asChild className="w-full">
                  <Link href={`/${ns.key}`}>
                    Open {ns.displayName} <ArrowRight className="size-4" />
                  </Link>
                </Button>
              ) : (
                <Button className="w-full" disabled>
                  Not yet available
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
