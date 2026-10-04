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
- The **hub** (`shkriuss.app`) is a static site: the app catalog, install guides, and the privacy and security pages. It holds no user data.
- Hosting is purely static. There is no backend, database or API.

## 5. Repository layout

```text
shkriuss.app/
├─ apps/                    one folder = one origin = one Cloudflare Worker
│  ├─ hub/                  shkriuss.app
│  └─ <id>/                 <id>.shkriuss.app
├─ packages/                the shared platform (see table)
├─ tooling/create-app/      generator for new apps
├─ docs/                    architecture, threat model, roadmap, decisions, specs
├─ CLAUDE.md                rules for every contributor, human or AI
└─ SECURITY.md              how to report vulnerabilities
```

| Package            | Responsibility                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `@shkriuss/config` | Shared TypeScript, lint, format, Vite, Vitest and Playwright presets                                               |
| `@shkriuss/ui`     | Design tokens, theme, accessible components (React Aria), icons                                                    |
| `@shkriuss/shell`  | App frame: navigation, settings, about, install and update prompts, storage status, backup screens, error handling |
| `@shkriuss/data`   | Local database, record model, merge rules, migrations, reactive queries                                            |
| `@shkriuss/backup` | Export and import, encryption (`age`), backup format versions, readable export formats                             |
| `@shkriuss/pwa`    | Web app manifest, service worker, install and update flow, persistent storage                                      |
| `@shkriuss/edge`   | Security headers (`_headers`) and Cloudflare/Wrangler configuration                                                |
| `@shkriuss/i18n`   | Message catalogs (English) and `Intl` formatting helpers                                                           |

Dependency direction: apps → `shell` → (`ui`, `data`, `backup`, `pwa`, `i18n`); `backup` → `data`. No package imports an app, and apps never import other apps. Lint rules enforce this.

## 6. Anatomy of an app

```text
apps/<id>/
├─ app.config.ts      id (permanent), name, description, accent color, icon,
│                     opt-in browser permissions, privacy label, extra export formats
├─ src/schema.ts      record types and migrations
├─ src/routes/        screens (TanStack Router, file-based)
├─ src/features/      app-specific components and logic
├─ public/            icon source (all sizes are generated)
└─ e2e/               Playwright tests
```

Generated from `app.config.ts` at build time: the web app manifest, icons, `_headers` (security policy and permissions), Wrangler configuration and the app's entry in the hub catalog. Apps are created only with `create-app`, and CI checks that every app keeps the standard structure.

## 7. Data layer

All user data lives in IndexedDB and is accessed only through `@shkriuss/data`, which uses Dexie underneath. Decision: [ADR 0004](decisions/0004-local-data-and-backups.md). The exact format will be specified in `docs/specs/data-model.md` (Phase 1.1).

- **Records** carry a permanent id (UUIDv7), a schema version, a hybrid-logical-clock (HLC) timestamp for every field, and a deletion marker (tombstone). Tombstones are kept, so importing an old backup can never bring a deleted item back.
- **Merging** (used when a backup is imported, and by any future sync) is field-level last-writer-wins by HLC, with ties broken by device id. It is deterministic, order-independent and idempotent, which property-based tests verify.
- **Migrations** are versioned functions that run inside the database upgrade transaction, so they apply completely or not at all. An app keeps a migration path from every schema version it ever shipped, because old backups must always import.
- **Data newer than the app understands**, such as a backup made by a newer version, is rejected with an "update the app" message, never partially imported.
- **Persistence:** apps request persistent storage (`navigator.storage.persist()`) and show how much they store in Settings.

## 8. Backups

Backups are the only way data leaves a device, the only protection against losing one, and the way to move data between devices. They are a first-class platform feature. The exact format will be specified in `docs/specs/backup-format.md` (Phase 1.1).

