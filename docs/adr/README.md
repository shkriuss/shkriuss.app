# Architecture decision records

Short notes on the main decisions: what we chose, why, and what we gave up.
Add a new numbered file when a decision changes or a big new one is made
(for example, the first app that needs a server). Don't rewrite old ones;
mark them "Superseded by ADR N" instead.

| #                                                | Decision                                                                        | Status   |
| ------------------------------------------------ | ------------------------------------------------------------------------------- | -------- |
| [0001](0001-static-astro-sites.md)               | Static sites built with Astro, plain TypeScript for interactivity               | Accepted |
| [0002](0002-cloudflare-workers-static-assets.md) | One Cloudflare Worker (static assets) per site, custom domains, Worker Previews | Accepted |
| [0003](0003-monorepo-and-shared-packages.md)     | pnpm monorepo with a registry, design system and shared config                  | Accepted |
| [0004](0004-security-headers.md)                 | Strict CSP with Trusted Types and shared security headers                       | Accepted |
| [0005](0005-pnpm-typescript-versions.md)         | pnpm 10 and TypeScript 6 (not the newest majors, for now)                       | Accepted |
| [0006](0006-local-first-data.md)                 | User data stays on the device                                                   | Accepted |
| [0007](0007-testing-strategy.md)                 | Testing: Vitest, Playwright on wrangler dev, axe, byte budgets                  | Accepted |
| [0008](0008-encrypted-backups.md)                | Backup files locked with a passphrase (PBKDF2 + AES-GCM), restore in every app  | Accepted |
| [0009](0009-push-notifications.md)               | Optional notifications while an app is closed: Web Push from each app's Worker  | Accepted |
| [0010](0010-account-and-sync.md)                 | Optional shkriuss account on the hub (recovery key, passkeys, QR) and app sync  | Accepted |
| [0011](0011-on-device-grammar-checking.md)       | Grammar checking on the device with Harper (WebAssembly in a worker)            | Accepted |
| [0012](0012-deep-check-ai-model.md)              | Deep check: an AI grammar model on the device (GECToR), downloaded on request   | Accepted |

Template: **Context** (the problem), **Decision** (what we do), **Consequences**
(good and bad), **Alternatives** (what we didn't pick and why).
