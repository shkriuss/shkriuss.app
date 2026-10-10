# CLAUDE.md

Instructions for Claude Code and for anyone else changing this repository. Read this file first, then the documents it links to. When a request conflicts with these rules or with an accepted decision record, stop and ask instead of working around it.

## Project

**shkriuss.app** is a hub of small, private, offline-first web apps (installable PWAs).

- Hub: `https://shkriuss.app`. Each app: `https://<id>.shkriuss.app`, for example `notes.shkriuss.app`.
- All user data stays on the user's device. The only way data leaves is a backup file the user exports, encrypted by default. There are no accounts, no sync and no backend.
- Every app is built from the same shared platform in `packages/`, so apps look and behave alike and fixes reach every app at once.

**Current phase: 1 — Platform v1 (local-only).** Phase 0 is complete: the toolchain, repository checks and CI are in place, and a placeholder hub is live on staging and production. In Phase 1, the specs, the platform's packages, the app template, `create-app` and the hub are done. The pilot app, Checklists (`apps/checklists`), is built, and CI deploys every app; testing it on real devices comes next (step 1.5). The first app of Phase 2, Grammar (`apps/grammar`), is built and deployed too, and waits for the same checks. See `docs/roadmap.md`.

## Read first

| Document               | Use it for                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `docs/architecture.md` | How the system fits together                                                                                |
| `docs/threat-model.md` | Security reasoning. Update it when a change adds network use, browser permissions or dependencies           |
| `docs/decisions/`      | Accepted decisions (ADRs). Binding; change one only with a new ADR                                          |
| `docs/roadmap.md`      | Which phase we are in and what comes next                                                                   |
| `docs/specs/`          | Exact formats (data model, backup format) and each app's spec, written before the code that implements them |

## Rules

### Product

1. **Local-only.** Never send user data over the network. No accounts, servers, sync, analytics, telemetry or crash reporting. Changing this requires a new ADR.
2. **Offline.** Every app works fully offline after its first load, but for large files that it keeps on first use, which work offline once used ([ADR 0019](docs/decisions/0019-files-kept-on-first-use.md)).
3. **Permanent names.** Never rename or reuse an app `id` or subdomain.
4. **English UI.** Every user-facing string comes from a message module of `@shkriuss/i18n` ([ADR 0012](docs/decisions/0012-typed-messages.md)); lint refuses text in JSX. Format dates, numbers and lists with its `Intl` formats.

### Security and privacy

1. **No third parties at runtime:** no CDNs, remote fonts, analytics, trackers, embeds, remote images or external scripts. Everything is bundled and served from the app's own origin.
2. **No HTML injection or dynamic code:** never use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `dangerouslySetInnerHTML`, `eval`, `new Function`, string timers or `javascript:` URLs. Render user content as text or React elements, never as HTML.
3. **No inline scripts or styles:** no `<script>` or `<style>` blocks in HTML and no `style` attributes. Avoid React's `style` prop; use classes. The one exception is the import map that `@shkriuss/edge` generates at build time, which the CSP allows by its hash ([ADR 0010](docs/decisions/0010-script-integrity.md)).
4. **Never weaken security headers** (CSP, Trusted Types, Integrity-Policy, COOP/COEP, Permissions-Policy) to make something work. Fix the code, or propose an ADR. Start workers and the service worker only with `@shkriuss/edge/workers`, whose policy is the only Trusted Types policy an app may have; never create another ([ADR 0011](docs/decisions/0011-worker-trusted-types-policy.md)). Only an app that declares `webAssembly` in its `app.config.ts` may compile WebAssembly, and only in its workers ([ADR 0014](docs/decisions/0014-webassembly.md)).
5. **Crypto only through `@shkriuss/backup`** (the `age` format and WebCrypto). Never implement cryptographic primitives. Never log, store or transmit passphrases or user data.
6. **Imported files are hostile:** size-limit, parse, validate against the schema, migrate, preview, then apply in a single transaction.
7. **Dependencies:** prefer the web platform and existing packages. A new runtime dependency needs a justification in the pull request: purpose, size, maintenance status, and a license compatible with AGPL-3.0: one that `tooling/checks/license-policy.json` allows, such as MIT, BSD, ISC or Apache-2.0, or another after the maintainer has reviewed it. Its license text ships in every app's `/licenses.txt`, which the build writes. Material of others in our own files starts with a legal comment, `/*! … */`, that names its source and license.

### Data

1. Apps never access IndexedDB, `localStorage`, Cache Storage or files directly — only through `@shkriuss/data`, `@shkriuss/backup` and `@shkriuss/pwa`; lint refuses those APIs in an app's code.
2. Every record has a permanent id, a schema version, per-field change timestamps and a deletion marker ([ADR 0004](docs/decisions/0004-local-data-and-backups.md)). Deleting writes a tombstone; never hard-delete.
3. Every schema change ships with a migration and tests. Every app must import every backup version it has ever produced; keep those test fixtures forever.

