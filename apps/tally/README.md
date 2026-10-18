# Tally

Count anything with a tap. Lives at <https://tally.shkriuss.app>.

This is the example app: it shows the patterns every app should follow.

- `src/lib/counters.ts`: the app's rules as plain functions, with unit tests
  next to them (`counters.test.ts`).
- `src/scripts/tally.ts`: connects the page to those rules and saves data
  on the device with `@shkriuss/storage`.
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  A `<template>` holds the markup for one counter, which the script copies
  (no HTML strings, so it works with the strict security policy).
- `e2e/tally.spec.ts`: browser tests for Tally. The shared accessibility,
  security and offline checks in `tests/e2e/` run automatically too.
- Sync between devices (optional): `src/worker.ts` runs the shared sync
  server, and the page script describes which data syncs (the counters).
  When a counter is changed on two devices before they sync, both counts are
  kept: the second becomes its own counter, "… (second version)". See
  [ADR 0010](../../docs/adr/0010-account-and-sync.md) and `e2e/sync.spec.ts`.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
