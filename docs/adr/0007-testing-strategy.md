# 0007. Testing strategy

Status: Accepted (2026-10-16)

## Context

The owner can't run anything locally, so CI must catch problems before they
reach production, and new apps should get strong checks without extra work.

## Decision

- **Vitest** for logic: storage, registry, generator, app logic
  (`src/lib/*.test.ts`), plus repo-wide guards (token contrast in both
  themes, registry ↔ folders ↔ `wrangler.jsonc`, pinned GitHub Actions).
- **Playwright** for browser tests, against each site's real build served by
  Cloudflare's local runtime (`wrangler dev`), so headers and 404 handling
  are exactly what production serves. Tests use a phone-sized viewport.
- **Shared tests** in `tests/e2e/` run against every site automatically:
  axe (WCAG 2.2 A/AA + best practices) in light and dark mode, security
  headers, no console errors (catches CSP/Trusted Types violations), no
  cross-origin requests, no cookies, 320px reflow, skip link, manifest,
  icons and offline support.
- **`pnpm check:dist`**: no inline code in built HTML, plus gzipped byte
  budgets per page (HTML 20 KB, CSS 15 KB, JS 25 KB).

## Consequences

- A new app is covered by about 20 checks the moment it exists.
- Automated accessibility testing finds only part of the problems; manual
  checks are listed in `docs/quality.md`.

## Alternatives

- **Lighthouse CI:** noisy scores on shared runners and a heavy dependency;
  byte budgets are exact and stable.
- **Cypress:** heavier, with a weaker accessibility integration.
