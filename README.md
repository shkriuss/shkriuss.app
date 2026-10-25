# shkriuss.app

Small, private web apps, all in one place.

- **Hub:** <https://shkriuss.app> lists every app.
- **Apps:** each lives on its own address, for example
  <https://tally.shkriuss.app>.

No ads, analytics or trackers, and no account needed. What you save in an app
stays on your device, unless you turn on sync (an optional account, with
everything locked on your devices first). See the
[privacy page](https://shkriuss.app/privacy/).

## How it works (short version)

- This one repository holds the hub, every app, and a shared design system,
  so a design fix made once applies everywhere.
- Every pull request is checked automatically: formatting, code quality,
  types, unit tests, accessibility (WCAG 2.2 AA), security headers, offline
  support, page size and secret scanning. You also get **preview links**.
- Merging a pull request into `main` deploys to Cloudflare automatically.

## Working from a phone or tablet

You never need a computer:

- **Ask Claude** to make a change. It opens a pull request.
- **Review it:** open the pull request on GitHub and check the green ticks.
  To try it first, approve its preview links
  ([how](docs/deployment.md#seeing-a-preview)).
- **Ship it:** tap **Merge pull request**. The sites update about half an
  hour later: every check runs again on `main` first, then the deploy (you
  can watch it under **Actions**).
- **New app:** ask Claude, or use **Actions → New app → Run workflow**
  ([guide](docs/adding-an-app.md)).

## Documentation

| Document                                       | What it covers                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| [docs/PLAN.md](docs/PLAN.md)                   | The plan: technology choices, architecture, roadmap, your checklist |
| [docs/adding-an-app.md](docs/adding-an-app.md) | Creating a new app, step by step                                    |
| [docs/design-system.md](docs/design-system.md) | Colours, components, and changing the look everywhere               |
| [docs/deployment.md](docs/deployment.md)       | Cloudflare, previews, production deploys, rolling back              |
| [docs/quality.md](docs/quality.md)             | Every automatic check and what to do when one fails                 |
| [docs/audit/](docs/audit/)                     | The audit brief, and the prompts for auditing with AI tools         |
| [docs/adr/](docs/adr/)                         | Short records of the main decisions and why                         |
| [SECURITY.md](SECURITY.md)                     | Security model and how to report a problem                          |
| [CLAUDE.md](CLAUDE.md)                         | Rules and commands for AI assistants and developers                 |

## For developers

Node 24 and pnpm 10:

```sh
pnpm install
pnpm --filter hub dev       # or: pnpm --filter tally dev
pnpm verify                 # every check CI runs
```
