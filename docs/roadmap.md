# Roadmap

- **Last updated:** 2026-10-05
- A phase is complete when its exit criteria are met. All work happens in small pull requests.

## Phase 0 — Foundations

**Complete** since 2026-10-04: every exit criterion below is met.

| Step | What                                                                                                                                                                            | Who                                          | Status |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------ |
| 0.1  | Architecture, threat model, decision records, `CLAUDE.md`                                                                                                                       | Claude Code                                  | done   |
| 0.2  | Harden the accounts, domains and repository ([setup checklist](setup-checklist.md))                                                                                             | you                                          | done   |
| 0.3a | Monorepo toolchain (pnpm, Turborepo, TypeScript, Oxlint, Prettier, Vitest), repository checks, CI, Dependabot, Claude Code setup (hooks, project skills, cloud-session startup) | Claude Code                                  | done   |
| 0.3b | Placeholder hub with the full security headers; script-integrity spike ([ADR 0010](decisions/0010-script-integrity.md))                                                         | Claude Code                                  | done   |
| 0.3c | Deploy the hub to staging and production                                                                                                                                        | Claude Code, with Cloudflare access from you | done   |

**Exit criteria:**

- Placeholder pages are live on `shkriuss.dev` (private) and `shkriuss.app`.
- CI is green.
- Production scores A+ on the MDN HTTP Observatory.
- A spike proves that script integrity (SRI and `Integrity-Policy`) and Trusted Types work with the production build.

## Phase 1 — Platform v1 (local-only)

**Current phase.**

| Step | What                                                                                                                                                                                                                                                                           | Status      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 1.1  | Specs: data model and merge rules (`docs/specs/data-model.md`); backup format (`docs/specs/backup-format.md`)                                                                                                                                                                  | done        |
| 1.2  | Packages: `config`, `edge`, `i18n`, `ui` (tokens, core components, light and dark themes), `shell`, `pwa`, `data`, `backup`. Workers and the service worker start through one narrowly scoped Trusted Types policy ([ADR 0011](decisions/0011-worker-trusted-types-policy.md)) | in progress |
| 1.3  | App template, the `create-app` generator, structure checks in CI                                                                                                                                                                                                               | to do       |
| 1.4  | Hub v1: app catalog generated from app configs; install guides for iPhone, Android and desktop; privacy and security pages; `security.txt`                                                                                                                                     | to do       |
| 1.5  | Pilot app (a simple one, chosen together) → staging → real devices → production                                                                                                                                                                                                | to do       |

**Exit criteria:**

- The pilot app is installed on the iPhone, Pixel and Pixel Tablet.
- It works offline and updates safely.
- An encrypted backup moves data between the iPhone and the Pixel with correct merging.

## Phase 2 — Apps, one at a time

For each app:

1. Write a one-page spec: purpose, screens, data schema, export formats, privacy label and browser permissions.
2. Generate it with `create-app`, build it and test it.
3. Release it to staging, check it on real devices, then release it to production.

Anything reusable goes into a shared package first, so every app benefits.

## Later — only when needed

Each item needs its own ADR before work starts.

- **Accounts and end-to-end encrypted sync** with passkeys — see [future/accounts-and-sync.md](future/accounts-and-sync.md). Trigger: moving data between devices by hand becomes a burden, or other people need the apps on several devices.
- **App lock** — Face ID or fingerprint via a passkey; works offline.
- **Notifications** (Web Push) for apps that need reminders.
- **Outside data** (for example weather or news) through a privacy-preserving proxy, so providers never see users' IP addresses.
- **Sharing** between people.
- **Attachments** such as images and files.
