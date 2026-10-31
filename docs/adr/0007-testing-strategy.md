# 0007. Testing strategy

Status: Accepted (2026-10-16). Changed in October 2026 (audit findings J-4
and Z-6): the JS budget counts every file a page's scripts import, and is
35 KB (see `pnpm check:dist` below). Changed by audit 4 (J-6): parts a page
loads later with `import()` aren't counted, and that's how to cut weight
before raising a budget (below). Changed by audit 4 (J-3): `pnpm check:dist`
also refuses a built script whose syntax is newer than ES2022, what Safari
16.4 reads, packages' code included (only the syntax: a newer function it
calls isn't seen; [quality.md](../quality.md)).

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
  budgets per page (HTML 20 KB, CSS 15 KB, JS 35 KB). The JS counts every
  file a page's scripts import before they run.

  _Changed in October 2026 (audit findings J-4 and Z-6):_ the JS budget was
  25 KB, but it counted only the files named in the HTML, not the shared
  files they import, like the sync client (about 10 KB) that every app with
  sync loads. So Calendar really loaded 32 KB while the check said 21 KB.
  The check now counts what really loads, and the budget is 35 KB, which
  every page met then (Calendar was the biggest). Scripts started later,
  like workers and Grammar's checker, aren't counted: they're not part of
  opening the page.

  _Changed in October 2026 (audit 4 J-6):_ Repairs had become the biggest
  page, less than 1 KB under the budget. Its forms, "Delete a year…" and
  its photo viewer now load with `import()` once the page has opened
  (Calendar's event editor uses `import()` too, when first opened). Code
  loaded that way isn't counted either, so it's how to cut weight before
  raising a budget ([quality.md](../quality.md)). Tasks, the biggest page by
  the fifth audit and almost at the budget, loads its form and list editor
  that way too (audit 5 J-2).

## Consequences

- A new app is covered by about 20 checks the moment it exists.
- Automated accessibility testing finds only part of the problems; manual
  checks are listed in `docs/quality.md`.

## Alternatives

- **Lighthouse CI:** noisy scores on shared runners and a heavy dependency;
  byte budgets are exact and stable.
- **Cypress:** heavier, with a weaker accessibility integration.
