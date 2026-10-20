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
  edit dialog changes the name, days and reminder, ticks the last 2 weeks
  (for days you forgot), and deletes.
- `src/scripts/reminders.ts`: reminders at a habit's time, on planned days
  it isn't done yet. While Habits is open it shows them as notifications.
  With "Also remind me when Habits is closed" on, the shared
  `<PushControls />` uploads them, encrypted, to Habits' notification service
  (`src/worker.ts`, [ADR 0009](../../docs/adr/0009-push-notifications.md)):
  one a week for each planned day. Ticking a habit off uploads them again,
  so it isn't reminded that day. Ticking it off on another device only
  counts once this device opens Habits and syncs. A reminder is part of its
  habit, so it syncs too; each device then uploads it to its own
  notification service (`e2e/sync.spec.ts` checks this).
- Dates come from the shared `@shkriuss/dates` package (also used by
  Calendar): plain "YYYY-MM-DD" days, so time zones and daylight saving can't
  move a check mark.
- Sync between devices (optional): `src/worker.ts` also runs the shared sync
  server ([ADR 0010](../../docs/adr/0010-account-and-sync.md)). A check
  mark's id is the habit plus the date, so ticking the same day on two
  devices is the same check mark, never a conflict. When a habit's name,
  days or reminder change on two devices before they sync, the newest change
  wins
  (a second copy would start with no check marks, so it wouldn't help).
- `e2e/habits.spec.ts`, `e2e/reminders.spec.ts` and `e2e/sync.spec.ts`:
  browser tests. The shared
  accessibility, security and offline checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
