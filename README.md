# Name Zone

Name Zone is a multi-namespace DNS gateway: the verified owner of a blockchain-native name
(currently an Avian Name System name like `bob.avn`) can manage public DNS records for its
corresponding zone. `bob.avn` maps 1:1 to `bob.avn.zone`; the owner of `bob.avn` may manage
`bob.avn.zone` and any child hostname under it (e.g. `test.bob.avn.zone`).

The app never owns names. It only verifies ownership (by signature + a chain-specific ownership
lookup) and then writes A/AAAA/CNAME records (plus narrowly-scoped ACME TXT challenges) to a
PowerDNS Authoritative server on the owner's behalf.

The DNS management, PowerDNS integration, record validation, transfer handling, and abuse
controls are chain-agnostic. Only ownership verification, signature verification, and branding
differ per chain, so those are the only pieces implemented per **namespace** — everything else
is shared. Both **Avian** (`.avn` → `avn.zone`) and **Radiant** (`.rxd` → `rxd.zone`, Wave Names)
are fully-working namespaces, each backed by real on-chain ownership lookups and real
signed-message verification (see "Adding a new namespace" below for how a namespace plugs in).

## Tech stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui (Radix primitives)
- Prisma ORM, SQLite by default (Postgres-compatible schema)
- PowerDNS Authoritative HTTP API (server-side only, shared across all namespaces)
- Zod for API input validation
- Vitest for unit tests

## Namespace architecture

A **namespace** is a static, code-configured chain integration — not a database row. Each one
bundles everything that's chain-specific:

```ts
interface NamespaceConfig {
  key: string;              // "avian" | "radiant" - URL segment + internal id
  displayName: string;      // "Avian Name Zone"
  chainName: string;        // "Avian"
  tld: string;              // "avn"
  dnsZone: string;          // "avn.zone"
  logoPath: string;
  logoPathDark?: string;    // optional separate logo for dark mode
  faviconPath: string;
  brandColor: string;
  addressPlaceholder: string; // e.g. "RAddressOwningYourName" vs. "1AddressOwningYourName"
  exampleNames: NamespaceExample[];
  enabled: boolean;         // false hides/404s the namespace's routes entirely
  adapter: OwnershipAdapter;
}
```

`src/lib/namespaces/registry.ts` exports `NAMESPACES` and `getNamespace(key)` (throws
`NamespaceNotFoundError` for an unknown or disabled key — route handlers turn that into a 404).
All chain-agnostic code (DNS validation, PowerDNS client, reconciliation, the ownership watcher,
the UI) takes a `NamespaceConfig` as a parameter rather than reading a single global `DNS_ZONE`.

Everything chain-specific — ownership lookups *and* signed-message verification — lives behind
one interface:

```ts
interface OwnershipAdapter {
  getNamesByOwner(address: string): Promise<string[]>;
  getOwnerAddress(name: string): Promise<string | null>;
  verifyOwner(name: string, address: string): Promise<boolean>;
  isNameActive(name: string): Promise<boolean>;
  buildLoginChallengeMessage(params: { address: string; nonce: string; issuedAt: Date; expiresAt: Date }): string;
  verifySignedMessage(address: string, message: string, signatureBase64: string): boolean;
}
```

Signing is part of the adapter (not split out separately) because different chains may use
different message-signing schemes, not just different ownership RPCs.

Routing is path-based and namespace-scoped throughout: pages live under `/[namespace]/...` and
APIs under `/api/[namespace]/...`. A namespace-segment layout
(`src/app/[namespace]/layout.tsx`) resolves the namespace, 404s on an unknown/disabled key, sets
`data-namespace="<key>"` on a wrapper div for CSS theming (see `globals.css`), and drives
per-namespace metadata (title/favicon/OG image). The root `/` is a neutral portal listing every
namespace, with disabled ones shown as "coming soon". Session JWTs carry `namespace` alongside
`address`, and `getSession(namespace)` rejects a session minted for a different namespace — an
Avian-authenticated cookie can't be replayed against Radiant; switching namespaces requires a
fresh sign-in.

