# Reminders

Get reminded at the right time, once or again and again. Lives at
<https://reminders.shkriuss.app>.

- `src/lib/reminders.ts`: the rules as plain functions, with unit tests next
  to them (`reminders.test.ts`). A reminder (`shkriuss:reminders`) is some
  text, a day and a time, and how often it repeats: never, every day, every
  weekday (Monday to Friday), every week, month or year. Times are
  "floating" like Calendar's: 9:00 stays 9:00 in another time zone. Monthly
  ones on the 31st skip shorter months, and 29 February comes round only in
  leap years, the same as Calendar and the notification service.
  - One that doesn't repeat can be ticked done, and once its time has passed
    it's "Overdue" until it is, with "In 1 hour" and "Tomorrow" to put it
    off. Done ones are kept under "Done" until cleared.
  - One that repeats has no tick box: it moves on to its next time
    (`nextTime`). The list groups reminders by their next time: today,
    tomorrow or later.
- `src/scripts/notify.ts`: notifications while Reminders is open, and, if
  "Also remind me when Reminders is closed" is on, through the shared
  notification service ([ADR 0009](../../docs/adr/0009-push-notifications.md)).
  "Every weekday" is sent as a weekly reminder for each day from Monday to
  Friday.
- `src/scripts/reminders.ts`: connects the page to those rules. The list is
  brought up to date every few seconds, as reminders become overdue or move
  on; it's drawn again only when what it shows changes, so keyboard focus and
  screen readers aren't disturbed every minute.
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for a group and a reminder; changing one is a
  dialog.
- `src/worker.ts`: runs the shared notification and sync servers
  ([ADR 0010](../../docs/adr/0010-account-and-sync.md)). With sync on, the
  newest change to each reminder wins; one changed on two devices at once is
  kept in both versions. Each device uploads its own notification schedule.
- `e2e/`: browser tests (`helpers.ts` is shared by them). The shared
  accessibility, security, offline and sync checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
