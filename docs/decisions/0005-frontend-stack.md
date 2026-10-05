# ADR 0005: Frontend stack

- **Status:** Accepted; the row on translations is superseded by [ADR 0012](0012-typed-messages.md)
- **Date:** 2026-10-04

## Context

Many apps need the same structure and look, solid accessibility and long-term maintainability. Most code will be written with Claude Code. Everything must run under the strict security policy in [ADR 0007](0007-security-baseline.md): no `eval`, no inline styles, no HTML injection.

## Decision

Versions are as of 2026-10. The repository always uses the latest stable releases, pinned once in the pnpm catalog.

| Concern         | Choice                                                       |
| --------------- | ------------------------------------------------------------ |
| Language        | TypeScript 7 (native compiler), strictest settings           |
| UI              | React 19 with React Compiler                                 |
| Build           | Vite 8                                                       |
| Routing         | TanStack Router (file-based, type-safe)                      |
| Components      | React Aria Components, wrapped in `@shkriuss/ui`             |
| Styling         | Tailwind CSS 4 with shared design tokens                     |
| Local database  | Dexie (IndexedDB)                                            |
| Validation      | Zod 4, configured `jitless` so it never tries `new Function` |
| Translations    | Paraglide JS; English only at launch                         |
| Offline         | Our own service worker in `@shkriuss/pwa` (no Workbox)       |
| Lint and format | Oxlint with type-aware rules; Prettier                       |
| Monorepo        | pnpm workspaces with catalogs; Turborepo                     |

## Consequences

- React's ecosystem, and React Aria in particular, gives us accessible, internationalized components without building them from scratch.
- TypeScript 7 has no JavaScript API before 7.1. We avoid tools that need it, such as typescript-eslint, or run TypeScript 6 alongside for them.
- Owning the service worker means more code to maintain and test, in exchange for full control of the most security-critical script, and no dependence on Workbox, which is in maintenance mode.
- Libraries that need `eval`, inject `<style>` tags or render HTML cannot be used.

## Alternatives considered

- **Svelte 5, Vue or Solid:** smaller bundles, but a weaker ecosystem of accessible components and less reliable generated code.
- **Workbox or vite-plugin-pwa:** the ecosystem is in flux; vite-plugin-pwa's maintainers are forking Workbox.
- **ESLint with typescript-eslint:** needs the TypeScript 6 API.
- **Biome:** a solid tool, but Oxlint's type-aware rule coverage is more complete.
- **SQLite (WebAssembly):** see [ADR 0004](0004-local-data-and-backups.md).
