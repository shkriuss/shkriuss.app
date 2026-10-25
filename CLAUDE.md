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
apps/hub/            shkriuss.app (app list, privacy page, account page + its Worker)
apps/<slug>/         one folder per app → <slug>.shkriuss.app
packages/ui/         design system: tokens, CSS, Astro components, icons, AppShell,
                     and page helpers every app uses (@shkriuss/ui/dom, /problem, …)
packages/registry/   apps.json = the single list of apps (+ validation)
packages/astro-config/ defineAppConfig(): headers, manifest, icons, service worker
packages/storage/    on-device storage helpers (createStore, export, backup, restore, delete; files/photos)
packages/push/       optional notifications while an app is closed (client + per-app Worker)
packages/account/    optional shkriuss account: recovery key, passkeys, device links (+ hub Worker)
packages/sync/       optional sync between devices through the account (client + per-app Worker; photos too)
packages/library/    an app's online library in R2 through the account, like Photos' (client + per-app Worker)
packages/crypto/     Web Crypto helpers (base64url, HKDF, AES-GCM seal/open), browser + Workers
packages/dates/      calendar dates as plain "YYYY-MM-DD" strings (add days, weekdays, month grid)
packages/server/     shared Worker helpers: createWorker() for /api/*, JSON, limits
templates/app/       copied by `pnpm new-app` (placeholder slug: template-app)
tests/e2e/           shared Playwright tests that run against EVERY site
tests/unit/          cross-cutting unit tests (contrast, registry consistency, workflows)
scripts/             new-app, check-dist, deploy, buckets, previews, smoke-test, lockfile-age
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
`PW_CHROMIUM_PATH` to an installed Chromium. Beside another checkout's
browser tests (another session), set `E2E_PORT_BASE` (say `9300`) so the
servers don't clash; `E2E_REUSE=1` reuses servers already running.
`E2E_SITES=tally,notes` starts only those sites' servers (and the hub's), for
a quicker run while working on a few apps; CI always tests every site.

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
  may compile WebAssembly ([ADR 0011](docs/adr/0011-on-device-grammar-checking.md))
  or start WebAssembly threads with `allowThreadScripts()`.
- **Big optional downloads** (like Grammar's Deep check model) go in an
  app's `public/on-demand/`: never precached, downloaded only when the person
  asks, checked by SHA-256, at most 25 MiB per file
  ([ADR 0012](docs/adr/0012-deep-check-ai-model.md)).
- **No third parties.** No analytics, trackers, CDNs, web fonts or embeds.
  Every request must go to the site's own origin (e2e enforced).
- **Data stays on the device.** Use `createStore` from `@shkriuss/storage`
  (keys are prefixed `shkriuss:`); photos and other big files go in
  `@shkriuss/storage/files` ([ADR 0013](docs/adr/0013-photos-on-the-device.md)). Apps that store data show `<DataControls />`
  and list what they store in `apps.json` (`dataStored`), which feeds the
  privacy page. Anything server-side needs an ADR first, and anything a
  stranger can make a server keep counts against a storage meter
  (`@shkriuss/server/meter`, [ADR 0017](docs/adr/0017-storage-limits.md)).
- **Accessibility is WCAG 2.2 AA.** Semantic HTML, labels on every control,
  visible focus, 44px tap targets, works at 320px wide and in both themes.
  Shared e2e tests run axe on every page in light and dark mode.
- **Browsers:** Safari and iOS 16.4 and later (push and sync need it), and
  current Chrome, Edge and Firefox. Use anything newer only with a fallback
  or a feature check, like the colours for browsers without `light-dark()`
  in `tokens.css`. Tests run in Chromium only, so check the support tables.
- **Registry is the source of truth.** Never hard-code app names, domains or
  lists; read `@shkriuss/registry`.
- **Security headers live in one place:** `packages/astro-config/src/headers.ts`.
  An app that needs a browser feature passes `allowFeatures` to
  `defineAppConfig`, never edits headers by hand.
- **Small, tested changes.** Pure logic goes in `src/lib/*.ts` with a Vitest
  test next to it; user flows get Playwright tests in `apps/<slug>/e2e/`.
  Import `test`/`expect` from `tests/e2e/fixtures.ts`.
- **Ask "how could it break?" before building**, and test the answers, not
  only what the change should do. The audit's serious findings came from
  questions like these:
  - two devices or tabs changing the same thing at once, or a device that
    was offline for weeks;
  - a server that's slow, unreachable, refuses, or answers with something
    old or made up: data on the device must survive it;
  - full or blocked storage, and iPhone limits (5 MB per site, where some
    characters count twice);
  - data saved by an older version, or a newer version on another device;
  - a stranger calling the Worker: what can they make it store, or cost?
  - time zones and clock changes; 320px wide with a screen reader.

  The audit brief ([docs/audit/README.md](docs/audit/README.md)) has more,
  area by area.

- **Keep the docs true.** Every AI session reads them before working, so a
  wrong step becomes a wrong change. When a change alters something a doc
  says (how it works, a limit or number, a file or its name, a command, a
  step), update that doc in the same PR: this file, the guides in `docs/`,
  `README.md`, `SECURITY.md`, each app's own `README.md`, `apps.json`
  (`dataStored`, for the privacy page), the privacy page's own text
  (`apps/hub/src/pages/privacy.astro`: its "two days", "13 months" and so
  on) and the audit brief. A decision record (ADR) keeps what was decided
  and why: add a "Changed by" note to its status, or write a new ADR for a
  new decision. Search for the old name or number before pushing. A unit
  test checks that every doc link and file path still exists.

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
- Deploy by hand. Merging to `main` deploys; PRs get preview links once the
  owner approves them.
