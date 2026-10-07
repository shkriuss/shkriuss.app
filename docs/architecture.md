# Architecture

- **Status:** accepted
- **Last updated:** 2026-10-04
- **Scope:** the hub, every app and the shared platform. The reasons behind each choice are in the [decision records](decisions/README.md); this document describes the resulting system.

## 1. Summary

`shkriuss.app` is a hub of small, private, offline-first web apps. Each app is an installable PWA on its own permanent subdomain, built from one shared platform in this monorepo. All user data stays in the browser on the user's device. The only way data leaves the device is a backup file the user exports, encrypted by default. There are no accounts, no sync and no server-side user data ([ADR 0003](decisions/0003-local-only-at-launch.md)).

## 2. Principles

1. **Local-first.** Apps work fully offline after the first visit. The network is used only to load and update the apps themselves.
2. **Private by default.** No accounts, cookies, analytics, telemetry or third-party resources.
3. **One platform, thin apps.** Shared packages provide design, layout, storage, backups, offline support and security. An app is mostly its data schema and its screens.
4. **Secure by construction.** A strict browser security policy is applied to every app and verified in CI.
5. **Standards-based.** Built on web platform standards; newer features only with fallbacks.
6. **Verifiable.** Public source code (AGPL-3.0), deploys only from `main`, published build provenance.

## 3. Domains and environments

| Environment | Hub            | Apps                | Access                      |
| ----------- | -------------- | ------------------- | --------------------------- |
| Production  | `shkriuss.app` | `<id>.shkriuss.app` | public                      |
| Staging     | `shkriuss.dev` | `<id>.shkriuss.dev` | private (Cloudflare Access) |
| Local       | `localhost`    | `localhost`         | developer only              |

Rules ([ADR 0001](decisions/0001-domains-and-environments.md)):

- **App ids and subdomains are permanent.** Browser storage and installs are tied to the exact origin, so renaming an app would strand its users' data. Retired ids are never reused.
- **Every subdomain is ours.** Nothing outside this repository is ever served from `*.shkriuss.app` or `*.shkriuss.dev`: no third-party hosting, no wildcard or dangling DNS records.
- **Reserved names** that can never be app ids: `www` (redirects to the apex), `account`, `api`, `auth`, `id`, `admin`, `status`, `mail`, `static`.
- **Staging is a separate registrable domain**, so nothing running there can share cookies or storage (or, in the future, passkeys) with production.

## 4. System overview

```text
 USER'S DEVICE                                    CLOUDFLARE (static hosting only)
 ┌──────────────────────────────────────┐        ┌──────────────────────────────┐
 │ notes.shkriuss.app   (installed PWA) │ files  │ Worker "notes"               │
 │  React UI + shared app shell         │◀───────│  static files + _headers     │
 │  IndexedDB (all user data)           │ HTTPS  │  (no server code)            │
 │  service worker (offline, updates)   │        └──────────────────────────────┘
 └──────────────────────────────────────┘
        │ export / import (only when the user asks)
        ▼
  encrypted backup file (.age) → Files, Google Drive, iCloud Drive …
```

- Each app is a **separate origin** with its own storage, service worker, manifest and install. The browser's same-origin policy stops apps from reading each other's data.
- The **hub** (`shkriuss.app`) is a static site: the app catalog, install guides, and the privacy and security pages ([hub spec](specs/hub.md)). It holds no user data, and has no service worker.
- Hosting is purely static. There is no backend, database or API.

## 5. Repository layout

```text
shkriuss.app/
├─ apps/                    one folder = one origin = one Cloudflare Worker
│  ├─ hub/                  shkriuss.app
│  └─ <id>/                 <id>.shkriuss.app
├─ packages/                the shared platform (see table)
├─ tooling/                 repository checks, the app template and create-app, platform tests
├─ docs/                    architecture, threat model, roadmap, decisions, specs
├─ CLAUDE.md                rules for every contributor, human or AI
└─ SECURITY.md              how to report vulnerabilities
```

