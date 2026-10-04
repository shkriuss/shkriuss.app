# ADR 0006: Hosting and deployment on Cloudflare

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

The apps are static and offline-first, each on its own origin, and they need custom security headers. Hosting should cost nothing at launch and need almost no operations work. Both domains already live in one Cloudflare account.

## Decision

- **Cloudflare Workers with static assets.**
  - One Worker per app, plus one for the hub, each with a custom domain per environment.
  - No Worker script: files are served straight from the asset store.
  - Unknown paths fall back to `index.html` (single-page app).
  - Headers come from a generated `_headers` file.
- **Not Cloudflare Pages.** It is in maintenance mode, and Cloudflare directs new projects to Workers.
- **The Cloudflare Free plan.** Static asset requests are free and unlimited.
- **Deploy with GitHub Actions and Wrangler**, not Workers Builds, so every deploy waits for the CI gates:
  - each merge to `main` deploys the changed apps to staging automatically;
  - production receives the same commit after manual approval;
  - rolling back means redeploying the previous version.
- **Staging** is private behind Cloudflare Access (free tier) and sends `X-Robots-Tag: noindex`.
- **Cloudflare features that rewrite pages or inject scripts stay off:** Rocket Loader, Email Address Obfuscation, Zaraz, Web Analytics auto-injection, and Bot Fight Mode's JavaScript detections.
- **Re-evaluate the `cf` CLI,** Wrangler's successor (in beta since September 2026), once it is stable.

## Consequences

- There is no server code to secure or operate. Each app deploys and rolls back independently.
- The Cloudflare account becomes critical infrastructure and needs strong account security ([setup checklist](../setup-checklist.md)).
- If an app ever needs server code, it can be added behind that app's own origin (Workers `run_worker_first` routes), with no new subdomains and no CORS.

## Alternatives considered

- **One Worker serving every subdomain:** a single point of failure, with every app forced to share one header set.
- **GitHub Pages:** no custom response headers, so the security policy could not be enforced. Rejected.
- **Workers Builds:** deploys on push without waiting for the GitHub checks.