One shared PowerDNS instance/credential set serves every namespace; each namespace just manages
its own zone on it (`ns.dnsZone`, passed as a parameter to every `PowerDnsClient` call).

### Adding a new namespace

1. Implement `OwnershipAdapter` for the chain (ownership lookups + signed-message verification),
   under `src/lib/ownership/<chain>/`. See `src/lib/ownership/radiant/` for a complete example:
   `adapter.ts` composes an ownership-lookup implementation (mock or real) with a signing scheme
   (`message.ts`) into a full `OwnershipAdapter`, picking a real backend
   (`electrum-provider.ts`/`wave.ts`, an RXinDexer ElectrumX client) over the mock
   (`mock-provider.ts`) based on env vars — the same pattern as Avian's RPC vs. mock provider.
2. Add a `NamespaceConfig` under `src/lib/namespaces/<chain>.ts` wiring up that adapter, and
   register it in `src/lib/namespaces/registry.ts`. Leave `enabled: false` until the adapter is
   real and branding assets are in place.
3. Add a `[data-namespace="<key>"]` (and `.dark [data-namespace="<key>"]`) override block in
   `src/app/globals.css` for its brand palette.
4. Flip `enabled: true` once the adapter is real and branding assets are in place. No other code
   needs to change — pages, API routes, DNS validation, PowerDNS integration, transfer handling,
   and rate limiting are all already namespace-generic.

## How ownership verification works

1. Client requests a login challenge for an address within a namespace
   (`POST /api/[namespace]/auth/challenge`). The server generates a nonce, stores it, and returns
   a message to sign, built by that namespace's `adapter.buildLoginChallengeMessage`.
2. The user signs that exact message with the wallet that controls the address (Avian uses a
   Bitcoin-derived signed-message scheme — `signmessage <address> <message>`).
3. The client submits the address, message, and base64 signature
   (`POST /api/[namespace]/auth/verify`). The server verifies the signature via
   `adapter.verifySignedMessage`, then issues an HttpOnly JWT session cookie scoped to that
   namespace.
4. Every subsequent DNS API call re-checks, server-side, that the authenticated address
   currently owns the name being managed (`adapter.verifyOwner`) before touching PowerDNS.

### Session hardening (shared computers & step-up)

Two opt-in protections guard against a session left open on a public/shared machine (where an
attacker has the cookie but not the wallet):

- **"This is a shared computer"** at sign-in issues a 30-minute session in a browser-session
  cookie (no `Max-Age`, so it also dies when the browser closes) instead of the usual 12-hour
  persistent session — see `SHORT_SESSION_DURATION_SECONDS` in `src/lib/auth/session.ts`.
- **"Require a fresh signature before changes"** (per-address setting on the Settings page,
  stored in `AddressSetting.requireSignedWrites`) makes every DNS write additionally require a
  short-lived *step-up* cookie, minted only after a fresh wallet signature via
  `POST /api/[namespace]/auth/step-up` (valid 10 minutes — `src/lib/auth/step-up.ts`). Write
  routes call `checkStepUpForWrite`, returning `403 STEP_UP_REQUIRED`; the client
  (`StepUpProvider`) opens a confirm-with-wallet dialog and transparently retries. **Turning the
  setting off** also requires a fresh signature, so a hijacked session can't simply disable it.
  The step-up proof is a separate JWT cookie (not a DB timestamp) so it's bound to the browser
  that actually signed and expires on its own.

There is no standardized browser wallet extension for either chain today, so both
`/avian/connect` and `/radiant/connect` offer a "Manual Verification" flow: sign the challenge
with any wallet's Sign Message tool and paste the resulting signature back.

