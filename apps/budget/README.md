# Budget

See where your money goes, month by month. Lives at
<https://budget.shkriuss.app>.

- `src/lib/budget.ts`: the rules as plain functions, with unit tests next to
  them (`budget.test.ts`). Three lists, saved on the device and synced
  separately:
  - categories (`shkriuss:budget-categories`): a name and, optionally, a
    limit for each month (the same every month). None to begin with;
    "Add suggested categories" adds eight common ones (`SUGGESTED`).
    Deleting one keeps its expenses: they show under "No category";
  - entries (`shkriuss:budget`): an expense (in a category, or none) or
    income, with an amount, a day and a short note;
  - settings (`shkriuss:budget-settings`): the currency, only for showing
    amounts (nothing is converted), and the monthly reminder. Each is saved
    only once changed (US dollars and no reminder until then), so a new device
    has nothing to win over another's when they first sync.
- A month shows what was spent, earned and is left (`summary`), each
  category's spending against its limit (`byCategory`; over the limit, its
  bar turns red), and the month's entries, the latest first. A new entry
  starts on today, or on the first day of the month being looked at; one
  saved in another month shows that month.
- "Download as a spreadsheet (CSV)" saves every entry (expenses negative).
  Text that a spreadsheet could read as a formula starts with `'`.
- The monthly reminder ("Check your budget") comes on a chosen day, the 1st
  to the 28th or the last day, at a chosen time. The last day is sent as "a
  day before the 1st", so it's right in every month, however long
  (`reminderNotices`).
- `src/scripts/budget.ts`: connects the page to those rules.
  `src/scripts/reminders.ts`: shows the reminder while Budget is open, and
  sends its schedule to the notification service for "Also remind me when
  Budget is closed".
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for a category and an entry; the forms are
  dialogs.
- `src/worker.ts`: runs the shared notification service
  ([ADR 0009](../../docs/adr/0009-push-notifications.md)) and sync server
  ([ADR 0010](../../docs/adr/0010-account-and-sync.md)). The newest change to
  each entry, category and setting wins: an entry changed on two devices at
  once isn't kept twice, which would count it twice.
- `e2e/`: browser tests (`helpers.ts` is shared by them). The shared
  accessibility, security, offline and sync checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
