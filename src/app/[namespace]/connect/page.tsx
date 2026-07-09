import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getNamespace } from "@/lib/namespaces";
import { ConnectFlow } from "./connect-flow";

export default async function ConnectPage({
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
  if (session) redirect(`/${ns.key}/dashboard`);

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Verify {ns.chainName} ownership</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign a one-time challenge with the {ns.chainName} address that owns your name to
          unlock DNS management for its namespace.
        </p>
      </div>
      <ConnectFlow
        namespace={ns.key}
        chainName={ns.chainName}
        tld={ns.tld}
        addressPlaceholder={ns.addressPlaceholder}
      />
    </div>
  );
}