`/radiant/connect` additionally offers an "Open in Photonic wallet" deep
link (`src/lib/ownership/radiant/connect-link.ts`), built as a base64url-encoded
`SignRequest` envelope (`protocol`, `v`, `t`, `challenge`, `origin`, `app`, `address`) passed to
`https://photonic-wallet.com/#/connect?req=...` — Photonic's own structured "connect" protocol,
not just a bare signable string. The challenge message itself
(`src/lib/ownership/radiant/message.ts`) is a single line with no control characters (Photonic's
signer rejects `\n`/other characters below `0x20`) and is prefixed
`radiant:wallet-connect:v1:<nonce>:...` to match Photonic's "recognized challenge" cosmetic
badge shape.

## Name → DNS zone mapping

```
bob.avn       -> bob.avn.zone
www.bob.avn   -> www.bob.avn.zone
test.bob.avn  -> test.bob.avn.zone
api.test.avn  -> api.test.avn.zone   (multi-level names use the same rule)
```

The owner of `bob.avn` may manage `bob.avn.zone` and any `*.bob.avn.zone` child, and may
**never** manage `avn.zone` itself, the reserved operator hostnames (`ns1`, `ns2`, `www` -
see `RESERVED_ROOT_HOSTS` in `src/lib/dns/constants.ts`), or any other owner's zone
(e.g. `alice.avn.zone`). Reserved labels are also blocked as source names outright: whoever
registers `www.avn` or `www.rxd` on-chain still can't manage `www.avn.zone`/`www.rxd.zone`
through the app. See `src/lib/dns/validation.ts` (`authorizeFqdnForName`) for the
enforcement and `src/lib/dns/validation.test.ts` for the test coverage of these rules. The same
rules apply verbatim to any other namespace (e.g. Radiant's `bob.rxd` → `bob.rxd.zone`) since
they're parameterized on `DnsNamespace { tld, dnsZone }`.

## Record types & policy

Supported record types, matching real-world hosting needs (GitHub Pages, Vercel, Netlify,
Cloudflare Pages, Firebase, etc. all expect a CNAME) while keeping the zone from becoming a
general-purpose DNS free-for-all:

| Type    | Allowed?                                   | Notes |
|---------|---------------------------------------------|-------|
| A       | Yes                                          | Strict IPv4 |
| AAAA    | Yes                                          | Strict IPv6 |
| CNAME   | Yes, with rules                              | See below |
| TXT     | Only under `_acme-challenge.*`               | ACME DNS-01 only, auto-expiring |
| Others  | No                                           | MX, NS, SRV, PTR, CAA, wildcards - never |

**CNAME rules** (`validateCnameTarget`, `wouldCreateCnameLoop` in `src/lib/dns/validation.ts`):
- A hostname has either up to one A **and** one AAAA record, or a single CNAME - never both
  kinds at once (`checkRecordLimits` in `src/lib/dns/limits.ts`).
- The target must be a syntactically valid hostname, not an IP address, and not `localhost`.
- If the target falls within the namespace's DNS zone, it must stay inside the *caller's own*
  name's namespace - it can never point at another owner's zone, the root zone apex, or a
  reserved hostname (`ns1`/`ns2`/`www`).
- Direct self-reference (`www.bob.avn.zone CNAME www.bob.avn.zone.`) is always rejected.
  Multi-hop loops within the zone are also detected by walking the existing CNAME chain (up to
  `MAX_CNAME_CHAIN_HOPS` hops) before allowing a new target.
- No wildcard CNAMEs.

**ACME TXT rules** (`src/app/api/[namespace]/dns/[name]/acme/route.ts`): only under
`_acme-challenge.<host>`, created through a dedicated "Add SSL Challenge" flow rather than the
general record editor. Multiple values may coexist at the same challenge name (ACME clients
sometimes need more than one during renewals). Every challenge value gets its own `expiresAt`
(default 24h, selectable up to 7 days) and is deleted automatically - both from PowerDNS and
locally - the next time anything reconciles that name's records (`src/lib/dns/reconcile.ts`).
General TXT records (anywhere other than `_acme-challenge.*`) are always rejected.

## Public DNS lookup

`/[namespace]/lookup` (e.g. `/avian/lookup`, `/radiant/lookup`) is a public, no-login page for
looking up the current active DNS records of any name in that namespace — a plain HTML `<form>`
submitting `?name=...` back to itself (no client JS required), rendering whatever `ACTIVE`,
non-ACME-challenge `DnsRecord` rows exist for that claimed name. Linked from the nav bar
regardless of session state.

## Custom-domain routing

Each namespace's own DNS zone apex (`avn.zone`, `rxd.zone` by default, or whatever
`AVIAN_DNS_ZONE`/`RADIANT_DNS_ZONE` are set to) can serve that namespace directly at `/` instead
of requiring the `/avian` or `/radiant` path segment — visiting `avn.zone/connect` transparently
serves what's at `/avian/connect`, with no visible redirect. This is handled by
`src/middleware.ts`, which reads the `Host` header and rewrites unprefixed paths to
`/<namespace>/<path>`. It deliberately maintains its own small host→namespace map rather than
importing `src/lib/namespaces` directly, since that module composes each namespace's full
`OwnershipAdapter` at import time — for Radiant that pulls in `RadiantElectrumClient`'s
`node:net` TCP socket, a Node built-in unsupported in the Edge Runtime middleware executes in.
Keep `NAMESPACE_BY_HOST` in `middleware.ts` in sync by hand if `AVIAN_DNS_ZONE`/`RADIANT_DNS_ZONE`
ever change.

