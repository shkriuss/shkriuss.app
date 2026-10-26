# shkriuss.app: project plan

_Last updated: 2026-10-26. Versions were checked against the npm registry and
official docs on 2026-10-16._

This is the plan for a hub at **shkriuss.app** that lists small personal web
apps. Each app lives on its own subdomain, for example `tally.shkriuss.app`.
All code is in one GitHub repository (a "monorepo"). GitHub Actions and
Cloudflare build, test and deploy everything, so you never need a computer or
a terminal.

Decision records with more detail are in [`docs/adr/`](adr/).

---

## 1. Technology choices

| Area                            | Choice                                                            | Why (one line)                                                                                                                                                            | Main alternative rejected                                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language                        | **TypeScript 6.0**                                                | JavaScript with type checking, which catches mistakes before they ship.                                                                                                   | TypeScript 7 (the new native compiler). It's faster, but ESLint's TypeScript support and Astro's checker don't accept it yet.                                               |
| Framework                       | **Astro 7** (static output)                                       | Builds plain HTML and CSS and ships JavaScript only where a page needs it, so pages are fast and private by default.                                                      | SvelteKit or Next.js: more powerful, but heavier and more complex than these apps need.                                                                                     |
| Interactivity                   | **Plain TypeScript in Astro `<script>` tags**                     | No UI library to learn or keep updated.                                                                                                                                   | Svelte or Preact "islands". These stay an option for a future app with complex UI ([ADR 0001](adr/0001-static-astro-sites.md)).                                             |
| Package manager                 | **pnpm 10**                                                       | Fast, strict, built for monorepos, and Dependabot can update it. It blocks package install scripts by default, and I configured it to skip packages less than 7 days old. | pnpm 12: newer, but Dependabot only supports pnpm up to 10 ([ADR 0005](adr/0005-pnpm-typescript-versions.md)). npm workspaces: slower, with weaker supply-chain protection. |
| Runtime for tools               | **Node.js 24 LTS**                                                | The current long-term-support version, required by Astro 7.                                                                                                               | Node 26: not LTS yet.                                                                                                                                                       |
| Hosting                         | **Cloudflare Workers with static assets**                         | Cloudflare now recommends Workers for new projects, and static files are served free with no limit.                                                                       | Cloudflare Pages, which Cloudflare no longer recommends for new projects.                                                                                                   |
| Deploy tool                     | **Wrangler 4**, run from GitHub Actions                           | The official Cloudflare tool. One workflow deploys any number of apps.                                                                                                    | Workers Builds (Cloudflare's Git integration), which needs dashboard setup for every new app.                                                                               |
| Lint and format                 | **ESLint 10 + Prettier 3**, with Astro and accessibility plugins  | The most popular and best-documented pair, with official Astro support.                                                                                                   | Biome: one tool with fewer dependencies, but its Astro support is still partial.                                                                                            |
| Unit tests                      | **Vitest 5**                                                      | Fast, and uses the same Vite tooling as Astro.                                                                                                                            | Jest: slower, and needs extra setup for TypeScript.                                                                                                                         |
| Browser and accessibility tests | **Playwright + axe-core**                                         | Drives a real browser against Cloudflare's local runtime (`wrangler dev`), with WCAG 2.2 AA rules.                                                                        | Cypress: heavier, with a weaker accessibility integration.                                                                                                                  |
| Performance budgets             | **A small byte-budget script** (`pnpm check:dist`, no dependency) | Exact, repeatable sizes for HTML, CSS and JS on every pull request.                                                                                                       | Lighthouse CI: its scores are flaky on shared CI machines, and it adds a large dependency.                                                                                  |
| Secret scanning                 | **gitleaks** (pinned, checksum-verified binary in CI)             | Free, and works on private repos too.                                                                                                                                     | GitHub secret scanning alone: it wasn't available while the repo was private, and runs as well now that it's public.                                                        |
| Dependency scanning             | **Dependabot** + **`pnpm audit`**                                 | Both are free on private repos.                                                                                                                                           | Snyk (a third-party account).                                                                                                                                               |
| Workflow security               | **zizmor** (in CI)                                                | Catches risky patterns in GitHub Actions workflows.                                                                                                                       | Nothing (most projects skip this).                                                                                                                                          |

Privacy extras: Astro's and Wrangler's anonymous usage telemetry are turned off
in CI (`ASTRO_TELEMETRY_DISABLED=1`, `WRANGLER_SEND_METRICS=false`).

---

## 2. Monorepo structure

The full, current layout is in [`CLAUDE.md`](../CLAUDE.md#layout); the list
of apps is `packages/registry/apps.json`. In short:

```
shkriuss.app/
├── apps/
│   ├── hub/                 → shkriuss.app (lists every app, privacy page, account)
│   └── <slug>/              → <slug>.shkriuss.app, one folder per app (Tally is the example)
├── packages/
│   ├── ui/                  @shkriuss/ui: design system (tokens, CSS, components, layouts, icons)
│   ├── registry/            @shkriuss/registry: THE list of apps (apps.json) + validation
│   ├── astro-config/        @shkriuss/astro-config: shared Astro config + build step
│   │                        (security headers, web manifest, icons, service worker)
│   ├── storage/             @shkriuss/storage: on-device data (save, back up, restore, delete; photos)
│   ├── server/              shared Worker helpers for /api/*
│   ├── account/, sync/      the optional account, and sync between devices (ADR 0010)
│   ├── push/                notifications while an app is closed (ADR 0009)
│   ├── library/             Photos' online library in R2 (ADR 0016)
│   └── crypto/, dates/      Web Crypto helpers; calendar dates as "YYYY-MM-DD"
├── templates/app/           starting files for a new app (copied by the generator)
├── scripts/                 new-app, dist checks, deploys, buckets, smoke test, package age
├── tests/e2e/               browser tests that run against EVERY site automatically
├── tests/unit/              repo-wide checks (colour contrast, registry, workflows)
├── docs/                    plan, guides, decision records (adr/)
└── .github/                 workflows, shared setup actions, Dependabot config
```

How the shared packages work:

- **`@shkriuss/ui`**: one CSS file of design tokens (colours, spacing, type
  sizes, radii) with automatic dark and light modes, plus base styles, CSS
  component classes (`.btn`, `.card`, …), Astro components (`<AppShell>`,
  `<Button>`, `<Card>`, `<Icon>`, `<AppIcon>`, `<DataControls>`,
  `<SyncControls>`, `<PushControls>`, `<ThemeSwitch>`, `<NotFound>`), page
  helpers every app uses (like `@shkriuss/ui/dom` and `/problem`), and an SVG
  icon set. Change a token once and every site changes on its next deploy
  ([design system guide](design-system.md)).
- **`@shkriuss/registry`**: `apps.json` is the single list of apps. The hub
  draws its app cards from it. Each app reads its own name, description, icon
  and colour from it. The privacy page builds its table from it. Unit tests
  check it against the `apps/` folders and each app's Cloudflare settings.
- **`@shkriuss/astro-config`**: each app's `astro.config.ts` is three lines:
  `defineAppConfig({ slug: 'tally' })`. The shared config then:
  - writes the `_headers` file, so every site gets the same strict security
    headers;
  - generates the install manifest and app icons from the registry entry;
  - writes an offline service worker;
  - keeps scripts and styles out of the HTML, so the strict CSP works.
- **`@shkriuss/storage`**: a small typed wrapper around `localStorage` with
  versioning and migrations, plus back up (locked with a passphrase, or a
  plain copy), restore and "delete all data". Photos and other big files go
  in IndexedDB (`@shkriuss/storage/files`). Spreadsheets to download are
  made with `@shkriuss/storage/csv`, and settings saved one at a time (so
  sync can merge them) with `@shkriuss/storage/settings`.

Shared versions: a pnpm **catalog** in `pnpm-workspace.yaml` pins each
third-party version once for the whole repo.

---

## 3. Cloudflare architecture

- **One Worker per site.** The hub and each app are separate Workers. Pages
  and files are a folder of static files (`dist/`), and requests for them are
  **free and unlimited** on the Free plan. Worker code runs only for
  `/api/*`, for optional features: sync in every app that has it and the
  hub's account ([ADR 0010](adr/0010-account-and-sync.md)), notifications
  while an app is closed ([ADR 0009](adr/0009-push-notifications.md)), and
  Photos' online library in R2 ([ADR 0016](adr/0016-online-photo-library.md)).
  If one app breaks, the others aren't affected.
- **Custom domains.** Each site's `wrangler.jsonc` declares its address, for
  example `{ "pattern": "tally.shkriuss.app", "custom_domain": true }`. On
  deploy, Cloudflare creates the DNS record and HTTPS certificate itself, so
  you never edit DNS by hand.
- **Origins and isolation.** Each subdomain is its own browser "origin", so
  one app can never read another app's saved data.
- **Production deploys.** On every merge to `main`, once every check passes,
  GitHub Actions deploys the exact files it tested, then checks that every
  live site answers with the right security headers.
- **No previews for pull requests** ([ADR 0019](adr/0019-no-pull-request-previews.md)).
  A preview would run a pull request's code, before it's merged, with the
  Cloudflare token. A pull request gets CI's checks; once merged, look at
  the live site, and revert if something's wrong
  ([deployment](deployment.md#rolling-back)).
- **Only the custom domain.** Each site's real address is its custom domain:
  `workers.dev` and Cloudflare's addresses for single versions are off.
- **How it scales.** The Free plan allows 100 Workers and 100 custom domains
  per zone, so about 99 apps plus the hub. Apps with sync or notifications
  also share 5 GB of server storage: about eight more of them fit before the
  limits need lowering ([ADR 0017](adr/0017-storage-limits.md), checked by a
  unit test). A new app needs no Cloudflare
  dashboard work. If CI time grows, deploys can be limited to apps that
  changed.
- **Account settings already checked (read-only):** the `shkriuss.app` zone
  is active on the Free plan. SSL mode is "Full (strict)", minimum TLS is
  1.3, and "Always Use HTTPS" is on. Bot Fight Mode and JavaScript detections
  are off, so Cloudflare doesn't inject any scripts. No existing DNS records
  or Workers would conflict.

Full guide: [deployment.md](deployment.md).

---

## 4. Security and privacy model

### Headers (same for every site, generated from one file)

Defined once in `packages/astro-config/src/headers.ts`
([ADR 0004](adr/0004-security-headers.md)).

| Header                         | Value (short)                                                                                                                                                                                                                                                                 | What it does                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`      | `default-src 'none'`; scripts, styles, fonts, connections, manifest and workers from `'self'` only, images also from `data:` and `blob:` (photos made on the device); `base-uri 'none'`; `form-action 'none'`; `frame-ancestors 'none'`; `require-trusted-types-for 'script'` | Only our own files can run or load. No inline code, no third parties, no framing. Trusted Types block the most common XSS mistakes. |
| `Strict-Transport-Security`    | `max-age=63072000; includeSubDomains; preload`                                                                                                                                                                                                                                | HTTPS only. (The `.app` domain is already HTTPS-only in browsers.)                                                                  |
| `X-Content-Type-Options`       | `nosniff`                                                                                                                                                                                                                                                                     | Stops browsers guessing file types.                                                                                                 |
| `Referrer-Policy`              | `no-referrer`                                                                                                                                                                                                                                                                 | Never tells other sites where a visitor came from.                                                                                  |
| `Permissions-Policy`           | camera, microphone, geolocation, payment, USB, … all `()`                                                                                                                                                                                                                     | Turns powerful browser features off. An app that needs one turns it on with `allowFeatures`.                                        |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                                                                                                                                                                                                                                                 | Isolates the page from pop-ups and other windows.                                                                                   |
| `Cross-Origin-Resource-Policy` | `same-origin`                                                                                                                                                                                                                                                                 | Other sites can't embed our files.                                                                                                  |
| `Cross-Origin-Embedder-Policy` | `require-corp`                                                                                                                                                                                                                                                                | Completes cross-origin isolation.                                                                                                   |
| `X-Frame-Options`              | `DENY`                                                                                                                                                                                                                                                                        | Anti-framing for older browsers.                                                                                                    |

Hashed build files (`/_astro/*`) are cached for a year. Pages revalidate on
every visit, so updates appear right away.

Enforcement: ESLint bans `innerHTML` and friends; `pnpm check:dist` fails on
inline `<script>`, `<style>`, `style=""` or `onclick=`; browser tests fail on
any console error (which includes CSP violations) or any request to another
domain.

### Data storage per app

Each app lists what it stores in `apps.json` (`dataStored`), and the
[privacy page](https://shkriuss.app/privacy/) shows the table for every site,
made from that list. Data is in the browser (`localStorage`, and IndexedDB for
photos), and leaves the device only for the optional sync, notifications and
online library, locked on the device first.

Rules for every app ([ADR 0006](adr/0006-local-first-data.md)):

1. Data stays on the device by default.
2. No cookies, no analytics, no ads, no third-party anything.
3. Every app that stores data has **Back up** (a file, locked with a
   passphrase or a plain copy), **Restore** and **Delete all data**. Photos,
   whose data is too big for a file, has **Delete all data** only.
4. The privacy page lists each app's storage, generated from the registry so
   it can't go out of date.

Honest limits: Cloudflare, as the host, sees visitors' IP addresses in order
to deliver pages and stop attacks. No Cloudflare analytics or logging is turned
on for these sites. The privacy page says so plainly.

### If an app later needs accounts or sync

Done this way: an optional, end-to-end encrypted **shkriuss account** with no
email or password ([ADR 0010](adr/0010-account-and-sync.md)). The original
guidance, kept for reference:

1. **Stay local and add file import** to go with the export. No server at all.
2. **Encrypted sync.** Encrypt data on the device with a key the server never
   sees, and store only the encrypted blob in **Cloudflare D1/KV/R2** behind a
   small Worker.
3. **Accounts, if truly needed.** Use passkeys, or **Cloudflare Access**
   (free for up to 50 users) for personal-only apps. Never store passwords.

Any of these adds server code to that one app only, with its own decision
record, privacy-page entry and token update. They could cost money, so I'll
flag that before starting.

### Repository and supply chain

- No secrets in the repo. The Cloudflare token lives only in **GitHub Actions
  secrets**. The Cloudflare account ID is written in the workflows because
  it isn't secret.
- The Cloudflare API token has only **Workers Scripts: Edit** and **Workers
  R2 Storage: Edit** (your account), and **Workers Routes: Edit** (only the
  `shkriuss.app` zone). Photos' storage code (`PHOTOS_STORAGE_CODE`) is the
  only other secret ([ADR 0016](adr/0016-online-photo-library.md)).
- GitHub Actions are pinned to exact commits (a unit test enforces this).
  Workflows start with no permissions and ask only for what each job needs.
  Checkout never keeps credentials: the **New app** workflow gives its token
  only to the step that pushes the branch.
- pnpm only lets allow-listed packages run install scripts, and won't
  install versions less than 7 days old. Dependabot waits the same 7 days
  before proposing an update (the two must match, or Dependabot fails). For an
  urgent security fix, the package can be exempted in `pnpm-workspace.yaml`.
- [`SECURITY.md`](../SECURITY.md) explains how to report a problem.

---

## 5. Quality gates (all run in GitHub Actions on every pull request)

| Gate                      | Tool                                                              | Fails when…                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting                | Prettier                                                          | any file isn't formatted                                                                                                                 |
| Linting                   | ESLint (TypeScript, Astro, jsx-a11y rules)                        | code or accessibility lint errors                                                                                                        |
| Type checking             | `astro check` + `tsc`                                             | type errors                                                                                                                              |
| Unit tests                | Vitest                                                            | a test fails (app logic, storage, registry, generator, colour contrast in both themes, pinned actions)                                   |
| Build                     | Astro                                                             | any site fails to build                                                                                                                  |
| CSP safety + size budgets | `pnpm check:dist`                                                 | inline code in built HTML, or a page over its gzipped HTML/CSS/JS budget                                                                 |
| End-to-end                | Playwright on `wrangler dev`, phone-sized screen                  | user flows break (for example, a Tally count doesn't survive a reload)                                                                   |
| Accessibility             | axe-core, WCAG 2.2 A/AA + best practices, light **and** dark mode | any violation on any page, broken skip link, sideways scrolling at 320px                                                                 |
| Security and privacy      | Playwright                                                        | a header is missing, a console error (including CSP violations), a cookie, or a request to another domain                                |
| Offline / install         | Playwright                                                        | manifest or icons missing, or the site doesn't load offline                                                                              |
| Dependencies              | `pnpm audit --audit-level high`                                   | a known high or critical vulnerability                                                                                                   |
| Package age               | `scripts/lockfile-age.ts` (pull requests)                         | a pull request adds a package version published less than 7 days ago, one not from the npm registry, or a hash that isn't the registry's |
| Secrets                   | gitleaks                                                          | something that looks like a secret is in any commit                                                                                      |
| Workflows                 | zizmor                                                            | a risky GitHub Actions pattern                                                                                                           |

Shared browser tests in `tests/e2e/` run against **every** site
automatically, so a new app gets these checks without writing any tests.

Honesty note: automated tools catch only some accessibility problems. Before
an app is called "done", it also gets manual checks: keyboard only, a screen
reader, 200% zoom and large text, and reduced motion
([quality.md](quality.md)).

---

## 6. CI/CD (GitHub Actions)

| Workflow      | Runs on                                                | What it does                                                                                                                                                             |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ci.yml`      | every pull request and every push to `main`            | Runs every quality gate. On `main`, if the checks, the secret scan and the dependency audit pass, it **deploys every site to production** and then tests the live sites. |
| `new-app.yml` | started by hand (**Actions → New app → Run workflow**) | Runs the generator with the details you type, pushes a branch, and gives you a link to open the PR.                                                                      |
| Dependabot    | weekly                                                 | Proposes grouped dependency and action updates as PRs. CI must pass before you merge.                                                                                    |

**Branch protection:** the repository is public (since 22 October 2026), so
a ruleset can protect `main`: no deleting or force-pushing it, changes only
through pull requests whose checks pass ([deployment.md](deployment.md#github-settings)).
Production deploys also only happen when the checks, the secret scan and the
dependency audit pass on `main` (the deploy job depends on them).

**CI minutes:** free and unlimited for public repositories on GitHub's
standard machines. (As a private repository it had 2,000 minutes a month, and
they ran out.)

---

## 7. Documentation

- [`CLAUDE.md`](../CLAUDE.md): a short root guide for AI assistants and
  developers. It covers commands, conventions, architecture rules, adding an
  app, and what never to do.
- [`README.md`](../README.md): what this is, the live links, and how to work
  from a phone.
- [`SECURITY.md`](../SECURITY.md): how to report a problem, and the security
  model.
- [`docs/adding-an-app.md`](adding-an-app.md): ask Claude, use the **New
  app** workflow from your phone, or use the command line.
- [`docs/design-system.md`](design-system.md): tokens, components, and
  changing the design everywhere.
- [`docs/deployment.md`](deployment.md): deploys, the token setup, rolling
  back, costs, and troubleshooting.
- [`docs/quality.md`](quality.md): every check, and what to do when one
  fails.
- [`docs/adr/`](adr/): short decision records, listed in
  [`docs/adr/README.md`](adr/README.md).

---

## 8. Roadmap

**Milestone 1: pipeline proven (done)**

- [x] Plan, docs, decision records
- [x] Monorepo, design system, registry, shared Astro config, storage helpers
- [x] Hub with app list, privacy page and 404 page
- [x] App template, generator and **New app** workflow; example app **Tally**
- [x] CI quality gates and the production deploy workflow (all checks pass
      in my environment)
- [x] You: Cloudflare token, GitHub secret and settings (checklist below)
- [x] First production deploy: `shkriuss.app` and `tally.shkriuss.app` live
- [x] You, on your phone: install Tally to your home screen and try it in
      airplane mode

**Milestone 2: polish and hardening**

- Manual accessibility pass on a phone (VoiceOver or TalkBack).
- `www.shkriuss.app` → `shkriuss.app` redirect (a free Cloudflare Redirect
  Rule), if you want it.
- [x] `security.txt` (at `/.well-known/security.txt` on every site, written
      by the build from `packages/astro-config/src/security-txt.ts`): it
      points to GitHub's private security reports.
- [x] Email anti-spoofing DNS records (SPF `-all`, DMARC `reject`, null MX),
      since the domain sends no email.
- [x] Import-from-file for app data: **Back up** (locked with a passphrase)
      and **Restore** in every app ([ADR 0008](adr/0008-encrypted-backups.md)).
- Deploy only the apps that changed, if CI time becomes a problem.
- Upgrades when tooling allows: Node 26 LTS, TypeScript 7, pnpm 11+
  ([ADR 0005](adr/0005-pnpm-typescript-versions.md)).

**Milestone 3: real apps**

- [x] **Calendar** (`calendar.shkriuss.app`): month view, events with times,
      repeats and notes, reminders and notifications, .ics import and export.
- [x] **Notifications while an app is closed** (opt-in, encrypted on the
      device), shared by any app ([ADR 0009](adr/0009-push-notifications.md)).
- [x] **Notes** (`notes.shkriuss.app`): write, search and pin notes; syncs
      through the account.
- [x] **Habits** (`habits.shkriuss.app`): tick habits off each day, streaks,
      the last 7 days, fix the last 2 weeks, reminders (also while closed);
      syncs through the account.
- [x] **Grammar** (`grammar.shkriuss.app`): checks American or British
      English as you type, on the device, with Harper
      ([ADR 0011](adr/0011-on-device-grammar-checking.md)).
- [x] **Grammar Deep check**: an optional AI model (GECToR Large, 381 MB,
      downloaded on request) finds many more mistakes, also on the device
      and offline ([ADR 0012](adr/0012-deep-check-ai-model.md)).
- Add more apps one at a time, each with its own small browser tests.
- [x] **shkriuss account**, part 1: create an account, recovery key,
      passkeys, add devices with a QR code ([ADR 0010](adr/0010-account-and-sync.md)).
- [x] **shkriuss account**, part 2: Calendar and Tally sync through it
      (newest edit of each item wins, deletions sync).
- [x] **shkriuss account**, part 3: replace the account key (for a lost
      device), and a list of the apps that sync on the Account page.
- [x] More apps, each syncing through the account: **Shelf**, **Tasks**,
      **Meals**, **Water**, **Reminders**, **Trades**, **Budget**,
      **Repairs** (with photos) and **Photos**, with an optional online
      library ([ADR 0015](adr/0015-photos-app.md),
      [ADR 0016](adr/0016-online-photo-library.md)).
- [x] A full audit of the code, and its fixes
      ([results](audit/results.md)).

---

## 9. Decisions that are yours (I went ahead with the default)

| Decision               | My default                                               | Other option                                                                                          |
| ---------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Repo visibility        | **Public** (since 22 October 2026, for unlimited CI)     | Private: 2,000 CI minutes a month, and no branch protection or GitHub secret scanning on GitHub Free. |
| GitHub plan            | **Free**                                                 | Pro (~$4/month) is only needed for branch protection on private repos.                                |
| Example app            | **Tally** (tap to count things, saved on your device)    | Any other small app.                                                                                  |
| Brand name on the hub  | **"shkriuss"**                                           | Any name. It's one line in `apps.json`.                                                               |
| Public contact address | **None** (security reports go through GitHub)            | Add an email for privacy and security questions.                                                      |
| PR preview links       | **None** (removed: ADR 0019)                             | Previews behind a Cloudflare Access login (free, more setup).                                         |
| `www.shkriuss.app`     | **Not set up**                                           | Redirect it to `shkriuss.app` (one dashboard rule).                                                   |
| Theme                  | **Follows your device**, with a Light/Dark/System switch | —                                                                                                     |

## 10. Where your request conflicts with best practice

1. **Private repo on GitHub Free** (until 22 October 2026). It had no branch
   protection, secret scanning or push protection, and only 2,000 CI minutes a
   month, which ran out; it's public now. The free checks added at the start
   (gitleaks, zizmor, Dependabot, `pnpm audit`, deploys gated on checks) stay.
2. **"WCAG 2.2 AA" can't be proven by tools alone.** Automated checks catch
   only some issues, so manual checks are part of finishing an app.
3. **"No third parties" vs hosting.** Cloudflare necessarily processes visitor
   IP addresses to serve pages. The privacy page says so instead of claiming
   "zero data".
4. **Local-only data can be lost.** If you clear your browser data or lose
   your phone, app data is gone. Every app has **Back up** and **Restore**,
   and the optional sync keeps a copy on your other devices.
5. **"Newest versions" vs "well supported".** I chose pnpm 10 and
   TypeScript 6 over the newest majors because Dependabot, ESLint and Astro's
   checker don't support those yet. ADR 0005 says when to upgrade.

---

## 11. Your checklist (everything you need to do)

Step-by-step instructions for a phone or tablet are in my status message and
in [deployment.md](deployment.md#setup-one-time).

1. **Create the Cloudflare API token** with the permissions listed in
   [deployment.md](deployment.md#create-the-cloudflare-api-token) (Workers
   Scripts, Workers R2 Storage and Workers Routes, on `shkriuss.app` only).
2. **Save it in GitHub** as the `CLOUDFLARE_API_TOKEN` secret of the
   `production` environment (deployment.md says how).
3. **Turn on Dependabot alerts and security updates** in the repository
   settings.
4. **Merge the first pull request.** That triggers the first production
   deploy.
5. **Check both sites on your phone** and tell me what you see.
6. _(Optional)_ Decide on the items in section 9.
