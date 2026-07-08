import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NavBar } from "@/components/nav-bar";
import { NamespaceThemeSync } from "@/components/namespace-theme-sync";
import { getNamespace } from "@/lib/namespaces";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ namespace: string }>;
}): Promise<Metadata> {
  const { namespace: key } = await params;
  let ns;
  try {
    ns = getNamespace(key);
  } catch {
    return {};
  }

  return {
    title: ns.displayName,
    description: `Manage public DNS records for your ${ns.chainName} names.`,
    icons: { icon: ns.faviconPath, apple: ns.logoPath },
    openGraph: {
      title: ns.displayName,
      description: `Manage public DNS records for your ${ns.chainName} names.`,
      images: [ns.logoPath],
    },
  };
}

export default async function NamespaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ namespace: string }>;
}) {
  const { namespace: key } = await params;
  let ns;
  try {
    ns = getNamespace(key);
  } catch {
    notFound();
  }

  return (
    // data-namespace scopes the brand color overrides in globals.css to this
    // subtree. bg-background/text-foreground must be re-applied here (not
    // just inherited from <body>) because body's own background-color was
    // already resolved against the unscoped root tokens - custom properties
    // set on this div don't retroactively repaint an ancestor's background.
    // min-h-dvh (not min-h-full) so short pages still cover the full
    // viewport - percentage heights need every ancestor to have a definite
    // height, which body (min-h-full only) doesn't reliably give us.
    <div data-namespace={ns.key} className="flex min-h-dvh flex-col bg-background text-foreground">
      <NamespaceThemeSync namespace={ns.key} />
      <NavBar namespace={ns} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