## Security rules enforced

- Hostnames beginning with `_` are rejected, with one narrow exception: `_acme-challenge`
  (and `_acme-challenge.<host>`), and only paired with TXT - see above.
- A namespace's own DNS zone apex and its reserved hostnames (`ns1`/`ns2`/`www`) can never be
  modified, and the corresponding source names (`www.avn`, `www.rxd`, ...) can't be claimed or
  managed at all - even by their genuine on-chain owner (`RESERVED_ROOT_HOSTS` in
  `src/lib/dns/constants.ts`). Enforced twice, independently: at the API authorization layer
  (`authorizeFqdnForName`) and again inside the PowerDNS client itself, whose `patchZone` throws
  on any write targeting the apex, a reserved name (or child of one), or anything outside the
  zone being patched - so even a bug upstream can't produce such a write.
- One name owner can never touch another owner's namespace (including as a CNAME target), even
  across different namespaces.
- IPv4/IPv6 values are strictly validated; Unicode/punycode names are rejected for MVP.
- Empty labels, double dots, labels over 63 chars, and full names over 253 chars are rejected.
- A/AAAA/CNAME records use a fixed TTL of 300 seconds; ACME TXT records use a short 60s TTL and
  an expiry (default 24h, max 7 days).
- Per-name limits: max 10 hostnames, max 2 A/AAAA records per hostname (one A + one AAAA)
  or 1 CNAME (mutually exclusive with A/AAAA), max 10 active ACME TXT challenges.
- **On ownership transfer**, every DNS record for that name is disabled (removed from PowerDNS,
  kept locally only for audit history) before the new owner can manage anything - see
  "Ownership transfer handling" below.
- DNS writes are rate-limited per namespace + address (`RATE_LIMIT_DNS_WRITES_PER_MINUTE`,
  default 20/min). Auth challenge/verify requests are rate-limited both per address and per IP
  (the address alone is attacker-chosen and trivially rotated); expired login challenges and
  closed rate-limit windows are purged by the cron sweep so unauthenticated endpoints can't
  grow the database without bound.
