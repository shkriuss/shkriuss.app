# 0005. pnpm 10 and TypeScript 6

Status: Accepted (2026-10-16)

## Context

On 2026-10-16 the newest majors were pnpm 12 and TypeScript 7 (the new
native compiler). Tooling support lags behind new majors.

## Decision

- **pnpm 10** (still maintained), because **Dependabot supports pnpm only up
  to v10**. Supply-chain settings are explicit in `pnpm-workspace.yaml`:
  `onlyBuiltDependencies` (allow-list for install scripts),
  `strictDepBuilds`, and `minimumReleaseAge: 1440` (1 day).
- **TypeScript 6.0**, because `typescript-eslint` (needs `<6.1`) and
  `@astrojs/check` (needs `^5 || ^6`) don't support TypeScript 7 yet.
- **Node.js 24 LTS** (`.node-version`).

## Consequences

- Dependabot can propose updates for every dependency.
- We miss some newer pnpm defaults (pnpm 11+ turns several safety settings on
  by default). We set the important ones by hand.

## When to revisit

- Move to a newer pnpm when Dependabot's supported-ecosystems page lists it.
- Move to TypeScript 7 when both `typescript-eslint` and `@astrojs/check`
  accept it in their peer dependencies.
- Move to Node 26 after it becomes LTS (late October 2026) and Astro supports
  it.
