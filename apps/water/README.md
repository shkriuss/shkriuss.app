# Water

Drink enough water each day. Lives at <https://water.shkriuss.app>.

- `src/lib/water.ts`: the rules as plain functions, with unit tests next to
  them (`water.test.ts`). Two lists, saved on the device and synced
  separately:
  - drinks (`shkriuss:water`): how much, on which day, at what time. Amounts
    are always saved in millilitres, and shown in millilitres or US fluid
    ounces. Drinks older than a year are let go (`pruneDrinks`), and a day
    can have up to 40;
  - settings (`shkriuss:water-settings`): the units, the daily goal, the
    glass and bottle sizes (the two quick buttons) and the reminders. Only
    the ones ever changed are saved, so a new device has nothing that could
    win over another device's settings when they first sync. The rest are
    round numbers in the units in use: 2,000 ml, 250 ml and 500 ml, or 64,
    8 and 16 fl oz.
- History compares every day with today's goal. "Days in a row" counts days
  the goal was reached, up to today; today doesn't break it while the day
  isn't over.
- In fl oz, each drink shows to a tenth of an ounce but is saved rounded to
  whole millilitres, and that adds up: five 20 fl oz bottles are 2,955 ml,
  while 100 fl oz is 2,957 ml. So a day's drinks are added up as they're
  shown (`totalOn`): five 20 fl oz bottles make 100 fl oz and reach a 100 fl
  oz goal. In millilitres they're still 2 ml short, so a day counts as
  reached if it is in either unit (`reachedOn`): switching units can't undo
  a day, or the streak. "Goal reached", the streak, the history and the
  reminders all use that one rule.
- `src/scripts/reminders.ts`: reminders to drink, from a time, every so often,
  until a time. Shown while Water is open, and, if "Also remind me when Water
  is closed" is on, sent by the shared notification service
  ([ADR 0009](../../docs/adr/0009-push-notifications.md)). Once the day's
  goal is reached there are no more that day: the schedule is uploaded again
  after every drink, starting tomorrow. With sync on, reminder settings are
  the same on all devices; each device uploads its own schedule. So drinks
  added on another device only count for this device's reminders once Water
  opens here and syncs: until then, its notification service keeps sending
  them, also after the goal was reached elsewhere (the page says so).
- `src/scripts/water.ts`: connects the page to those rules. "Other amount"
  adds any amount, earlier today or yesterday. Today's drinks, and
  yesterday's (under "Yesterday's drinks", which opens when one is added
  there), each have Remove, so a drink added to yesterday by mistake, or
  logged just before midnight, can be taken back (audit 7 F1-4). Older days
  show only their totals.
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for a drink and a day of the last 7.
- `src/worker.ts`: runs the shared notification and sync servers
  ([ADR 0010](../../docs/adr/0010-account-and-sync.md)). Drinks are only
  added or removed, never changed, so they never conflict; for each setting,
  the newest change wins. While sync is on, letting go of a drink deletes it
  on every device, so a phone whose clock is set far ahead must not decide
  which drinks are a year old: Water counts the year back from the sync
  server's clock at the last sync, if that's earlier than the phone's
  (`trustedNow` in `@shkriuss/sync`), and lets nothing go until it knows it.
  With sync off, it counts from the phone's clock, so drinks still go after
  a year, however long sync stays off.
- `e2e/`: browser tests (`helpers.ts` is shared by them). The shared
  accessibility, security, offline and sync checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