- **Encrypted by default.** A versioned JSON document encrypted in the standard [age](https://age-encryption.org) format with a passphrase (scrypt). Files end in `.age` and can also be decrypted with the `age` command-line tool, so users are never locked in. A generated passphrase is offered.
- **Plain JSON export** is available only after an explicit warning.
- **Readable exports** (CSV, Markdown, iCalendar and so on) where they suit an app. They are for other tools, not for restoring.
- **Import pipeline:** size check → decrypt → parse → validate against the schema → migrate → preview ("12 new, 3 updated, 1 deleted") → merge → commit in one transaction → report. A failure at any step changes nothing.
- **Saving:** the share sheet (Web Share API) on phones and tablets — Files, Google Drive, iCloud Drive — with a download fallback. Automatic backup to a chosen folder (File System Access API) is offered where the browser supports it (desktop Chromium).
- **Reminders:** each app tracks when it was last backed up and what changed since, and nudges the user.
- **Moving data between devices** means exporting on one and importing on the other. Because import merges, this works like a manual sync.

## 9. Offline, install and updates

- **Manifest:** generated per app with a stable `id`, `scope: /`, standalone display, maskable and monochrome icons, theme colors, and shortcuts or `share_target` where an app needs them.
- **Service worker:** our own, in `@shkriuss/pwa` (no Workbox).
  - It precaches the build output, so the app opens offline instantly.
  - It serves the app shell for navigations and never caches anything cross-origin.
  - **Updates:** a new version installs in the background and waits. The app shows "Update available" and reloads when the user agrees, never in the middle of a task.
  - **Kill switch:** a documented, tested procedure replaces a broken service worker without touching user data.
- **Install:** Android and desktop Chromium use the browser's install prompt; iOS uses a guided "Add to Home Screen". Where the Web Install API exists (desktop Chromium), the hub can offer one-click install of an app as an enhancement.
- **iOS:** every installed home-screen app has its own storage, separate from Safari, and Safari may delete a site's data after seven days of Safari use without a visit to that site (installed apps are exempt). In Safari on iOS, apps therefore suggest installing _before_ the user enters data, and offer export → import to move data into the installed app.

## 10. User interface

- React 19 with React Compiler, Vite, TypeScript and TanStack Router ([ADR 0005](decisions/0005-frontend-stack.md)).
- `@shkriuss/ui` wraps React Aria Components with our design tokens (Tailwind CSS 4): one look across all apps with a per-app accent color, light and dark themes, system fonts and bundled SVG icons.
- Layouts are phone-first, with two-pane layouts for tablets and desktops. They respect safe areas, reduced motion and contrast preferences.
- Accessibility target: WCAG 2.2 AA.
- English UI. All strings go through `@shkriuss/i18n`; dates, numbers and lists are formatted with `Intl` using the device's regional settings.

## 11. Hosting and delivery

- **Cloudflare Workers static assets**, one Worker per app (and one for the hub), each with a custom domain per environment ([ADR 0006](decisions/0006-hosting-and-deployment.md)). There is no Worker script: responses come straight from the asset store, with headers from a generated `_headers` file, and unknown paths fall back to `index.html`.
- **Caching:** hashed assets are immutable for a year; `index.html`, the manifest and the service worker are revalidated on every load.
- **Deployment:** GitHub Actions. Every merge to `main` deploys the changed apps to staging automatically. Production receives the same commit after manual approval. Rolling back means redeploying the previous version.
- **Cloudflare features that rewrite pages or inject scripts** (Rocket Loader, Email Address Obfuscation, Zaraz, Web Analytics auto-injection, Bot Fight Mode's JavaScript detections) stay off, because they conflict with the security policy and integrity checks.
- **Plan:** Cloudflare Free. Static asset requests are free and unlimited.

## 12. Security

The baseline is defined in [ADR 0007](decisions/0007-security-baseline.md); threats and mitigations are in the [threat model](threat-model.md). Every app is served with these headers, generated by `@shkriuss/edge`:

```text
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
  img-src 'self' blob: data:; connect-src 'self'; manifest-src 'self';
  worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';
  require-trusted-types-for 'script'; trusted-types 'none'
Integrity-Policy: blocked-destinations=(script)
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Referrer-Policy: no-referrer
Permissions-Policy: everything denied except web-share and what app.config.ts opts into
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

Staging additionally sends `X-Robots-Tag: noindex`.

- **Script integrity:** every script — the entry point, preloads and lazily loaded chunks — carries an integrity hash (SRI attributes and import-map `integrity`). `Integrity-Policy` makes the browser refuse any script without one.
- **Older browsers** that don't support Trusted Types or `Integrity-Policy` ignore those headers; the apps still work, with weaker protection.
- **Code rules:** no HTML injection sinks, no `eval`, no inline scripts or styles; user content is rendered as text (see `CLAUDE.md`).
- **Supply chain:** few dependencies; pnpm with a release-age delay, blocked install scripts and a frozen lockfile; GitHub Actions pinned to commit SHAs with least-privilege tokens; CodeQL, dependency review and secret scanning.
- **Transparency:** public source, build provenance attestations, and a published SHA-256 list of every deployed file — ready for browser-verified transparency (WAICT) once browsers ship it.

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
- Playwright end-to-end tests against the production build served with production headers, where any CSP or integrity violation fails the run;
- accessibility checks (axe);
- performance and bundle-size budgets.

## 16. Future: accounts and sync

Accounts are deliberately out of scope ([ADR 0003](decisions/0003-local-only-at-launch.md)). If they are ever added, they will be optional, passkey-only and end-to-end encrypted, layered on the existing local data model. The design sketch, and the constraints we keep today so it stays possible, are in [future/accounts-and-sync.md](future/accounts-and-sync.md).
