# ADR 0013: Routes declared in code

- **Status:** Accepted
- **Date:** 2026-10-06

## Context

[ADR 0005](0005-frontend-stack.md) chose TanStack Router with file-based routes: a generator reads the files in `src/routes/` and writes the route tree. When step 1.3 reached the app template, that generator turned out to depend on Babel 7:

- **The generator:** `@tanstack/router-generator` needs `@tanstack/router-utils`, which needs `babel-dead-code-elimination` and so `@babel/core` 7. The Vite plugin (`@tanstack/router-plugin`) and the command-line tool (`@tanstack/router-cli`) both run it, and the plugin needs `@babel/core` itself, for the code splitting it adds.
- **Babel 7 needs `semver` 6.3.1,** which pnpm's trust policy refuses ([ADR 0007](0007-security-baseline.md)): it was published without provenance after earlier `semver` releases had it. The same keeps the React Compiler waiting ([roadmap](../roadmap.md)).

TanStack Router itself, `@tanstack/react-router`, needs none of this. Its routes declared in code work under the production headers with no CSP violation, as the platform's end-to-end tests show, and the bundle has no `eval` and no `new Function`.

## Decision

1. **Apps declare their routes in code,** with `createRootRoute()`, `createRoute()` and `createRouter()` of `@tanstack/react-router`. There is no route generator, no TanStack build plugin and no Babel.
2. **Routes stay checked:** each app registers its router (`interface Register` of `@tanstack/react-router`), so TypeScript checks every link and navigation against its routes, and a route's params and search against its declaration.
3. **One file per screen** in `src/routes/`, which exports the screen's route; the app's router puts them together. Every app has `/` and `/settings`, which the shell's frame links to.
4. **The shell builds on the router:** `ScreenLink` for links between screens, `Screen` for a screen's heading and the page's title, `NotFound` and `AppError` as the router's defaults, and a frame that gives the focus to each new screen ([`@shkriuss/shell`](../../packages/shell/README.md)).

This replaces the "Routing" row of ADR 0005. The rest of ADR 0005 stands.

## Consequences

- No Babel, no generator and no generated files. The router adds six packages to every app, all MIT: five of TanStack's and `use-sync-external-store`. They add about 26 kB, gzipped, to its entry script.
- A route takes a few lines more than a file-based one: its path, its parent, and its place in the router. No step generates code to keep in sync.
- No automatic code splitting. A large screen can load on demand with `lazyRouteComponent()`, within the rules for chunks of [ADR 0010](0010-script-integrity.md).
- Scroll restoration stays off: it would keep scroll positions in `sessionStorage`, and apps keep nothing in browser storage but through the platform's packages. The router still scrolls to the top on each new screen. It reads `sessionStorage` once when it loads, and writes nothing to it.
- File-based routes can come back with a new ADR once the generator no longer needs Babel 7. Moving would be mechanical, since each screen's route is in a file of its own already.

## Alternatives considered

- **An exception to the trust policy for `semver` 6.3.1:** it would weaken a supply-chain control of ADR 0007 for a few lines per route.
- **A pnpm override that gives Babel `semver` 7:** Babel 7 would run with a major version of `semver` that it is not tested with, and Babel, with its dependencies, would join the build of every app.
- **Waiting** for a generator without Babel 7: it would hold up the app template, and so every app.
- **A generator of our own:** code to write and maintain, to save a few lines per route.
- **React Router:** it checks links against routes only in its framework mode, whose Vite plugin (`@react-router/dev`) needs Babel 7 too.