- Login challenges are single-use (claimed with an atomic conditional write, so concurrent
  verifies of the same challenge can't both succeed), expire after 5 minutes, and must match a
  server-issued message exactly.
- All responses carry `frame-ancestors 'none'`/`X-Frame-Options: DENY` (anti-clickjacking),
  `X-Content-Type-Options: nosniff`, and a strict referrer policy (see `next.config.ts`).
- Every create/update/delete is written to an audit log (namespace, address, name, action,
  old/new value, IP, user agent, timestamp).
- The PowerDNS API key is only ever read server-side (`src/lib/powerdns/client.ts`); it is
  never sent to the browser.

## Ownership transfer handling

DNS records are tied to *current* on-chain ownership, not to whoever originally created them. If
`craigd.avn` transfers to someone else, every DNS record under `craigd.avn.zone` (A/AAAA/CNAME,
plus any live ACME TXT challenges) is **disabled** - removed from PowerDNS so it stops
resolving immediately - not silently handed to the new owner. This matters because the old
owner's records might point at their GitHub Pages/Vercel account, their own servers, or active
SSL challenges; auto-inheriting them would be a real security/trust problem for the new owner's
visitors. The new owner starts from a clean slate and must explicitly recreate whatever they
need.

**Disable, not delete:** disabled records are removed from PowerDNS (publicly indistinguishable
from deleted - no DNS response either way) but the local rows are kept with
`status: DISABLED` and `disabledReason: OWNERSHIP_CHANGED` for audit/history, rather than
hard-deleted. Every audit log entry for a disable event uses a dedicated `DISABLE` action,
distinct from a user-initiated `DELETE`. (Genuine user-initiated single-record deletes and
expired-ACME-challenge cleanup remain simple hard deletes - the audit log already captures
their history.)

**Three enforcement points**, matching how this is normally described for this kind of system:

1. **On every authenticated visit** - `requireClaimedNameOwnership`
   (`src/lib/ownership/sync.ts`) re-verifies the session address against the namespace's live
   `OwnershipAdapter` on every dashboard/API request, not just at login. If the cached owner
   differs from the verified current owner, `syncClaimedNameOwnership` disables the previous
   owner's records before anything else happens, then reactivates the name (status `ACTIVE`) for
   the verified new owner. Because reaching this code at all already required a valid signed
   session *and* a fresh on-chain ownership check, this reactivation doesn't need a separate
   "claim" step - logging in and visiting the page already proves it.
2. **Before every DNS write** - the same `requireClaimedNameOwnership` check runs at the top of
   every record-mutating API route, so a stale open browser session can't be used to edit DNS
   after the name has actually changed hands.
3. **A background watcher**, for the case nobody ever revisits the app after a transfer -
   `sweepAllClaimedNamesForOwnershipChanges` (`src/lib/dns/ownership-watcher.ts`) re-checks every
   tracked name's current on-chain owner across **all enabled namespaces** (via
   `adapter.getOwnerAddress`) and disables records proactively when it finds a mismatch. Rows
   belonging to an unknown or disabled namespace are skipped defensively rather than erroring.
   Since there's no signed session driving this path, the name is marked `TRANSFERRED` (not
   `ACTIVE`) - the new owner still has to log in normally to manage DNS, which is what flips it
   back to `ACTIVE` via the same `syncClaimedNameOwnership` used by the live path.

   This isn't a background process baked into the app - Next.js doesn't have a built-in
   long-running worker, and an in-process `setInterval` would misbehave across multiple
   instances/serverless. Instead, it's exposed as `POST /api/cron/verify-ownership` (one global
   endpoint sweeping every namespace, not one per namespace), protected by a shared secret
   (`CRON_SECRET`, compared with a timing-safe check), meant to be triggered every 5-10 minutes
   by whatever scheduler your deployment already has: system cron, a systemd timer, Vercel Cron,
   a GitHub Actions schedule, etc. Example crontab entry:

   ```
   */10 * * * * curl -fsS -X POST https://your-domain.example/api/cron/verify-ownership \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

   The route returns 503 if `CRON_SECRET` isn't configured, so it can't accidentally run
   unauthenticated.

   The same sweep also does database housekeeping: it purges expired unverified login
   challenges (and verified ones older than 30 days) plus closed rate-limit windows, both of
   which are minted by unauthenticated endpoints and would otherwise grow without bound. This
   is another reason to actually wire the cron up, even with only one namespace in use.

**Not implemented:** the on-chain block height/txid of the ownership-changing transaction isn't
recorded. Surfacing that would need additional Avian RPC calls this scaffold doesn't make yet
(e.g. resolving which transaction moved the `<NAME>.AVN!` owner token) - `transferredAt` /
`previousOwnerAddress` capture *when* and *from whom*, just not the on-chain proof, which would
be a reasonable follow-up for a real audit trail.

## Getting started

```bash
npm install
cp .env.example .env   # then fill in AUTH_SECRET, AVIAN_MOCK_OWNERS, etc.
npx prisma migrate dev
npm run dev
```

Open http://localhost:3000 for the namespace portal, or go straight to
http://localhost:3000/avian. With `POWERDNS_API_URL`/`POWERDNS_API_KEY` left unset, the
PowerDNS client runs in **dry-run mode**: it logs the PATCH payload it would have sent instead
of making a real HTTP call, so you can exercise the full app without a PowerDNS instance.

### Avian ownership: mock provider vs. real aviand RPC

`createDefaultAvianLookup()` (`src/lib/ownership/avian/adapter.ts`) picks the provider
automatically:

- If `AVIAN_RPC_URL`, `AVIAN_RPC_USER`, and `AVIAN_RPC_PASSWORD` are all set, it uses
  **`AviandRpcAnsOwnershipProvider`** (`src/lib/ownership/avian/rpc-provider.ts`) — real
  on-chain lookups against an `aviand` (Avian Core) node.
- Otherwise it falls back to **`MockAnsOwnershipProvider`**, resolved via `AVIAN_MOCK_OWNERS`, a
  JSON map of ANS name to owning Avian address:

  ```
  AVIAN_MOCK_OWNERS={"bob.avn":"RAddressOwningBobDotAvn","alice.avn":"RAddressOwningAliceDotAvn"}
  ```

  To sign in as `bob.avn`'s owner locally, you need a keypair whose address matches the value
  you configured, and the ability to produce a `signmessage`-style signature for it (e.g. via
  Avian Core's `signmessage` RPC, or `signBitcoinStyleMessage` in
  `src/lib/ownership/signmessage.ts` with prefix `Raven Signed Message:\n` — see "Known
  scaffolding limitations" below).

Both implement the same `AvianOwnershipLookup` interface
(`src/lib/ownership/avian/adapter.ts`), which `createAvianAdapter` wraps into a full
`OwnershipAdapter` (adding Avian's signing scheme) — swapping the underlying lookup requires no
changes anywhere else in the app.

#### How the real (aviand RPC) provider works

ANS names are Ravencoin-style assets. Registering `bob.avn` issues the on-chain asset
`BOB.AVN`, which — per standard Ravencoin/Avian asset semantics — automatically mints a paired,
always-quantity-1, non-divisible **owner token** asset `BOB.AVN!` to the issuer. Whoever holds
the `<NAME>.AVN!` owner token controls DNS for that name (confirmed convention — not the base
asset):

- `verifyOwner` / `isNameActive` call `listaddressesbyasset "<NAME>.AVN!"` and check the (single,
  protocol-guaranteed-unique) current holder.
- `getNamesByOwner` calls `listassetbalancesbyaddress <address>` and returns every
  `<name>.AVN!` owner token the address holds, filtered to only DNS-safe names.

The node **must** run with `-assetindex=1` (or `assetindex=1` in `avian.conf`) for these RPCs
to exist. Configure the connection via `AVIAN_RPC_URL` / `AVIAN_RPC_USER` /
`AVIAN_RPC_PASSWORD` (see `.env.example`).

### Radiant ownership: mock provider vs. real RXinDexer (ElectrumX)

`createDefaultRadiantLookup()` (`src/lib/ownership/radiant/adapter.ts`) picks the provider the
same way Avian does:

- If `RADIANT_ELECTRUMX_HOST` and `RADIANT_ELECTRUMX_PORT` are both set, it uses
  **`ElectrumRadiantOwnershipLookup`** (`src/lib/ownership/radiant/electrum-provider.ts`) — real
  lookups against an RXinDexer instance (an ElectrumX fork/extension understanding Radiant's
  Wave/Glyphs name protocol) over a plain TCP, newline-delimited JSON-RPC 2.0 socket (not HTTP) —
  see `electrum-client.ts`.
- Otherwise it falls back to **`MockRadiantOwnershipLookup`**, resolved via `RADIANT_MOCK_OWNERS`
  (same JSON-map shape as `AVIAN_MOCK_OWNERS`, but with Bitcoin-style addresses).

#### How the real (RXinDexer/Wave) provider works

Radiant addresses are standard Bitcoin-style base58check P2PKH (`src/lib/ownership/radiant/address.ts`).
RXinDexer identifies an address by its own `hashX` — the first 11 bytes of
`sha256(<P2PKH scriptPubKey>)`, hex-encoded, NOT the reversed 32-byte scripthash format used by
mainline Electrum wallets, and NOT invertible back to an address
(`hashXFromRadiantAddress` in `src/lib/ownership/radiant/wave.ts`).

- `getNamesByOwner` calls `wave.reverse_lookup(hashX, limit)` and extracts each hit's name,
  falling back to a `glyph.get_token` call per-hit when a hit's name isn't present directly
  (some hits only carry a glyph `ref`, not a resolved name).
- `getOwnerAddress` / `verifyOwner` / `isNameActive` call `wave.resolve(name)` — note this raw
  JSON-RPC method wants the **bare label without the `.rxd` suffix** (`wave.resolve("craigd")`,
  not `"craigd.rxd"` — the suffixed form errors with `Invalid character: .`), unlike RXinDexer's
  REST API mirror of the same method, which silently strips the suffix itself. The resolved
  owner's address comes back as `target`, not `zone.address` (a separate, arbitrary
  user-settable DNS-style field on the name, not guaranteed to match the current owner).

Mirroring `AviandRpcAnsOwnershipProvider`'s conventions: `getOwnerAddress` never catches errors
(a thrown error must not be conflated with a confirmed "no owner" — see "Ownership transfer
handling" for why that distinction matters to the background watcher), while `verifyOwner` /
`isNameActive` fail closed (return `false`) on any error, since denying access under uncertainty
is the safe default.

### Switching to Postgres

Edit `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Set `DATABASE_URL` to a Postgres connection string and run `npx prisma migrate dev`.

