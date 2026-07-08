import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DisconnectButton } from "@/components/disconnect-button";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getNamespace } from "@/lib/namespaces";
import { formatRelativeTime } from "@/lib/utils";

const ACTION_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  CREATE: "default",
  UPDATE: "secondary",
  DELETE: "destructive",
  DISABLE: "destructive",
};

export default async function SettingsPage({
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

  const logs = await prisma.auditLog.findMany({
    where: { namespace: ns.key, address: session.address },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>The verified {ns.chainName} address currently signed in.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="break-all rounded-md bg-muted px-3 py-2 font-mono text-sm">
            {session.address}
          </span>
          <DisconnectButton namespace={ns.key} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent DNS changes</CardTitle>
          <CardDescription>
            The last 50 changes made across all of your {ns.chainName} names.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No changes yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatRelativeTime(log.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono">{log.claimedName}</TableCell>
                    <TableCell>
                      <Badge variant={ACTION_VARIANT[log.action] ?? "secondary"}>{log.action}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {log.fqdn} ({log.type})
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {log.oldValue ?? "—"} &rarr; {log.newValue ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
