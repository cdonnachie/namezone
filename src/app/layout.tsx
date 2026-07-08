import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// Self-hosted from public/fonts via next/font/local (no Google Fonts fetch
// at build time, so production builds work offline; the files get hashed
// into _next/static and preloaded automatically). Inter everywhere (all
// namespaces): 400 body, 500/600/700 for headings - see the base-layer
// heading rule in globals.css. Named "--font-sans" directly because that's
// the variable the Tailwind theme tokens (--font-sans/--font-heading in
// globals.css) resolve to.
const inter = localFont({
  src: "../../public/fonts/InterVariable.woff2",
  variable: "--font-sans",
  weight: "100 900",
});

// Roboto Mono for addresses, DNS record values, and challenge messages
// (latin-subset variable font - all mono content here is ASCII by
// validation, so the subset is sufficient).
const robotoMono = localFont({
  src: "../../public/fonts/RobotoMonoVariable.woff2",
  variable: "--font-mono",
  weight: "100 700",
});

// Generic fallback metadata for the neutral portal ("/") and anything that
// doesn't override it. Namespace routes (src/app/[namespace]/layout.tsx)
// set their own branded title/icons/OG image via generateMetadata.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: "Name Zone",
  description: "Manage public DNS records tied to on-chain name ownership.",
  // Deliberately NO `icons` here: declaring one makes Next emit the portal
  // icon link on every page ALONGSIDE the namespace layouts' branded icons
  // (parent+child icon links accumulate rather than replace), and browsers
  // then pick between the two inconsistently. The neutral portal icon is
  // served via the browser's implicit /favicon.ico fallback instead
  // (public/favicon.ico), which only applies to pages that declare no icon.
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#19827a" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${robotoMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