| Package            | Responsibility                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@shkriuss/config` | Shared TypeScript settings and the end-to-end test setup (Playwright); lint and format settings are at the repository's root                                                                                                                 |
| `@shkriuss/ui`     | Design tokens, theme, accessible components (React Aria), icons                                                                                                                                                                              |
| `@shkriuss/shell`  | App frame: navigation, settings, about, install and update prompts, storage status, backup screens, error handling; every app's build and the hub's catalog (`@shkriuss/shell/vite`); the frame that the hub shares (`@shkriuss/shell/site`) |
| `@shkriuss/data`   | Local database, record model, merge rules, migrations, reactive queries                                                                                                                                                                      |
| `@shkriuss/backup` | Export and import, encryption (`age`), backup format versions, readable export formats                                                                                                                                                       |
| `@shkriuss/pwa`    | Web app manifest, service worker, install and update flow, persistent storage                                                                                                                                                                |
| `@shkriuss/edge`   | Security headers (`_headers`), script integrity, starting workers under Trusted Types, and Cloudflare/Wrangler configuration                                                                                                                 |
| `@shkriuss/i18n`   | Typed message modules in English ([ADR 0012](decisions/0012-typed-messages.md)) and `Intl` formats                                                                                                                                           |

Dependency direction: apps → `shell` → (`ui`, `data`, `backup`, `pwa`, `i18n`); `backup` → `data`. Code that runs in the browser uses `@shkriuss/edge` only through its browser entry points, `@shkriuss/edge/workers` and `@shkriuss/edge/domains`. No package imports an app, and apps never import other apps; only the hub's build reads every app's `app.config.ts`, for its catalog. `pnpm check` enforces this, and that relative imports stay within their package.

## 6. Anatomy of an app

```text
apps/<id>/
├─ app.config.ts      id (permanent), name and description from the app's messages,
│                     accent color, icon glyph, opt-in browser features
├─ vite.config.ts     the build: app(config) of @shkriuss/shell/vite
├─ index.html         the page, which the build titles and links the manifest from
├─ src/main.tsx       starts the service worker, the database and the router
├─ src/router.ts      the routes, declared in code (ADR 0013)
├─ src/routes/        one file per screen, with its route
├─ src/features/      app-specific components and logic
├─ src/schema.ts      record types and migrations
├─ src/messages.ts    the app's text
└─ e2e/               Playwright tests
```

Generated from `app.config.ts` at build time: the web app manifest and the icons, the page's title and description, the service worker, and `_headers` (security policy and permissions). The hub's catalog reads it too, at the hub's build: each app's name, description, icon and browser features; its privacy label follows from them ([hub spec](specs/hub.md) §2). Extra export formats join it when the first readable export needs them. Apps are created only with `create-app` (`tooling/create-app`), from the app template in `tooling/app-template`: a small app that CI builds and tests like every app, so that the template always works. `pnpm check` holds every app, and the template, to the standard structure: the same files, an id equal to the app's folder, the platform's build and a test server of its own.

## 7. Data layer

All user data lives in IndexedDB and is accessed only through `@shkriuss/data`, which uses Dexie underneath. Decision: [ADR 0004](decisions/0004-local-data-and-backups.md). The exact format is specified in [specs/data-model.md](specs/data-model.md).

- **Records** carry a permanent id (UUIDv7), a schema version, a hybrid-logical-clock (HLC) timestamp for every field, and a deletion marker (tombstone). Tombstones are kept, so importing an old backup can never bring a deleted item back.
- **Merging** (used when a backup is imported, and by any future sync) is field-level last-writer-wins by HLC, with ties broken by device id. It is deterministic, order-independent and idempotent, which property-based tests verify.
- **Migrations** are versioned functions that run inside the database upgrade transaction, so they apply completely or not at all. An app keeps a migration path from every schema version it ever shipped, because old backups must always import.
- **Data newer than the app understands**, such as a backup made by a newer version, is rejected with an "update the app" message, never partially imported.
- **Versions side by side:** a new version that upgrades the database closes it in tabs that still run an older version, which must reload. An older version never opens a database that a newer one has upgraded, because it would write records of its older schema among newer ones. A release that raises the schema version is therefore never rolled back, only fixed by a newer one.
- **Persistence:** apps request persistent storage (`navigator.storage.persist()`) and show how much they store in Settings, through `@shkriuss/pwa`. Firefox asks the user, so apps request it only when the user acts, as from Settings; Chromium and Safari decide by themselves, from how much the app is used and whether it is installed.

## 8. Backups

Backups are the only way data leaves a device, the only protection against losing one, and the way to move data between devices. They are a first-class platform feature. The exact format is specified in [specs/backup-format.md](specs/backup-format.md).

- **Encrypted by default.** A versioned JSON document encrypted in the standard [age](https://age-encryption.org) format with a passphrase (scrypt). Files end in `.age` and can also be decrypted with the `age` command-line tool, so users are never locked in. A generated passphrase is offered. Deriving the key takes seconds and 256 MiB on a phone, so encryption and decryption run in a worker that ends after each operation.
- **Plain JSON export** is available only after an explicit warning.
- **Readable exports** (CSV, Markdown, iCalendar and so on) where they suit an app. They are for other tools, not for restoring.
- **Import pipeline:** size check → decrypt → parse → validate against the schema → migrate → preview ("12 new, 3 updated, 1 deleted") → merge → commit in one transaction → report. A failure at any step changes nothing.
- **Saving:** the share sheet (Web Share API) on phones and tablets — Files, Google Drive, iCloud Drive — with a download fallback. Browsers decide which files they share: Chrome shares only some types, which leave out backup files, so it downloads them. Automatic backup to a chosen folder (File System Access API, desktop Chromium) is planned. It needs a way to encrypt with nobody present without storing the passphrase, which requires its own design and ADR first ([backup-format.md §9](specs/backup-format.md#9-not-covered)).
- **Reminders:** each app tracks when it was last backed up and how many changes it has had since ([data-model.md §7](specs/data-model.md#7-storage)). A banner in the frame reminds the user to back up when there are changes and no backup yet, or the last backup is a week old. It appears when the app opens or comes back into view, never in the middle of a task, and its "Back up" makes the backup at once.
- **Moving data between devices** means exporting on one and importing on the other. Because import merges, this works like a manual sync.

## 9. Offline, install and updates

- **Manifest:** generated per app with a stable `id`, `scope: /`, standalone display, maskable and monochrome icons, theme colors, and shortcuts or `share_target` where an app needs them. Every icon, and the iOS touch icon and the favicon, is drawn at build time from the app's glyph, given as SVG path data, on its accent color, by `@shkriuss/pwa` itself, without dependencies.
- **Service worker:** our own, in `@shkriuss/pwa` (no Workbox), at `/sw.js`, registered through the platform's Trusted Types policy for worker scripts ([ADR 0011](decisions/0011-worker-trusted-types-policy.md)). The [service worker spec](specs/service-worker.md) gives every detail.
  - It precaches the build output, so the app opens offline instantly.
  - It serves the app shell for navigations and never caches anything cross-origin.
  - **Updates:** a new version installs in the background and waits. The app shows "Update available" and reloads when the user agrees, never in the middle of a task.
  - **Kill switch:** a documented, tested procedure replaces a broken service worker without touching user data. It never brings back a build with an older schema version, which could not open the upgraded database (§7).
- **Install:** Android and desktop Chromium use the browser's install prompt, which an app shows from its settings when the user asks; iOS uses a guided "Add to Home Screen". Other browsers may install from their menu. Where the Web Install API exists (desktop Chromium), the hub can offer one-click install of an app as an enhancement.
- **iOS:** every installed home-screen app has its own storage, separate from Safari, and Safari may delete a site's data after seven days of Safari use without a visit to that site (installed apps are exempt). In Safari on iOS, apps therefore suggest installing _before_ the user enters data, with a banner while the device has none, and their settings explain how to move data into the installed app with a backup.

## 10. User interface

- React 19, Vite, TypeScript and TanStack Router, with routes declared in code ([ADR 0005](decisions/0005-frontend-stack.md), [ADR 0013](decisions/0013-routes-in-code.md)). The React Compiler waits for support of Babel 8 ([roadmap](roadmap.md)).
- **Navigation:** the shell's frame leads to the app's first screen and to its settings, and each screen titles the page. Links between screens open them without loading the page again, and the new screen's heading takes the focus, which screen readers then read.
- `@shkriuss/ui` wraps React Aria Components with our design tokens (Tailwind CSS 4): one look across all apps with a per-app accent color, light and dark themes, system fonts and bundled SVG icons.
- Layouts are phone-first, with two-pane layouts for tablets and desktops. They respect safe areas, reduced motion and contrast preferences.
- Accessibility target: WCAG 2.2 AA.
- English UI. All text comes from typed message modules of `@shkriuss/i18n` ([ADR 0012](decisions/0012-typed-messages.md)), and lint refuses text in JSX. Dates, numbers and lists are formatted with `Intl` using the device's regional settings: in English for the device's region, such as `en-DE` for a device set to German, where the browser has it, and otherwise in `en` with the device's 12-hour or 24-hour clock.

## 11. Hosting and delivery

- **Cloudflare Workers static assets**, one Worker per app (and one for the hub), each with a custom domain per environment ([ADR 0006](decisions/0006-hosting-and-deployment.md)). There is no Worker script: responses come straight from the asset store, with headers from a generated `_headers` file, and unknown paths fall back to `index.html`.
- **Caching:** hashed assets are immutable for a year; `index.html`, the manifest and the service worker are revalidated on every load.
- **Deployment:** GitHub Actions, in the same workflow as the checks.
  - Every merge to `main` deploys every app in `apps/`, the hub among them, to staging once every check has passed, each to its own domain.
  - A separate job then signs the build provenance of every file staging received: a GitHub artifact attestation, signed with a short-lived Sigstore certificate and recorded in Sigstore's public transparency log. That job runs no code from the repository or its dependencies, so nothing else can sign in its name.
  - Production receives the same commit once its provenance is attested, after manual approval in the `production` environment. It deploys only if its build is byte-for-byte the one staging received, and if no file in `/assets/` would change its content under the same name; browsers keep those files for a year.
  - Rolling back means redeploying the previous version.
  - Each app's `wrangler.json` keeps `workers.dev` and preview URLs off, so nothing bypasses Cloudflare Access on staging; `pnpm check` enforces it.
- **Cloudflare features that rewrite pages or inject scripts** (Rocket Loader, Email Address Obfuscation, Zaraz, Web Analytics auto-injection, Bot Fight Mode's JavaScript detections) stay off, because they conflict with the security policy and integrity checks.
- **Network Error Logging** stays off too. Cloudflare turns it on by default; its `NEL` and `Report-To` headers make browsers send reports about failed connections to Cloudflare, which is telemetry.
- **Plan:** Cloudflare Free. Static asset requests are free and unlimited.

## 12. Security

The baseline is defined in [ADR 0007](decisions/0007-security-baseline.md); threats and mitigations are in the [threat model](threat-model.md). Every app is served with these headers, generated by `@shkriuss/edge`:

```text
Content-Security-Policy: default-src 'none'; script-src 'self' 'sha256-<import map>';
  style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; manifest-src 'self';
  worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';
  require-trusted-types-for 'script'; trusted-types 'none'
  (in apps with worker scripts: trusted-types shkriuss-workers)
  (in apps that declare WebAssembly: script-src 'self' 'wasm-unsafe-eval' 'sha256-<import map>')
