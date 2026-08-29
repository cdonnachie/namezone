import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getHandoffApp, isAllowedRedirectUri } from "@/lib/auth/handoff";
import { getSession } from "@/lib/auth/session";
import { getNamespace } from "@/lib/namespaces";
import { AuthorizeForm } from "./authorize-form";

/**
 * Consent screen for a companion app's sign-in handoff.
 *
 * A signed-in owner lands here from the app, sees which app is asking and
 * which address it will be told about, and approves or declines. Someone who
 * is not signed in is sent through the normal connect flow first and returned
 * here afterwards, so the app never has to know anything about wallets.
 */
export default async function AuthorizePage({
  params,
  searchParams,
}: {
  params: Promise<{ namespace: string }>;
  searchParams: Promise<{ redirect_uri?: string }>;
}) {
  const { namespace: key } = await params;
  let ns;
  try {
    ns = getNamespace(key);
  } catch {
    notFound();
  }

  const app = getHandoffApp();
  if (!app) notFound();

  const { redirect_uri: redirectUri } = await searchParams;
  // Validate before sending anyone through sign-in: better to fail here than
  // to make someone authenticate only to be refused at the last step.
  if (!redirectUri || !isAllowedRedirectUri(redirectUri, app)) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Sign-in request rejected</CardTitle>
            <CardDescription>
              This request asked to return to an address that is not on this server&apos;s allowlist,
              so no sign-in was attempted. Start again from {app.name}.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const session = await getSession(ns.key);
  if (!session) {
    const next = `/${ns.key}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`;
    redirect(`/${ns.key}/connect?next=${encodeURIComponent(next)}`);
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to {app.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {app.name} is asking to sign you in using the {ns.chainName} address you have verified here.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What {app.name} will be told</CardTitle>
          <CardDescription>
            Only your verified address. It receives no signing ability, no access to your wallet,
            and no ability to change DNS records on your behalf.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">Address</p>
            <p className="mt-1 break-all font-mono text-sm">{session.address}</p>
          </div>
          <AuthorizeForm
            namespace={ns.key}
            appName={app.name}
            redirectUri={redirectUri}
          />
        </CardContent>
      </Card>
    </div>
  );
}