## Testing

```bash
npm run test    # vitest: DNS validation, hostname rules, record limits, authorization, namespace registry
npm run build   # production build + typecheck
```

Unit tests live in `src/lib/**/*.test.ts` and cover: the source-name-to-FQDN mapping, hostname
label rules (underscore/wildcard/length/double-dot rejection, plus the narrow `_acme-challenge`
exception), strict IPv4/IPv6 validation, CNAME target validation and loop detection, namespace
authorization (an owner's own zone and children vs. root zone / ns1 / ns2 / other owners), the
per-name record/hostname/ACME limits, the namespace registry (resolving both namespaces, 404-ing
on unknown/disabled ones), Avian signature verification against a real captured signature, and
Radiant's address validation, message-challenge shape, and Wave name lookups (including
regression fixtures captured from a real RXinDexer instance — see
`src/lib/ownership/radiant/wave.test.ts`).

## Project structure

```
src/
  middleware.ts                       Custom-domain routing (avn.zone/rxd.zone -> /avian, /radiant)
  app/
    page.tsx                          Neutral portal listing all namespaces
    [namespace]/
      layout.tsx                      Resolves namespace, sets data-namespace, per-namespace metadata
      page.tsx                        Namespace landing page
      connect/                        Wallet connect / manual signature verification
      lookup/                         Public, no-login DNS record lookup
      dashboard/                      List of owned names in this namespace
      dashboard/[name]/               DNS record management for one name
      settings/                       Session info + recent audit log
    api/
      [namespace]/
        auth/challenge, verify, session, logout
        names
        dns/[name]                    GET records (A/AAAA/CNAME/ACME TXT, reconciled with PowerDNS)
        dns/[name]/records            POST (create/replace A/AAAA/CNAME), DELETE
        dns/[name]/acme               POST (add ACME TXT challenge), DELETE (remove one value)
        audit
      cron/verify-ownership           POST - background ownership watcher, all namespaces (CRON_SECRET-protected)
  lib/
    namespaces/                       NamespaceConfig/OwnershipAdapter types, registry, avian.ts, radiant.ts
    dns/                              validation.ts, limits.ts, constants.ts (the security core),
                                       reconcile.ts (PowerDNS sync, ACME expiry, transfer disable),
                                       ownership-watcher.ts (periodic transfer sweep, all namespaces)
    ownership/
      avian/                          Avian OwnershipAdapter: RPC provider, mock provider, message signing
      radiant/                        Radiant OwnershipAdapter: RXinDexer/ElectrumX (wave.ts,
                                       electrum-client.ts, electrum-provider.ts), mock provider,
                                       address validation, message signing, Photonic connect link
      sync.ts, names-for-owner.ts     Namespace-generic ownership sync / dashboard listing
    auth/                             challenge/session (JWT, namespace-scoped) helpers
    powerdns/                         PowerDNS Authoritative API client (zone passed per call)
    rate-limit.ts, audit.ts, api-schemas.ts, api-error.ts
prisma/
  schema.prisma                       UserSession, ClaimedName (namespace + status/transfer tracking),
                                       DnsRecord (namespace + status/disabledReason), AuditLog, RateLimitBucket
```

