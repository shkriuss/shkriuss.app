# ADR 0008: Quality gates and testing

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

The goal is apps that are as close to bug-free as possible, built mostly by an AI coding agent and maintained by one person. Mistakes in data handling or the service worker can destroy user data that exists nowhere else.

## Decision

### Required checks on every pull request

A failing check blocks the merge.

1. **Format, lint and types:** Prettier, Oxlint with type-aware rules, and the TypeScript type check.
2. **Unit tests** (Vitest), plus **property-based tests** (fast-check) for the data, merge, migration and backup code.
3. **Component tests in real browsers:** Vitest Browser Mode in Chromium, Firefox and WebKit.
4. **End-to-end tests** (Playwright):
   - Chromium, Firefox and WebKit, in phone and tablet viewports;
   - run against the production build, served with the production headers;
   - they cover every app's critical flows, starting offline, the update flow, and an encrypted export → import round trip;
   - any CSP or integrity violation fails the run;
   - every screen gets an axe accessibility scan.
5. **Budgets:**
   - initial JavaScript at most 150 KB gzipped per app;
   - Lighthouse performance at least 95;
   - Lighthouse accessibility and best practices at 100.
6. **Repository checks:** the app structure check, the dependency license check, the workflow audit (zizmor), dependency review and CodeQL.

### Further rules

- **Coverage:** at least 90% of lines and branches in `@shkriuss/data` and `@shkriuss/backup`.
- **Backward compatibility:** fixtures for every released schema version and backup format version stay in the repository forever.
- **Real devices:** changes that affect install, offline use, storage or backups are checked before production on the iPhone (Safari tab and installed app), the Pixel (Chrome tab and installed app) and the Pixel Tablet.
- **Bugs:** every fixed bug gets a regression test.
- **Flaky tests** are fixed, never skipped.

## Consequences

- CI grows with the number of apps. Turborepo keeps runs limited to what a change affects.
- Some features take longer to ship. That is the intended trade.

## Alternatives considered

- **Mostly manual testing:** does not scale to many apps. Rejected.
- **Tests only in Chromium:** misses Safari, which matters most here because of the iPhone. Rejected.
