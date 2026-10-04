# ADR 0002: One public monorepo under AGPL-3.0

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

Many apps must share one structure, one design and one set of fixes. Most of the code will be written with Claude Code, which works best with one consistent codebase and written rules. Users should be able to verify the privacy claims. Public repositories also get free GitHub Actions minutes.

## Decision

- **One repository** for everything — hub, apps, shared packages, tooling, docs and deployment configuration: `shkriuss/shkriuss.app`, public.
- **License:** GNU AGPL-3.0 (see `LICENSE`).
  - Every app links to its source code.
  - Dependencies must have AGPL-compatible licenses: MIT, BSD, ISC and Apache-2.0 are fine; anything else is checked case by case.
- **Tooling:**
  - pnpm workspaces with catalogs, so every dependency has a single version across the repository;
  - Turborepo for cached tasks that run only for what changed.
- **Trunk-based development:**
  - `main` is always deployable;
  - work happens on short-lived branches merged by squash;
  - commit messages and PR titles follow Conventional Commits.
- **Environments** (staging, production) are deployment targets of `main`, not branches or repositories.

## Consequences

- One pull request can change the platform and every app at once, and CI tests everything it affects.
- CI must stay fast as apps are added; this relies on running only the affected tasks.
- No secret may ever live in the code. Secret scanning with push protection guards this.

## Alternatives considered

- **A repository per app:** structures drift and configuration is duplicated. Rejected.
- **A private repository:** loses verifiability and the free CI minutes.
- **Long-lived `staging` and `production` branches:** they drift apart and cause merge conflicts. Rejected.
