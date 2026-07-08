import Link from "next/link";
import type { NamespaceConfig } from "@/lib/namespaces";
import { getSession } from "@/lib/auth/session";
import { NamespaceLogo } from "@/components/namespace-logo";
import { MobileNav } from "@/components/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { NavAuthActions } from "@/components/nav-auth-actions";

export async function NavBar({ namespace }: { namespace: NamespaceConfig }) {
  const session = await getSession(namespace.key);

  return (
    <header className="border-b bg-sidebar/90 backdrop-blur supports-backdrop-filter:bg-sidebar/75 sticky top-0 z-40">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4">
        <Link
          href={`/${namespace.key}`}
          className="flex min-w-0 items-center gap-2 font-semibold tracking-tight text-base sm:text-lg"
        >
          <NamespaceLogo namespace={namespace} size={28} priority />
          <span className="truncate whitespace-nowrap">{namespace.displayName}</span>
        </Link>
        <nav className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Inline links on md+; collapsed into the hamburger below md */}
          <div className="hidden items-center gap-1 md:flex lg:gap-2">
            {session && (
              <>
                <Link
                  href={`/${namespace.key}/dashboard`}
                  className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Dashboard
                </Link>
                <Link
                  href={`/${namespace.key}/settings`}
                  className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Settings
                </Link>
              </>
            )}
            <Link
              href={`/${namespace.key}/lookup`}
              className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Lookup
            </Link>
            <Link
              href={`/${namespace.key}/help`}
              className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Help
            </Link>
          </div>
          <ThemeToggle />
          <div className="hidden md:block">
            <NavAuthActions namespace={namespace.key} address={session?.address ?? null} />
          </div>
          <div className="md:hidden">
            <MobileNav namespace={namespace.key} address={session?.address ?? null} />
          </div>
        </nav>
      </div>
    </header>
  );
}
