# 0002. One Cloudflare Worker per site, with static assets

Status: Accepted (2026-10-16). Extended by [ADR 0009](0009-push-notifications.md),
[ADR 0010](0010-account-and-sync.md), [ADR 0014](0014-syncing-photos.md) and
[ADR 0016](0016-online-photo-library.md): a site with an optional feature
(notifications, sync, the account, Photos' online library) also has a Worker
script, which runs only for `/api/*`; the token also needs Workers R2 Storage
(see `docs/deployment.md`).

## Context

The domain is on Cloudflare. Every app needs its own subdomain, previews for
pull requests, and zero or near-zero cost. Cloudflare now recommends Workers
(not Pages) for new projects.

## Decision

- Each site (hub and each app) is a separate Worker with **only static
  assets** (no `main` script). Its `wrangler.jsonc` sets a **custom domain**
  (`<slug>.shkriuss.app`; the hub uses the apex `shkriuss.app`), turns
  `workers_dev` off for production, and keeps preview URLs on.
- Security headers come from a generated `_headers` file, which Cloudflare
  applies to static assets (no Worker code needed).
- **Production deploys** run `wrangler deploy` from GitHub Actions after all
  checks pass on `main`.
- **Pull request previews** use Cloudflare **Worker Previews**
  (`wrangler preview --name pr-<n>`) on `*.workers.dev`, deleted on close.
- The API token is limited to _Workers Scripts: Edit_ and _Workers Routes:
  Edit_ on the `shkriuss.app` zone.

## Consequences

- Static asset requests are free and unlimited. The Free plan allows 100
  Workers and 100 custom domains per zone, so about 99 apps.
- Apps are isolated: a broken deploy of one app doesn't affect the others, and
  each subdomain is a separate browser origin.
- No dashboard work per app: the first deploy creates the Worker, DNS record
  and certificate.
- Worker Previews is an "open beta" feature. If it changes, previews may need
  adjusting; production deploys don't depend on it.
- Every deploy currently uploads every site. Wrangler only uploads changed
  files, so this is cheap, but with many apps the workflow could be limited
  to changed apps.

## Alternatives

- **Cloudflare Pages:** no longer recommended for new projects.
- **One Worker serving every subdomain:** fewer Workers, but every app would
  share one deploy and one failure domain, and routing code would be needed.
- **Workers Builds (Cloudflare's Git integration):** needs dashboard setup for
  each app, which breaks the "adding an app is one step" goal.
