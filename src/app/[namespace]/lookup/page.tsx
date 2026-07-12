import { notFound } from "next/navigation";
import { BadgeCheck, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { getNamespace } from "@/lib/namespaces";
import { sourceNameToBaseFqdn, validateSourceName } from "@/lib/dns/validation";
import { isVerifiedTeamName } from "@/lib/verified-names";

export default async function LookupPage({
  params,
  searchParams,
}: {
  params: Promise<{ namespace: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const { namespace: key } = await params;
  let ns;
  try {
    ns = getNamespace(key);
  } catch {
    notFound();
  }

  const { name: rawName } = await searchParams;
  const query = rawName?.trim() ?? "";

  let error: string | null = null;
  let resolvedName: string | null = null;
  let verified = false;
  let records: Awaited<ReturnType<typeof prisma.dnsRecord.findMany>> = [];

  if (query) {
    const parsed = validateSourceName(query, ns);
    if (!parsed.ok) {
      error = parsed.error;
    } else {
      resolvedName = parsed.value;
      [records, verified] = await Promise.all([
        prisma.dnsRecord.findMany({
          where: { namespace: ns.key, claimedName: parsed.value, status: "ACTIVE", isAcmeChallenge: false },
          orderBy: [{ relativeHost: "asc" }, { type: "asc" }],
        }),
        isVerifiedTeamName(ns, parsed.value),
      ]);
    }
  }

  const example = ns.exampleNames[0]?.source ?? `bob.${ns.tld}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">DNS Lookup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Check the current public DNS records for any {ns.chainName} name &mdash; no sign-in
          required.
        </p>
      </div>

      <form className="mb-6 flex gap-2">
        <Input
          name="name"
          placeholder={`e.g. ${example}`}
          defaultValue={query}
          className="font-mono"
          aria-label={`${ns.chainName} name`}
        />
        <Button type="submit">
          <Search className="size-4" /> Look up
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {resolvedName && !error && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 break-all font-mono text-base">
              {sourceNameToBaseFqdn(resolvedName, ns)}
              {verified && (
                <Badge className="font-sans">
                  <BadgeCheck className="size-3.5" /> Official
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {verified && (
                <>
                  An official {ns.chainName} project name &mdash; verified against on-chain
                  ownership.{" "}
                </>
              )}
              {records.length} active record{records.length === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {records.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No public DNS records configured for this name yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hostname</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>TTL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => (
                    <TableRow key={`${r.fqdn}-${r.type}-${r.value}`}>
                      <TableCell className="font-mono">{r.relativeHost}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.type}</Badge>
                      </TableCell>
                      <TableCell className="font-mono">{r.value}</TableCell>
                      <TableCell className="text-muted-foreground">{r.ttl}s</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