Integrity-Policy: blocked-destinations=(script)
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Referrer-Policy: no-referrer
Permissions-Policy: powerful features denied, except web-share and what app.config.ts opts into
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

Staging additionally sends `X-Robots-Tag: noindex`. That is a host rule in the same `_headers` file, so staging and production deploy identical files.

- **Script integrity** ([ADR 0010](decisions/0010-script-integrity.md)): every script — the entry point and lazily loaded chunks — carries an integrity hash (an SRI attribute and import-map `integrity`), added after the build by `@shkriuss/edge`. Chunks other than the entry are loaded only with `import()`, because Safari refuses statically imported ones. `Integrity-Policy` makes the browser refuse any script without one. The import map is the only inline script; the CSP allows it by its hash, which changes with every build.
- **Workers** ([ADR 0011](decisions/0011-worker-trusted-types-policy.md)): the script of a worker or service worker must be a Trusted Type. Apps with worker scripts allow exactly one policy, `shkriuss-workers`, which `@shkriuss/edge/workers` creates; it accepts only the app's own worker bundles (`/assets/<name>.worker-<hash>.js`, each built into one file) and `/sw.js`. Other apps allow no policy. Browsers cannot check the integrity of worker scripts; the published file hashes and the build provenance cover them (threat model R6).
- **WebAssembly** ([ADR 0014](decisions/0014-webassembly.md)): only an app that declares `webAssembly` in its `app.config.ts` may compile it, in its workers; its `script-src` then allows `'wasm-unsafe-eval'`, and nothing else changes. Modules are files of the app in `/assets/`, which its workers fetch from its own origin and its service worker keeps, as it keeps worker scripts (threat model R6). The build fails if an app ships modules without declaring them, declares them without shipping any, or loads one from the page.
- **Older browsers** that don't support Trusted Types or `Integrity-Policy` ignore those headers; the apps still work, with weaker protection.
- **Code rules:** no HTML injection sinks, no `eval`, no inline scripts (except the generated import map) or styles; user content is rendered as text (see `CLAUDE.md`).
- **Supply chain:** few dependencies; pnpm with a release-age delay, blocked install scripts and a frozen lockfile; GitHub Actions pinned to commit SHAs with least-privilege tokens; CodeQL, dependency review and secret scanning.
- **Transparency:** public source, a build provenance attestation for every deployed file, and a published SHA-256 list of every deployed file (`/sha256sums.txt` on every origin), so anyone can check what a site serves ([how](../packages/edge/README.md#deployment-checks)) — ready for browser-verified transparency (WAICT) once browsers ship it.
- **Reporting problems:** every origin serves `/.well-known/security.txt` ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116)), which points to GitHub's private vulnerability report, as [`SECURITY.md`](../SECURITY.md) does. It expires 180 days after the commit that was built, so that every build of a commit is the same ([hub spec](specs/hub.md) §4).
- **Licenses:** every origin serves `/licenses.txt`. It says that the app is free software (AGPL-3.0-only) and where its source is, and gives the license texts of all the software and material of others in its build. The build writes it and fails for a package without a license file ([how](../packages/edge/README.md#licenses)).

## 13. Privacy

- No accounts, cookies, analytics, telemetry, fingerprinting or third-party requests.
- Cloudflare necessarily sees standard request metadata — IP address, user agent and which files are requested — when it serves the apps. We keep logging minimal and collect nothing else.
- The hub publishes a plain-language privacy policy and explains exactly what the server can see.

## 14. Browser support

- Current Chrome, Edge and Firefox, and Safari 18 or later (iOS, iPadOS and macOS).
- Baseline "widely available" features are used freely. Newer features are used only with a fallback, for example the Web Install API, the File System Access API, and Temporal (with a polyfill where it is missing).
- **Real devices:** iPhone (Safari tab and installed app), Pixel (Chrome tab and installed app), Pixel Tablet (Chrome, large screen). Desktop browsers are covered by automated tests.

## 15. Quality

Every pull request must pass the gates in [ADR 0008](decisions/0008-quality-gates.md):

- type checks and lint;
- unit and property-based tests;
- component tests in real browsers (Chromium, Firefox, WebKit);
- Playwright end-to-end tests against the production build served with production headers, where any CSP or integrity violation fails the run; a test app that is never deployed (`tooling/platform-e2e`) tests the shared platform the same way, and the app template (`tooling/app-template`) is tested as every app is;
- accessibility checks (axe);
- performance and bundle-size budgets.

## 16. Future: accounts and sync

Accounts are deliberately out of scope ([ADR 0003](decisions/0003-local-only-at-launch.md)). If they are ever added, they will be optional, passkey-only and end-to-end encrypted, layered on the existing local data model. The design sketch, and the constraints we keep today so it stays possible, are in [future/accounts-and-sync.md](future/accounts-and-sync.md).
