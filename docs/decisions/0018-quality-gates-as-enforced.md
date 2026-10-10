# ADR 0018: Quality gates as CI enforces them

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

[ADR 0008](0008-quality-gates.md) set the checks that every pull request must pass. Most of them run. Some never did:

- **Component tests in Vitest Browser Mode:** the components of `@shkriuss/ui` and `@shkriuss/shell` are tested instead in the platform's test app, `tooling/platform-e2e`, by Playwright in Chromium, Firefox and WebKit, under the production headers.
- **Lighthouse** has never run.
- **The budget of 150 KB of initial JavaScript per app** has never been checked. Checklists' first page loads 177 kB (gzipped). React DOM, Dexie, TanStack Router and React Aria take most of 150 kB before an app's own code: without its settings and backups, Checklists would still load 161 kB.
- **"Turborepo keeps runs limited to what a change affects":** CI runs every task, on every pull request.

Measured on 2026-10-10, the first page's JavaScript, gzipped at level 9:

| Site                      | JavaScript |
| ------------------------- | ---------- |
| Checklists                | 176.9 kB   |
| App template              | 172.6 kB   |
| Grammar (no data)         | 119.1 kB   |
| App template without data | 115.3 kB   |
| The hub                   | 113.8 kB   |

## Decision

1. **The required checks of every pull request.** A failing check blocks the merge.
   1. **Format, lint and types:** Prettier, Oxlint with type-aware rules, and the TypeScript type check.
   2. **Unit and property tests:**
      - unit tests with Vitest;
      - property-based tests with fast-check for data, merge, migration and backup code;
      - at least 90% coverage of lines, branches, functions and statements in every platform package but `@shkriuss/config`, whose Playwright setup is test code that every end-to-end test runs.
   3. **Component tests in real browsers:** the platform's test app, `tooling/platform-e2e`, with Playwright in Chromium, Firefox and WebKit.
   4. **End-to-end tests,** as ADR 0008 sets them:
      - Chromium, Firefox and WebKit, in phone and tablet viewports;
      - the production build, under the production headers;
      - any CSP or integrity violation fails the run;
      - an axe scan of every screen.
   5. **Budgets:** the JavaScript of the first page, gzipped, is at most 150 kB for the hub and for apps without data, and at most 180 kB for apps with data. Each app's build measures it, and fails above, as it fails for a file larger than Cloudflare serves.
   6. **Repository checks:** the app structure, the dependency licenses, the workflow audit (zizmor) and dependency review. CodeQL runs on every pull request too, and becomes a required check in the repository's settings.
2. **Lighthouse is no gate.** The byte budget and the end-to-end tests in phone viewports cover what its lab scores would, more steadily.
3. **CI runs every task on every pull request.** Revisit when a run takes more than 20 minutes.
4. **ADR 0008's further rules stand:**
   - fixtures for every released schema and backup format version, kept forever;
   - real devices before production;
   - a regression test for every bug;
   - flaky tests fixed, never skipped.

## Consequences

- Every gate in this ADR runs: an accepted ADR asks for nothing that CI does not do.
- Apps with data get 30 kB more than ADR 0008 allowed, which the platform's own code needs. Checklists fits, with 3 kB to spare: before its first page grows, its settings and backups load on demand, which wins about 16 kB.
- A gzip budget is a stand-in for what browsers download: Cloudflare compresses with Brotli or zstd, a little smaller. It changes only with the code, so the check never flakes.
- The coverage threshold now covers every platform package with code of its own: six had it, and `@shkriuss/edge` gets it with this ADR.

## Alternatives considered

- **Keep 150 kB for every app:** Checklists would have to drop Dexie or TanStack Router, the platform's database and router.
- **Run Lighthouse in CI:** another browser run per pull request, for scores that vary from run to run on a fast machine.
- **Run only the affected tasks:** it needs remote caching, or change detection across shared packages, for little gain with three apps.
