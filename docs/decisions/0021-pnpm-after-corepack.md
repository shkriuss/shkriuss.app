# ADR 0021: pnpm after Corepack

- **Status:** Proposed
- **Date:** 2026-10-10

## Context

pnpm comes through Corepack, which installs the version that `packageManager` in the root `package.json` pins and checks what it downloads against the SHA-512 there ([ADR 0009](0009-stay-on-pnpm-11.md)). CI, the cloud-session hook (`.claude/hooks/session-start.sh`) and the README run `corepack enable pnpm` for that, the deploy jobs included, so that the pnpm that installs every dependency, and Wrangler, is the one that the hash covers.

Corepack ships with Node.js up to version 24. Node.js 25 and later ship none: on them, `corepack enable pnpm` fails, and nothing checks pnpm against `packageManager` unless Corepack is installed first.

The audit of 2026-10-10 (CI-09) found the docs saying "Node.js 22.18 or later", while `.node-version`, which CI and the deployed builds use, says 24, and `engines.node` says `>=22.18.0`; cloud sessions ran Node.js 22 (22.22.0, with Corepack 0.34.0). By the release schedule that the audit fetched from nodejs/Release that day, Node.js 24 is the active LTS until 2026-10-20 and in maintenance until 2028-04-30; 22 is in maintenance until 2027-04-30; 26 becomes LTS on 2026-10-28. The weekly freshness check warns before Node.js 24's end of life, not before the day `.node-version` moves past it, when Corepack goes missing. On the same day, pnpm 11.28.5 was the newest 11.x and `latest` was 12.11.2, as pnpm's own notice at install said.

## Decision

1. **Node.js 24 for now.** `.node-version` stays at 24 while Node.js supports it; `engines.node` keeps 22.18 as the floor. `CLAUDE.md` and the README say both, instead of "22.18 or later".
2. **Corepack from npm, once Node.js ships none.** When `.node-version` moves past 24, CI and the cloud-session hook install Corepack itself before enabling pnpm, pinned by version: `npm install -g corepack@<version>`, in `ci.yml` wherever `corepack enable pnpm` runs and in `session-start.sh`, with the version chosen as dependencies are ([ADR 0007](0007-security-baseline.md): at least 3 days old) and updated in pull requests of its own. The SHA-512 in `packageManager` then keeps being what checks pnpm. Contributors on such a Node.js do the same; the README says so when it comes.
3. **The pnpm major stays ADR 0009's question.** Its revisit, due by the end of Phase 1, is due now; it decides whether and when pnpm 12 comes, and this ADR does not depend on it: pnpm 12 through Corepack is checked by the same hash for its npm wrapper, as ADR 0009 describes.

## Consequences

- One more pinned tool to keep fresh, from the day it is needed; the freshness check then covers Corepack as it covers pnpm.
- Nothing changes today: Node.js 24 ships Corepack. The path is recorded now, so that the move past 24 is neither stopped by a missing tool nor made with a weaker one.
- `npm`, which installs Corepack, comes with Node.js and is trusted as Node.js is: the one install that no `packageManager` hash covers is Corepack's own, from the registry, by version.

## Alternatives considered

- **`pnpm/action-setup`** in CI, with `standalone: true`: it reads `packageManager` but does not verify the SHA-512 there, so the pnpm that installs every dependency would be checked by nothing but the registry. It also does nothing for cloud sessions and contributors. Rejected.
- **Stay on Node.js 24 until its end of life** (2028-04-30): the move past it only becomes more urgent; this ADR is the path for it, whenever it is taken.
- **Vendor Corepack, or build it from a git tag:** more to maintain than a pinned install of a package that the Node.js project publishes.
- **A `packageManager` hash check of our own,** downloading pnpm and comparing: Corepack's one job, written again.
