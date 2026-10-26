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
  - entries (`shkriuss:budget`): an expense, a refund or income, with an
    amount, a day and a short note. Expenses and refunds are in a category
    (or "No category"). A refund is money back for something bought: it
    comes off its category's spending for its month, and off "Spent" (so a
    refund for last month's shopping can make a month's spending less
    than 0). It shows as "Refund · Groceries", with a plus, like income.
    Refunds came in data version 2 (`ENTRIES_VERSION`): what version 1
    saved reads the same (`migrateEntries`), and a device still on an older
    Budget waits for its update before it syncs, instead of mixing refunds
    into data it can't read;
  - settings (`shkriuss:budget-settings`): the currency, only for showing
    amounts (nothing is converted; an amount typed is kept to the
    currency's own decimals: to the cent, or to the yen, so one that could
    be read two ways, like "1.500" typed in French, 1500 or 1.5, is asked
    again), and the monthly reminder. Each is saved only once changed (US
    dollars and no reminder until then), so a new device has nothing to
    win over another's when they first sync. After a change of currency,
    totals add up each amount as it's shown (three $0.50 coffees are ¥1
    each, and ¥3 spent), and an amount saved with cents stays as it is
    until it's changed in its form (audit 4 F2-5).
- A month shows what was spent, earned and is left (`summary`), each
  category's spending against its limit (`byCategory`; over the limit, its
  bar turns red), and the month's entries, the latest first. Once a
  category has a limit, a line under the totals sets what was spent in the
  categories that have one against their limits added up (`budgetLine`):
  spending without a limit (rent in "Home" with "No limit", or "No
  category") isn't held against them, and is said besides ("$1,500.00
  more spent without a limit"). A new entry
  starts on today, or on the first day of the month being looked at; one
  saved in another month shows that month.
- "Download as a spreadsheet (CSV)" saves every entry (expenses negative;
  income and refunds positive). Text that a spreadsheet could read as a
  formula starts with `'`. The file starts with a byte-order mark, so Excel
  shows text beyond plain English letters (Georgian, "’") as typed. In a
  language that writes decimals with a comma, cells are split by ";" and
  amounts written "12,5", as spreadsheets there read them (audit 4 F2-9).
- Budget keeps up to 6,000 entries (`LIMITS.entries`). Why not more: each
  entry is saved on the device, where a browser keeps about 5 MB for each
  site, and with sync on, sync keeps about as much again to know what
  changed. The test "has room for every entry" fills Budget up with
  realistic entries and checks that it all still fits, on an iPhone too, and
  in the copy that syncs. If a change makes entries bigger, that test fails,
  and the limit has to come down (or the change be made smaller). Only a
  new entry is refused once Budget is full: with more than that (two
  devices' entries put together when sync is turned on), entries can still
  be changed.
- To make room, "Delete a year…" (next to the spreadsheet download) deletes
  every entry of one year (`entryYears`, `removeYear`). It says how many
  that is, and offers the spreadsheet first. With sync on, the entries are
  deleted on the other devices too. Once more than 90% of the 6,000 are
  used, a note at the top says how many are left and points to it
  (`roomNote`).
- The monthly reminder ("Check your budget") comes on a chosen day, the 1st
  to the 28th or the last day, at a chosen time. The last day is sent as "a
  day before the 1st", so it's right in every month, however long
  (`reminderNotices`).
- `src/scripts/budget.ts`: connects the page to those rules.
  `src/scripts/reminders.ts`: shows the reminder while Budget is open, and
  sends its schedule to the notification service for "Also remind me when
  Budget is closed".
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for a category and an entry; the forms and
  "Delete a year" are dialogs.
- `src/worker.ts`: runs the shared notification service
  ([ADR 0009](../../docs/adr/0009-push-notifications.md)) and sync server
  ([ADR 0010](../../docs/adr/0010-account-and-sync.md)). The newest change to
  each entry, category and setting wins: an entry changed on two devices at
  once isn't kept twice, which would count it twice. An entry's or a
  category's form that's open while a sync (or another tab) changes it
  saves only what was changed in the form (`withEdits` from
  `@shkriuss/sync/edits`), so the other change stays.
- `e2e/`: browser tests (`helpers.ts` is shared by them). The shared
  accessibility, security, offline and sync checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
