# ADR 0016: The frontend stack as built

- **Status:** Proposed
- **Date:** 2026-10-08

## Context

[ADR 0005](0005-frontend-stack.md) chose the frontend stack before any app was built. Two of its rows no longer match the code, besides those that [ADR 0012](0012-typed-messages.md) (messages) and [ADR 0013](0013-routes-in-code.md) (routes) superseded:

- **Zod** was never used. `@shkriuss/data` checks records and backups against its own schemas, which also describe the stores, migrations and merges, so a second schema language would only repeat them.
- **The React Compiler** is on hold ([roadmap](../roadmap.md), "Waiting"). Its Babel plugin runs only under Babel 7, which needs a release of `semver` that pnpm's trust policy refuses ([ADR 0007](0007-security-baseline.md)).

## Decision

The stack, as of 2026-10. The repository uses the latest stable releases, pinned once in the pnpm catalog.

| Concern         | Choice                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------ |
| Language        | TypeScript 7 (native compiler), strictest settings                                         |
| UI              | React 19, without the React Compiler until it runs on Babel 8 or natively                  |
| Build           | Vite 8                                                                                     |
| Routing         | TanStack Router, routes declared in code (ADR 0013)                                        |
| Components      | React Aria Components, wrapped in `@shkriuss/ui`                                           |
| Styling         | Tailwind CSS 4 with shared design tokens                                                   |
| Local database  | Dexie (IndexedDB), only inside `@shkriuss/data`                                            |
| Validation      | The schemas of `@shkriuss/data`; no schema library                                         |
| Text            | Typed message modules of `@shkriuss/i18n` (ADR 0012)                                       |
| Offline         | Our own service worker in `@shkriuss/pwa` (no Workbox)                                     |
| WebAssembly     | Only for an app that declares it, in its workers (ADR 0014)                                |
| Lint and format | Oxlint with type-aware rules; Prettier                                                     |
| Monorepo        | pnpm workspaces with catalogs, on pnpm 11 ([ADR 0009](0009-stay-on-pnpm-11.md)); Turborepo |

## Consequences

- ADR 0005's reasoning stands; only its table changes.
- A schema library would now be a new dependency, with the review that every dependency gets.
- Apps build without the React Compiler, which costs re-renders, not correctness. Turning it on later needs no new ADR: this one already expects it.

## Alternatives considered

- **Keep ADR 0005 as it is:** an accepted ADR is binding, and two of its rows ask for what the code does not do.
- **Add Zod now, to match ADR 0005:** a second way to describe what `@shkriuss/data`'s schemas already describe, with a runtime cost in every app.
