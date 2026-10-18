# CLAUDE.md

Guide for AI assistants (and humans) working in this repo. Details live in
[`docs/`](docs/); start with [`docs/PLAN.md`](docs/PLAN.md).

## What this is

A pnpm monorepo for **shkriuss.app**: a hub that lists small, private web apps,
each on its own subdomain (`<slug>.shkriuss.app`). Everything is static
(Astro → HTML/CSS/JS) and hosted on Cloudflare Workers static assets. User data
stays on the device (`localStorage`). The owner works only from a phone or
tablet: they can't run commands, so CI does all building, testing and deploying.

## Layout

```
apps/hub/            shkriuss.app (app list, privacy page)
apps/<slug>/         one folder per app → <slug>.shkriuss.app
packages/ui/         design system: tokens, CSS, Astro components, icons, AppShell
packages/registry/   apps.json = the single list of apps (+ validation)
packages/astro-config/ defineAppConfig(): headers, manifest, icons, service worker
packages/storage/    on-device storage helpers (createStore, export, backup, restore, delete)
packages/push/       optional notifications while an app is closed (client + per-app Worker)
packages/account/    optional shkriuss account: recovery key, passkeys, device links (+ hub Worker)
packages/sync/       optional sync between devices through the account (client + per-app Worker)
packages/crypto/     Web Crypto helpers (base64url, HKDF, AES-GCM seal/open), browser + Workers
packages/dates/      calendar dates as plain "YYYY-MM-DD" strings (add days, weekdays, month grid)
packages/server/     shared Worker helpers: createWorker() for /api/*, JSON, limits
templates/app/       copied by `pnpm new-app` (placeholder slug: template-app)
tests/e2e/           shared Playwright tests that run against EVERY site
tests/unit/          cross-cutting unit tests (contrast, registry consistency, workflows)
scripts/             new-app, check-dist, previews, smoke-test
```

## Commands (Node 24, pnpm 10)

```sh
pnpm install
pnpm --filter tally dev          # dev server for one site
pnpm verify                      # everything CI runs, in order:
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm build && pnpm check:dist && pnpm test:e2e
pnpm new-app <slug> --name "Name" --description "One sentence." --icon note --color blue --stores "Your notes"
```

`pnpm test:e2e` needs `pnpm build` first (it serves `apps/*/dist` with
`wrangler dev`). In a sandbox without Playwright's own browser, set
`PW_CHROMIUM_PATH` to an installed Chromium.

## Rules

- **One design system.** Use `@shkriuss/ui` components and CSS classes. Add
  new shared UI there, not in an app. Colours, spacing and type come only from
  tokens in `packages/ui/src/styles/tokens.css`; contrast is unit-tested.
- **Strict CSP.** No inline `<script>`, `<style>`, `style=""`, `on*=`
  handlers, `innerHTML`/`outerHTML`/`insertAdjacentHTML`, `eval`, or
  third-party URLs. Build DOM with `<template>` + `textContent`.
  `pnpm check:dist` and the e2e guard enforce this. Trusted Types are on.
  Heavy work goes in a worker started with `startWorker()` from
  `@shkriuss/ui/worker`; only apps with `"webAssembly": true` in `apps.json`
  may compile WebAssembly ([ADR 0011](docs/adr/0011-on-device-grammar-checking.md)).
- **No third parties.** No analytics, trackers, CDNs, web fonts or embeds.
  Every request must go to the site's own origin (e2e enforced).
- **Data stays on the device.** Use `createStore` from `@shkriuss/storage`
  (keys are prefixed `shkriuss:`). Apps that store data show `<DataControls />`
  and list what they store in `apps.json` (`dataStored`), which feeds the
  privacy page. Anything server-side needs an ADR first.
- **Accessibility is WCAG 2.2 AA.** Semantic HTML, labels on every control,
  visible focus, 44px tap targets, works at 320px wide and in both themes.
  Shared e2e tests run axe on every page in light and dark mode.
- **Registry is the source of truth.** Never hard-code app names, domains or
  lists; read `@shkriuss/registry`.
- **Security headers live in one place:** `packages/astro-config/src/headers.ts`.
  An app that needs a browser feature passes `allowFeatures` to
  `defineAppConfig`, never edits headers by hand.
- **Small, tested changes.** Pure logic goes in `src/lib/*.ts` with a Vitest
  test next to it; user flows get Playwright tests in `apps/<slug>/e2e/`.
  Import `test`/`expect` from `tests/e2e/fixtures.ts`.
- **Explain in plain language.** The owner is a beginner: PR descriptions and
  docs should say what changed and why, without jargon.

## Adding an app

`pnpm new-app …` (or the **New app** workflow in GitHub Actions), then build
the page in `apps/<slug>/src/pages/index.astro`. Full guide:
[`docs/adding-an-app.md`](docs/adding-an-app.md).

## Never

- Commit secrets, tokens, `.env` or `.dev.vars` files (gitleaks runs in CI).
- Add a dependency without a clear need; prefer the platform. Pin new
  versions in the `catalog` in `pnpm-workspace.yaml`.
- Skip, disable or weaken tests, lint rules, the CSP or size budgets to make
  CI pass.
- Use unpinned GitHub Actions (`uses:` must be a full commit SHA).
- Upgrade TypeScript to 7 or pnpm past 10 before the notes in
  [ADR 0005](docs/adr/0005-pnpm-typescript-versions.md) say it's safe.
- Deploy by hand. Merging to `main` deploys; PRs get preview links.
