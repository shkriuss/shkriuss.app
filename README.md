# shkriuss.app

Private, offline-first web apps — one hub, many small apps, one shared platform.

- **Hub:** <https://shkriuss.app>
- **Apps:** each at its own address, for example `https://notes.shkriuss.app`
- **Your data stays on your device.** Nothing is sent to a server. Back it up as an encrypted file whenever you like.

> **Status:** Phase 1 — platform v1. The foundations, the platform's packages and the app template are done, and a placeholder hub is live. The pilot app, Checklists, is built, and not deployed yet. See the [roadmap](docs/roadmap.md).

## Principles

- **Local-first.** Every app works fully offline. There are no accounts and no sync: your data leaves your device only in a backup file you export yourself, encrypted by default.
- **Private by default.** No tracking, analytics, cookies or third-party code.
- **One platform.** All apps share the same design, structure, storage, backups and security, so they look and behave alike and every improvement reaches every app.
- **Verifiable.** All source code is public under the AGPL-3.0 license.

## Documentation

| Document                                     | What it covers                                             |
| -------------------------------------------- | ---------------------------------------------------------- |
| [Architecture](docs/architecture.md)         | How the hub, the apps and the shared platform fit together |
| [Threat model](docs/threat-model.md)         | What we protect, from whom, and how                        |
| [Roadmap](docs/roadmap.md)                   | Phases and what comes next                                 |
| [Decision records](docs/decisions/README.md) | Every important decision and why it was made               |
| [Setup checklist](docs/setup-checklist.md)   | One-time GitHub and Cloudflare hardening                   |
| [Security policy](SECURITY.md)               | How to report a vulnerability                              |

## Development

The project is built with [Claude Code](https://claude.com/claude-code). The rules every contributor follows — human or AI — are in [CLAUDE.md](CLAUDE.md).

You need Node.js 22.18 or later and pnpm, which Corepack provides:

```sh
corepack enable pnpm
pnpm install
pnpm --filter @shkriuss/hub exec playwright install chromium firefox webkit   # once
pnpm verify   # format check, lint, type checks, tests, build, repository checks and end-to-end tests
```

`CLAUDE.md` lists the individual commands.

## License

[GNU Affero General Public License, version 3 only](LICENSE) — SPDX identifier `AGPL-3.0-only`.
