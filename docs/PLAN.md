# shkriuss.app: project plan

_Last updated: 2026-10-16. Versions were checked against the npm registry and
official docs on that date._

This is the plan for a hub at **shkriuss.app** that lists small personal web
apps. Each app lives on its own subdomain, for example `tally.shkriuss.app`.
All code is in one GitHub repository (a "monorepo"). Everything is built,
tested and deployed by GitHub Actions and Cloudflare, so you never need a
computer or a terminal.

---

## 1. Technology choices

| Area                               | Choice                                                               | Why (one line)                                                                                                                                                 | Main alternative rejected                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language                           | **TypeScript 6.0**                                                   | JavaScript with type checking, which catches mistakes before they ship.                                                                                        | TypeScript 7.0 (the new native compiler). It's faster, but ESLint's TypeScript support and Astro's checker don't support it yet (they need `<6.1`). |
| Framework                          | **Astro 7** (static output)                                          | Builds plain HTML and CSS and ships zero JavaScript unless a page asks for it, so it's fast and private by default. Cloudflare recommends it for static sites. | SvelteKit or Next.js: more powerful, but heavier and more complex than these small apps need.                                                       |
| Interactivity                      | **Plain TypeScript in Astro `<script>` tags**                        | No extra UI library to learn or update.                                                                                                                        | Svelte or Preact islands. These stay an option for a future app with complex UI, and adding one would get its own decision record.                  |
| Package manager                    | **pnpm 12**                                                          | Fast, strict, built for monorepos ("workspaces"), with safe defaults: install scripts are blocked and packages younger than 1 day aren't installed.            | npm workspaces. They work, but they're slower and have weaker protection against supply-chain attacks.                                              |
| Runtime for tools                  | **Node.js 24 LTS**                                                   | The current long-term-support version, required by Astro 7.                                                                                                    | Node 26: not LTS yet.                                                                                                                               |
| Hosting                            | **Cloudflare Workers with static assets**                            | Cloudflare now tells new projects to use Workers. Static files are served free and without limit.                                                              | Cloudflare Pages, which Cloudflare no longer recommends for new projects.                                                                           |
| Deploy tool                        | **Wrangler 4**, run from GitHub Actions                              | The official Cloudflare CLI. One workflow can deploy any number of apps.                                                                                       | Workers Builds (Cloudflare's Git integration). It would need dashboard setup for every new app.                                                     |
| Lint and format                    | **ESLint 10 + Prettier 3**, with the Astro and accessibility plugins | The most popular and best-documented pair, with official Astro support.                                                                                        | Biome. It's one tool with fewer dependencies, but its Astro support is still partial.                                                               |
| Unit tests                         | **Vitest 5**                                                         | Fast, and uses the same Vite tooling as Astro.                                                                                                                 | Jest: slower and needs extra setup for TypeScript.                                                                                                  |
| End-to-end and accessibility tests | **Playwright + axe-core**                                            | Drives a real browser against the real Cloudflare runtime (`wrangler dev`), with WCAG 2.2 AA rules.                                                            | Cypress: heavier, with a weaker accessibility integration.                                                                                          |
| Performance budgets                | **A small size-budget script** (no dependency)                       | Checks exact, repeatable byte counts for HTML, CSS and JS on every pull request.                                                                               | Lighthouse CI. Its scores are flaky on shared CI machines and it adds a large dependency.                                                           |
| Secret scanning                    | **gitleaks** (pinned binary in CI)                                   | Free, and works on private repos.                                                                                                                              | GitHub secret scanning, which isn't available for private repos on personal GitHub Free accounts.                                                   |
| Dependency scanning                | **Dependabot** + **`pnpm audit`** in CI                              | Both are free on private repos.                                                                                                                                | Snyk, a third-party account.                                                                                                                        |

Privacy extras: Astro's and Wrangler's anonymous usage telemetry are turned off
in CI (`ASTRO_TELEMETRY_DISABLED=1`, `WRANGLER_SEND_METRICS=false`).

---

## 2. Monorepo structure

```
shkriuss.app/
├── apps/
│   ├── hub/                 → shkriuss.app (lists every app, privacy page)
│   └── tally/               → tally.shkriuss.app (example app)
├── packages/
│   ├── ui/                  @shkriuss/ui: design system (tokens, CSS, components, layouts, icons)
│   ├── registry/            @shkriuss/registry: THE list of apps (apps.json) + types + validation
│   ├── astro-config/        @shkriuss/astro-config: shared Astro config + build integration
│   │                        (security headers, web manifest, icons, service worker)
│   └── storage/             @shkriuss/storage: on-device data helpers (save, export, delete)
├── templates/app/           starting files for a new app (copied by the generator)
├── scripts/                 new-app generator, size budgets, small CI helpers
├── tests/e2e/               shared browser tests that run against EVERY app automatically
├── docs/                    plan, decision records (adr/), guides
└── .github/                 CI/CD workflows, Dependabot config
```

How the shared packages work:

- **`@shkriuss/ui`**: one CSS file of design tokens (colours, spacing, type
  sizes, radii) with automatic dark and light modes. Also base styles, a few
  CSS component classes (`.btn`, `.card`, …), Astro components (`<Button>`,
  `<Card>`, `<Icon>`, `<AppShell>`), and a small SVG icon set. Change a token
  once and every app changes on its next deploy.
- **`@shkriuss/registry`**: `apps.json` is the single list of apps. The hub
  reads it to draw its app cards. Each app reads its own entry for its name,
  description, icon and colour. The privacy page reads it to show where each
  app stores data. A unit test checks that every entry is valid and has a
  matching folder in `apps/`.
- **`@shkriuss/astro-config`**: each app's `astro.config.ts` is three lines:
  `defineAppConfig({ slug: "tally" })`. The shared config then:
  - writes the `_headers` file, so every app gets the same strict security
    headers;
  - generates the PWA manifest and icons from the registry entry;
  - writes an offline service worker;
  - turns off inlined scripts and styles, so the strict CSP works.
- **`@shkriuss/storage`**: a tiny typed wrapper around `localStorage` with
  versioning, plus "export my data" and "delete my data" helpers. Every app
  handles user data the same way.

Shared versions: a pnpm **catalog** in `pnpm-workspace.yaml` pins each
third-party version (Astro, TypeScript, …) once for the whole repo.

---

## 3. Cloudflare architecture

- **One Worker per site, assets only.** The hub and each app are separate
  Workers with no server code, just a folder of static files (`dist/`).
  Requests to static assets are **free and unlimited** on the Free plan. If
  one app breaks, the others aren't affected.
- **Custom domains.** Each app's `wrangler.jsonc` declares
  `{ "pattern": "tally.shkriuss.app", "custom_domain": true }`. On deploy,
  Cloudflare creates the DNS record and the TLS certificate itself, so you
  never edit DNS by hand.
- **Origins and isolation.** Each subdomain is its own browser "origin", so
  one app can never read another app's saved data.
- **Production deploys.** On every merge to `main`, after all checks pass,
  GitHub Actions runs `wrangler deploy` for every site.
- **Previews for pull requests.** Every PR gets
  `pnpm wrangler preview --name pr-<number>` (Cloudflare's "Previews"
  feature) for each site. A bot comment on the PR lists the preview links,
  for example `https://pr-7-tally.shkriuss.workers.dev`. Previews are deleted
  when the PR closes. Cloudflare adds `X-Robots-Tag: noindex` to them, so
  search engines don't index them.
- **`workers.dev` turned off for production.** Each app's real address is only
  its custom domain. Previews still use `workers.dev`.
- **How it scales.** The Free plan allows 100 Workers and 100 custom domains
  per zone, so about 99 apps plus the hub. Adding an app needs no Cloudflare
  dashboard work: the next deploy creates the Worker, the DNS record and the
  certificate. If CI time grows, the deploy step can be limited to apps that
  changed (noted in the roadmap).
- **Account settings already checked (read-only):** zone `shkriuss.app` is
  active on the Free plan, SSL mode is "Full (strict)", minimum TLS is 1.3,
  "Always Use HTTPS" is on, and Bot Fight Mode and JS detections are off, so
  Cloudflare injects no scripts. There are no existing DNS records or Workers
  that would conflict.

---

## 4. Security and privacy model

### Headers (same for every site, generated from one file)

| Header                         | Value (short)                                                                                                                                                                                                                                                                                                  | What it does                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Content-Security-Policy`      | `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests; require-trusted-types-for 'script'; trusted-types 'none'` | Only our own files can run or load. No inline scripts, no third parties, no framing. Trusted Types blocks the most common XSS sinks. |
| `Strict-Transport-Security`    | `max-age=63072000; includeSubDomains; preload`                                                                                                                                                                                                                                                                 | HTTPS only. The `.app` domain is already HTTPS-only in browsers.                                                                     |
| `X-Content-Type-Options`       | `nosniff`                                                                                                                                                                                                                                                                                                      | Stops the browser from guessing file types.                                                                                          |
| `Referrer-Policy`              | `no-referrer`                                                                                                                                                                                                                                                                                                  | Never tells other sites where a visitor came from.                                                                                   |
| `Permissions-Policy`           | camera, microphone, geolocation, payment, USB, … all `()`                                                                                                                                                                                                                                                      | Turns powerful browser features off. An app that needs one turns it on in its own config.                                            |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                                                                                                                                                                                                                                                                                  | Isolates the page from pop-ups and other windows.                                                                                    |
| `Cross-Origin-Resource-Policy` | `same-origin`                                                                                                                                                                                                                                                                                                  | Other sites can't embed our files.                                                                                                   |
| `Cross-Origin-Embedder-Policy` | `require-corp`                                                                                                                                                                                                                                                                                                 | Completes cross-origin isolation.                                                                                                    |
| `X-Frame-Options`              | `DENY`                                                                                                                                                                                                                                                                                                         | Anti-framing for older browsers.                                                                                                     |

Hashed build files (`/_astro/*`) are cached for a year. HTML is revalidated
on every visit, so updates appear right away.

A build test fails if any page has an inline `<script>`, inline `<style>`, or
`style="…"` attribute, because the CSP would block those. A browser test
fails on any CSP violation or any request to another domain.

### Data storage per app

| Site  | Data stored                            | Where                                              |
| ----- | -------------------------------------- | -------------------------------------------------- |
| Hub   | Theme choice (light, dark or system)   | Your browser (`localStorage`), never sent anywhere |
| Tally | Counter names and counts, theme choice | Your browser (`localStorage`), never sent anywhere |

Rules for every app:

1. Data stays on the device by default.
2. No cookies, no analytics, no ads, no third-party anything.
3. Every app that stores data offers **Export** (download a JSON file) and
   **Delete all data**.
4. The privacy page lists each app's storage, generated from the registry so
   it can't go out of date.

Honest limits: Cloudflare, as the host, sees visitors' IP addresses in order
to deliver pages and stop attacks. We don't turn on any Cloudflare analytics or
logging for these sites. The privacy page says this plainly.

### If an app later needs accounts or sync

Don't build login yourself. In order of preference:

1. **Stay local and add file export/import.** No server at all.
2. **Encrypted sync.** Encrypt the data on the device with a key the server
   never sees, then store the encrypted blob in **Cloudflare D1/KV/R2** behind
   a small Worker. The server can't read it.
3. **Accounts, if truly needed.** Use passkeys (WebAuthn) or **Cloudflare
   Access** (free for up to 50 users) for personal-only apps. Never store
   passwords.

Any of these would add server code to that one app only, with its own decision
record, privacy-page entry and least-privilege token update. They could also
cost money, so I'd flag that first.

### Repository and supply chain

- No secrets in the repo. Cloudflare credentials live only in **GitHub
  Actions secrets**.
- The Cloudflare API token has only **Workers Scripts: Edit** (your account)
  and **Workers Routes: Edit** (only the `shkriuss.app` zone).
- GitHub Actions are pinned to exact commit SHAs, workflows start with no
  permissions and ask only for what each job needs, and checkout doesn't keep
  credentials.
- pnpm blocks dependency install scripts unless they're allow-listed, and
  waits 1 day before installing newly published packages. Dependabot waits
  3 days before proposing an update.
- `SECURITY.md` explains how to report a problem.

---

## 5. Quality gates (all run in GitHub Actions on every pull request)

| Gate             | Tool                                                   | Fails when…                                                                       |
| ---------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Formatting       | Prettier                                               | any file isn't formatted                                                          |
| Linting          | ESLint (TypeScript, Astro, jsx-a11y rules)             | code or accessibility lint errors                                                 |
| Type checking    | `astro check` + `tsc`                                  | type errors                                                                       |
| Unit tests       | Vitest                                                 | a test fails (storage, registry, headers, generator, app logic)                   |
| Build            | Astro                                                  | any site fails to build                                                           |
| CSP safety       | build test                                             | inline script or style found in built HTML                                        |
| Size budgets     | `scripts/check-budgets.ts`                             | a page's JS, CSS or HTML (gzipped) exceeds its budget                             |
| End-to-end       | Playwright on `wrangler dev`                           | user flows break (for example, a tally count doesn't persist after reload)        |
| Accessibility    | axe-core, WCAG 2.2 A/AA rules, light **and** dark mode | any violation on any page                                                         |
| Security headers | Playwright                                             | a header is missing, a CSP violation happens, or a request goes to another domain |
| Dependencies     | `pnpm audit --audit-level=high`                        | a known high or critical vulnerability                                            |
| Secrets          | gitleaks                                               | something that looks like a secret is committed                                   |

Shared browser tests in `tests/e2e/` run against **every** site automatically,
so a new app gets accessibility, header and privacy checks without writing any
tests.

Honesty note: automated tools catch only part of all accessibility problems.
Before an app is called "done", I also check it by hand for keyboard-only use,
screen reader labels, zoom to 200%, and reduced motion.

---

## 6. CI/CD (GitHub Actions)

| Workflow              | Runs on                                                                  | What it does                                                                                                |
| --------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `ci.yml`              | every PR and every push to `main`                                        | Runs all the quality gates above. On `main`, if everything passes, it **deploys every site to production**. |
| `preview.yml`         | PR opened or updated                                                     | Deploys a Cloudflare preview of every site and comments the links on the PR.                                |
| `preview-cleanup.yml` | PR closed                                                                | Deletes that PR's previews.                                                                                 |
| `new-app.yml`         | started by hand (a **Run workflow** button in the GitHub app or website) | Runs the generator with the name you type, pushes a branch, and gives you a link to open the PR.            |
| Dependabot            | weekly                                                                   | Proposes grouped dependency updates as PRs. CI must pass before you merge.                                  |

**Branch protection:** on GitHub Free, protected branches and rulesets
**aren't available for private repositories**. Instead:

- production deploys only happen when every check passes on `main` (the deploy
  job depends on the check job);
- all changes go through pull requests with previews.

If you upgrade to GitHub Pro later (about US $4/month), I'll turn on "require
status checks to pass before merging". This is optional.

**CI minutes:** private repos on GitHub Free get 2,000 Actions minutes per
month. I expect each PR push to use about 4 to 6 minutes, and each production
deploy about 3 minutes. That's plenty for personal use. If it ever runs out,
CI pauses until the next month. It never charges you without a payment method.

---

## 7. Documentation

- `CLAUDE.md`: a short root guide for AI assistants and for you. It covers the
  project overview, commands, conventions, architecture rules, how to add an
  app, and what never to do. It links into `docs/`.
- `README.md`: what this is, the live links, and how to make changes from a
  phone.
- `docs/adr/`: short architecture decision records (one per major choice).
- `SECURITY.md`: how to report a vulnerability, plus a summary of the security
  model.
- `docs/adding-an-app.md`: step by step, both "ask Claude" and "run the
  **New app** workflow from your phone".
- `docs/design-system.md`: tokens, components, and how to change the design
  everywhere at once.
- `docs/deployment.md`: how deploys and previews work, and how to roll back.

---

## 8. Roadmap

**Milestone 1: pipeline proven (this PR plus your setup steps)**

- [x] Plan, docs, decision records
- [x] Monorepo, design system, registry, shared Astro config, storage helpers
- [x] Hub with app list and privacy page
- [x] App template + generator, example app **Tally**
- [x] CI quality gates, preview and production deploy workflows
- [ ] You: Cloudflare token + GitHub secret + settings (see the checklist below)
- [ ] First production deploy: `shkriuss.app` and `tally.shkriuss.app` live
- [ ] Verify on your phone: install Tally to your home screen, then use it in
      airplane mode

**Milestone 2: polish and hardening**

- Hand accessibility review of the hub and Tally on a phone (VoiceOver or
  TalkBack).
- Add `security.txt` and an email anti-spoofing DNS setup (needs your
  decision on a contact address).
- Deploy only the apps that changed, if CI time becomes a problem.
- Import-from-file for app data.

**Milestone 3: real apps**

- Add apps one at a time with the generator (for example, `calendar`), each
  with its own small e2e tests.
- If an app needs sync, follow the path in section 4 with a decision record
  first.

---

## 9. Decisions that are yours (I went ahead with the default)

| Decision                           | My default                                                      | Other option                                                                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo visibility                    | **Keep private** (as you asked)                                 | Public would add free GitHub secret scanning with push protection, code scanning, branch protection, and unlimited CI minutes. The code has no secrets, so this is safe if you're comfortable sharing it. |
| GitHub plan                        | **Free**                                                        | Pro (~$4/month) adds branch protection for private repos.                                                                                                                                                 |
| Example app                        | **Tally** (tap to count things, saved on your device)           | Any other small app.                                                                                                                                                                                      |
| Brand name on the hub              | **"shkriuss"**                                                  | Any name. It's one line in the registry.                                                                                                                                                                  |
| Public contact on the privacy page | **None for now**                                                | Add an email address later for privacy and security questions.                                                                                                                                            |
| PR preview links                   | **Public but unlisted** (`*.workers.dev`, not indexed)          | Lock them behind Cloudflare Access login (free, more setup).                                                                                                                                              |
| Theme                              | **Follows your device**, with a manual light/dark/system switch | —                                                                                                                                                                                                         |

## 10. Where your request conflicts with best practice

1. **Private repo on GitHub Free.** You lose branch protection, secret
   scanning and push protection. I added free replacements (gitleaks,
   Dependabot, `pnpm audit`, deploys gated on checks), but making the repo
   public is the stronger option if you're comfortable with it.
2. **"WCAG 2.2 AA" can't be proven by tools alone.** Automated checks catch
   only some issues, so I also do manual checks (see section 5).
3. **"No third parties" vs hosting.** Cloudflare necessarily processes visitor
   IP addresses to serve pages. The privacy page says so honestly instead of
   claiming "zero data".
4. **Local-only data has a downside.** If you clear your browser data or lose
   your phone, app data is gone. Every app gets **Export** so you can keep
   backups.

---

## 11. Your checklist (everything you need to do)

These are written for a phone or tablet browser. They're repeated with full
detail in my status message.

1. **Create the Cloudflare API token** (Workers Scripts: Edit + Workers
   Routes: Edit on shkriuss.app only).
2. **Save it in GitHub** as the Actions secret `CLOUDFLARE_API_TOKEN`.
3. **Turn on Dependabot alerts and security updates** in the GitHub repo
   settings.
4. **Merge the first pull request.** That triggers the first production
   deploy.
5. **Check the two sites on your phone** and tell me what you see.
6. _(Optional)_ Decide on the items in section 9.
