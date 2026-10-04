# ADR 0009: Stay on pnpm 11 for now

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

[ADR 0005](0005-frontend-stack.md) says the repository uses the latest stable releases. For pnpm that is version 12, first released on 2026-08-26. pnpm 12 is a rewrite in Rust: its npm package is a small wrapper, and the program itself is a separate executable for each platform.

Contributors and Claude Code cloud sessions get pnpm through Corepack, which installs the version pinned in the `packageManager` field of the root `package.json`. The Corepack that ships with Node.js 22, which cloud sessions use, is version 0.34. It cannot start pnpm 12 and fails with "Cannot find module …/bin/pnpm.cjs". Corepack 0.35 and later can start it, but would have to be installed from npm first. The pnpm 12 executable is then downloaded the first time pnpm runs and checked by pnpm's own code, not by the hash in `packageManager`.

pnpm 11 is still maintained: new 11.x releases ship alongside the 12.x ones.

## Decision

- Use pnpm 11 for now. This is the only exception to "latest stable" in ADR 0005.
- Pin the exact version with its SHA-512 hash in `packageManager`, so Corepack verifies what it downloads. Set it with `corepack use pnpm@<version>`.
- Pick the newest 11.x release that is at least 3 days old, the same rule [ADR 0007](0007-security-baseline.md) sets for dependencies. Only an urgent security fix may skip the wait.

## Consequences

- Contributors, cloud sessions and CI run the same pnpm version: Corepack and the pnpm GitHub Action both read `packageManager`.
- Each pnpm update follows the rules above, in its own pull request.
- We go without pnpm 12's improvements for a while.
- Revisit by the end of Phase 1, or sooner if the Corepack that ships with our Node.js version can start pnpm 12. Before moving, check that the pnpm GitHub Action and Dependabot support it.

## Alternatives considered

- **pnpm 12 now:** every cloud session and machine would need a separately installed Corepack, to run a rewrite released in late August 2026 whose executable the `packageManager` hash does not cover. pnpm 11 does everything we need and is still maintained.
- **The newest 11.x even when it is less than 3 days old:** the package manager runs every install with full access to the machine, so it gets the same release-age delay as any dependency.
