import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Nothing here is meant to be iframed - block clickjacking of the
          // dashboard/connect flows outright. (No full CSP yet: Next.js
          // injects inline scripts, so a real script-src policy needs
          // nonce-based CSP wiring, which isn't worth it for this app today.)
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  webpack: (config, { dev }) => {
    // The DNS management pages/API routes write to the SQLite dev database
    // on every read (reconciling against PowerDNS - see
    // src/lib/dns/reconcile.ts). Without excluding the db files here, the
    // dev server's file watcher treats those writes as source changes,
    // triggers Fast Refresh, which re-renders the page, which reconciles
    // again, which writes again - an infinite rebuild loop.
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/prisma/dev.db",
          "**/prisma/dev.db-journal",
          "**/prisma/dev.db-wal",
          "**/prisma/dev.db-shm",
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