### Structure

1. Create apps only with the `create-app` generator. Apps never import from other apps. Shared code goes into `packages/`, and packages are imported only through their public entry points.
2. Build the UI from `@shkriuss/ui` (based on React Aria). Target WCAG 2.2 AA: keyboard use, screen readers, contrast, reduced motion.

### Quality

1. Every change ships with tests: unit tests for logic; property-based tests for data, merge, migration and backup code; Playwright tests for user flows; a regression test for every bug fix.
2. Never skip, disable or loosen a test, lint rule, type check or budget to get to green. Find and fix the cause.
3. Keep the docs true: architecture changes update `docs/`, and new decisions get an ADR.

## Workflow

- One task → one branch → one small pull request. Never push to `main`.
- Commit messages and PR titles use Conventional Commits, scoped by app or package: `feat(notes): …`, `fix(data): …`, `docs: …`, `chore(deps): …`.
- Before pushing, run `pnpm verify` (see Commands); push only when it passes.
- A PR description says what changed, why, and how it was tested, and lists any new dependency, browser permission or ADR.
- For changes to data, backups, the service worker or security headers: update the spec first, add tests, and run the full end-to-end suite.

**Definition of done:** checks pass locally and in CI; tests cover the change, including failure paths; the app works offline with no CSP or integrity violations; it is accessible; docs and ADRs are updated where behavior or architecture changed.

## Environments

| Environment       | Domains                             | Deployed                               |
| ----------------- | ----------------------------------- | -------------------------------------- |
| Local             | `localhost`                         | dev server                             |
| Staging (private) | `shkriuss.dev`, `<id>.shkriuss.dev` | automatically after a merge to `main`  |
| Production        | `shkriuss.app`, `<id>.shkriuss.app` | the same commit, after manual approval |

Production gets only the apps that are released, as their `app.config.ts` says; a new app is not, until it has been checked on real devices ([ADR 0015](docs/decisions/0015-releasing-apps.md)).

## Commands

Node.js 22.18 or later (CI uses the version in `.node-version`) and pnpm via Corepack (`corepack enable pnpm`). Run everything from the repository root.

| Command                                                       | What it does                                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                                                | Install dependencies (supply-chain rules live in `pnpm-workspace.yaml`)                                                                                 |
| `pnpm format`                                                 | Format every file with Prettier                                                                                                                         |
| `pnpm lint`                                                   | Oxlint with type-aware rules and the security bans                                                                                                      |
| `pnpm typecheck`                                              | TypeScript in every package                                                                                                                             |
| `pnpm test`                                                   | Unit tests (Vitest) in every package                                                                                                                    |
| `pnpm build`                                                  | Build every package that has a build                                                                                                                    |
| `pnpm check`                                                  | Repository checks: manifests, HTML security, runtime licenses, Markdown style, Wrangler configuration, app structure, imports, documentation links      |
| `pnpm create-app <id> --name <name> --description <sentence>` | Create an app from the app template, in `apps/<id>`; with `--no-data`, an app that keeps no data ([`tooling/create-app`](tooling/create-app/README.md)) |
| `pnpm e2e`                                                    | End-to-end tests (Playwright) against the production builds, served with the real headers                                                               |
| `pnpm verify`                                                 | Every check of CI, in order, except the workflow audit and dependency review, which only CI runs — run it before every push                             |
| `pnpm --filter <name> <task>`                                 | Run one task in one package, e.g. `pnpm --filter @shkriuss/checks test`                                                                                 |

The end-to-end tests need Playwright's browsers once: `pnpm --filter @shkriuss/hub exec playwright install chromium firefox webkit`. Claude Code cloud sessions can only use their preinstalled Chromium; there, Firefox and WebKit run in CI.

Project skills in `.claude/skills/`: `adr` (record a decision) and `add-dependency` (evaluate and add a package). Hooks in `.claude/settings.json` format every file Claude edits and install dependencies when a cloud session starts.

## Glossary

- **App id** — permanent lowercase name of an app; also its subdomain.
- **Origin** — scheme plus host, such as `https://notes.shkriuss.app`; the browser's data-isolation boundary.
- **Record** — one stored item, with an id, schema version, per-field timestamps and a tombstone flag.
- **HLC** — hybrid logical clock; a timestamp that orders changes made on different devices.
- **Tombstone** — marker that a record was deleted, kept so an import cannot bring it back.
- **Backup** — an exported file (encrypted `.age` by default) used to restore data or move it between devices.
