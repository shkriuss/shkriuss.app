# Habits

Build habits one day at a time. Lives at <https://habits.shkriuss.app>.

- `src/lib/habits.ts`: the rules as plain functions, with unit tests next to
  them (`habits.test.ts`). A habit has a name and the days of the week it's
  planned for (every day to start with). Each day it's done is a check mark,
  saved separately. Streaks count planned days done in a row; today doesn't
  break a streak until the day is over.
- `src/scripts/habits.ts`: connects the page to those rules and saves on the
  device with `@shkriuss/storage` (two stores: `habits` and `habit-checks`).
  It notices when a new day starts while the app is open.
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for one habit and one day of its week. The
  edit dialog changes the name and days, ticks the last 2 weeks (for days
  you forgot), and deletes.
- Dates come from the shared `@shkriuss/dates` package (also used by
  Calendar): plain "YYYY-MM-DD" days, so time zones and daylight saving can't
  move a check mark.
- Sync between devices (optional): `src/worker.ts` runs the shared sync
  server ([ADR 0010](../../docs/adr/0010-account-and-sync.md)). A check
  mark's id is the habit plus the date, so ticking the same day on two
  devices is the same check mark, never a conflict. When a habit's name or
  days change on two devices before they sync, the newest change wins
  (a second copy would start with no check marks, so it wouldn't help).
- `e2e/habits.spec.ts` and `e2e/sync.spec.ts`: browser tests. The shared
  accessibility, security and offline checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