## Known scaffolding limitations

- **Avian signature verification** uses a Bitcoin-derived `signmessage` scheme with prefix
  `Raven Signed Message:\n` (`src/lib/ownership/avian/message.ts`) — Avian is a Ravencoin fork
  that kept the original message magic string rather than rebranding it (confirmed against Avian
  Core's `src/common/signmessage.cpp`). Override via `AVIAN_MESSAGE_PREFIX` if a future Avian
  Core release changes this. Signing/verification is implemented in-house on `@noble/curves`
  (`src/lib/ownership/signmessage.ts`, shared with Radiant) rather than the unmaintained
  `bitcoinjs-message` → `elliptic` chain; compatibility is regression-pinned against a real
  signature captured from an Avian Core node (`src/lib/ownership/avian/message.test.ts`) plus
  magic-hash vectors captured from `bitcoinjs-message` before its removal.
- **No browser wallet extension integration** — neither Avian nor Radiant has a standardized
  browser wallet extension today, so manual verification (paste a signed message) is the only
  supported sign-in path for both, plus Radiant's Photonic deep link.
- **The aviand-RPC ownership provider makes two RPC round trips per DNS API request**
  (`isNameActive` + `verifyOwner`, each calling `listaddressesbyasset`); fine for a local node,
  but worth caching if the node is remote or under load.
- **Rate limiting** uses a simple database-backed fixed window, sufficient for a single
  instance; swap for a Redis-backed limiter if scaling out.
- **PowerDNS reads** are served from the local Prisma-mirrored `DnsRecord` table (kept in sync
  on every write) rather than querying PowerDNS live, to avoid a round trip on every dashboard
  load.
- **`NEXT_PUBLIC_APP_URL` is a single fixed value** (used only for `metadataBase` in
  `src/app/layout.tsx`, to resolve relative OG image/icon paths into absolute URLs) — it isn't
  derived per-request from the custom domain that served the page, so both `avn.zone` and
  `rxd.zone` resolve their OG images against whichever one URL is configured here. Harmless today
  since the underlying static assets are identical either way, but worth knowing if that ever
  needs to vary by domain.
