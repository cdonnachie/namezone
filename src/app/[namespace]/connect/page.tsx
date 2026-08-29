import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getNamespace } from "@/lib/namespaces";
import { ConnectFlow } from "./connect-flow";

/**
 * Only a same-origin absolute path is accepted as a post-sign-in destination.
 *
 * Rejecting "//host" and "/\host" matters as much as rejecting "https://host":
 * browsers read a leading "//" (and, forgivingly, "/\") as protocol-relative,
 * so either would send a user who has just authenticated straight off-site.
 */
function safeNext(next: string | undefined): string | undefined {
  if (!next) return undefined;
  if (!next.startsWith("/")) return undefined;
  if (next.startsWith("//") || next.startsWith("/\\")) return undefined;
  return next;
}

export default async function ConnectPage({
  params,
  searchParams,
}: {
  params: Promise<{ namespace: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { namespace: key } = await params;
  let ns;
  try {
    ns = getNamespace(key);
  } catch {
    notFound();
  }

  const { next: rawNext } = await searchParams;
  const next = safeNext(rawNext);

  const session = await getSession(ns.key);
  if (session) redirect(next ?? `/${ns.key}/dashboard`);

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
        next={next}
      />
    </div>
  );
}
