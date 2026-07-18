# Managed URL Redirects — Deployment

Redirects let a name owner point a hostname under a managed zone at any URL,
e.g. `x.craigd.rxd.zone → https://x.com/you`, with automatic HTTPS and no DNS
or server setup on their part. This document covers what an operator must
configure. The feature is namespace-agnostic: it lights up for any zone
(`rxd.zone`, `avn.zone`, a future `xyz.zone`) once that zone's redirect service
IP is set.

## How it fits together

1. Owner creates a redirect in the DNS manager. The app writes A/AAAA records
   (`x.craigd.rxd.zone → REDIRECT_SERVICE_IPV4/6`) to PowerDNS and stores the
   redirect (destination + status code) in the database.
2. A visitor hits `https://x.craigd.rxd.zone`. DNS resolves it to the Caddy box.
3. Caddy asks the app (`/api/internal/tls/authorize`) before issuing a cert; the
   app returns `200` only for an enabled redirect in a managed zone. Caddy then
   obtains the certificate (TLS-ALPN / HTTP-01) and caches it.
4. Caddy reverse-proxies to the Next.js app on `:3000`. Middleware routes the
   request to the redirect service by Host header, which returns the configured
   `3xx` + `Location`. It never fetches or proxies the destination.

## Environment variables

Set in `/opt/namezone/.env` (see `.env.example` for full comments):

| Variable | Required | Purpose |
| --- | --- | --- |
| `REDIRECT_SERVICE_IPV4` / `REDIRECT_SERVICE_IPV6` | at least one | Public IP(s) of the Caddy box; redirect hostnames get A/AAAA to these. Feature is off for a namespace with no target. |
| `RADIANT_REDIRECT_SERVICE_IPV4` (etc.) | no | Per-namespace override (uppercased namespace key prefix). |
| `REDIRECT_ENABLED` | no | Set `false` to disable everywhere regardless of the IPs. |
| `REDIRECT_RESERVED_HOSTS` | no | Comma-separated per-name reserved labels (default none). |
| `REDIRECT_TLS_AUTH_SECRET` | only if the authorize endpoint isn't network-isolated | Shared secret Caddy sends as `Authorization: Bearer …`. |
| `REDIRECT_TLS_AUTH_RATE_LIMIT` | no | Max issuance-authorization checks/min (default 60). |

## PowerDNS record strategy

Redirect hostnames point at the redirect service with **A/AAAA records**, not a
CNAME (a CNAME to an in-zone shared host is rejected by the ownership-scoped
target validation, and A/AAAA resolves the hostname straight to Caddy, which
on-demand TLS requires). The app manages these records automatically; no manual
`pdnsutil` work per redirect. Ensure the zones' A/AAAA at the service IP are
reachable on ports 80/443.

## Firewall / network assumptions

- Inbound `80` and `443` to the Caddy box (ACME HTTP-01 + serving).
- `/api/internal/tls/authorize` should be reachable **only** from Caddy /
  localhost. If Caddy is co-located, it calls `http://127.0.0.1:3000/...` and no
  firewall rule exposes it. If not, restrict it at the network layer AND set
  `REDIRECT_TLS_AUTH_SECRET`.
- PowerDNS API stays private (already the case).

## Deploy steps

1. Point DNS: create/verify A/AAAA for the operator's own hosts (bare zones +
   any app host) and ensure the redirect service IP resolves and is reachable.
2. `git pull` on the app host, then:
   ```
   npm ci
   npx prisma migrate deploy      # applies 20260718130954_add_url_redirects
   npm run build
   ```
3. Set the redirect env vars in `/opt/namezone/.env`.
4. Install Caddy and point it at `deploy/Caddyfile` (set `MANAGEMENT_HOSTS`,
   optional `ACME_EMAIL`). Reload Caddy.
5. Install `deploy/namezone.service`, then `systemctl daemon-reload &&
   systemctl restart namezone`.
6. Smoke test: `curl -I https://<a-test-redirect-host>` returns the `3xx`;
   `curl -sf http://127.0.0.1:3000/api/ready` returns `{"status":"ready"}`.

## Rollback

The feature is additive and gated. To disable without reverting code, set
`REDIRECT_ENABLED=false` and restart the app — the UI hides redirects and the
API/authorize endpoint refuse new work; existing DNS rows are untouched.

To roll back the code: redeploy the previous build. The migration only adds a
table and a defaulted column, so leaving it applied is harmless. If you must
revert the schema, restore from the SQLite backup taken by
`scripts/backup-namezone.sh` (a plain `DROP TABLE "UrlRedirect"` plus dropping
the `isManagedRedirect` column also works on a maintenance window).
