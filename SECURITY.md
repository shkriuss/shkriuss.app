# Security

## Reporting a problem

If you find a security or privacy problem in shkriuss.app or any of its apps,
please report it privately to the owner and don't share it publicly first.

This repository is private, so there's no public reporting channel yet. A
public contact address (and a `/.well-known/security.txt` file) is planned once
the owner chooses one (see [docs/PLAN.md](docs/PLAN.md#8-roadmap)).

## Security model (summary)

The full reasoning is in [docs/PLAN.md](docs/PLAN.md#4-security-and-privacy-model)
and [ADR 0004](docs/adr/0004-security-headers.md).

**What runs where**

- Every site is static files on Cloudflare Workers static assets. No server
  code runs, so there's no server to break into and no database to leak.
- Each app is its own origin (`<app>.shkriuss.app`), so browsers keep each
  app's saved data separate.
- User data stays in the browser (`localStorage`). Nothing is sent anywhere.

**Browser protections (same headers on every site)**

- A strict Content Security Policy: only our own scripts, styles, images and
  connections; no inline code; no framing; Trusted Types required.
- HSTS (HTTPS only, with preload), `nosniff`, `Referrer-Policy: no-referrer`,
  a Permissions-Policy that turns off camera, microphone, location and more,
  and cross-origin isolation (COOP, CORP, COEP).
- No cookies, analytics, trackers, third-party scripts, fonts or CDNs. Browser
  tests fail if a page requests anything from another origin.

**Supply chain and repository**

- No secrets in the repository. The Cloudflare API token is stored only as a
  GitHub Actions secret, with just two permissions: _Workers Scripts: Edit_
  (account) and _Workers Routes: Edit_ (the `shkriuss.app` zone only).
- gitleaks scans every commit for secrets; zizmor checks the workflows;
  `pnpm audit` checks for known vulnerabilities; Dependabot proposes updates
  (after a 7-day cooldown).
- GitHub Actions are pinned to exact commit SHAs, workflows start with no
  permissions, and code checkout doesn't keep credentials.
- pnpm only lets allow-listed packages run install scripts and won't install
  versions published less than 7 days ago.
- Production deploys only happen from `main`, after every check passes.

## Known limits

- The repository is private on GitHub Free, so GitHub's own secret scanning,
  push protection and branch protection aren't available. The checks above
  are free replacements. See [docs/PLAN.md](docs/PLAN.md#10-where-your-request-conflicts-with-best-practice).
- Cloudflare, as the host, sees visitors' IP addresses to deliver pages. No
  Cloudflare analytics or logging is turned on for these sites.
- Preview links (`*.workers.dev`) are public, but not listed anywhere and not
  indexed by search engines. They contain the same code as production.
