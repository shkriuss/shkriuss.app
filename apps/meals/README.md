# Meals

Plan your meals for the week, and what to buy for them. Lives at
<https://meals.shkriuss.app>.

- `src/lib/meals.ts`: the rules as plain functions, with unit tests next to
  them (`meals.test.ts`). Four lists, saved on the device and synced
  separately:
  - your meals (`shkriuss:meals`): dishes you make, each with its
    ingredients (one per line) and notes. Up to 500 meals, with 600,000
    characters of names, ingredients and notes all together
    (`MAX_MEALS_TEXT`): about 300 meals with a long recipe each. Then the
    form says to shorten the meal or delete some first; a meal kept can
    still be changed, but not made longer;
  - the plan (`shkriuss:meal-plan`): a name for a day and a meal of the day
    (breakfast, lunch, dinner or snack). A planned meal uses the
    ingredients of your meal with the same name (capitals and accents
    don't matter, but the vowel signs of scripts like Hindi or Thai do:
    they're letters; `foldText`), so renaming a meal renames it in the
    plan too (`renamePlanned`). Planned meals more than a year old are let go
    (`prunePlan`), so the plan (2,000 meals at most) doesn't fill up;
  - shopping (`shkriuss:meal-shopping`): what's ticked off on each week's
    list, and what was added to it by hand. The list itself is made from
    the week's planned meals (`shoppingList`): each ingredient once, with
    how many meals need it. Each list is saved under the Monday in its
    week (`shoppingWeek`), so a phone whose weeks start on Monday and a
    tablet whose weeks start on Sunday share it when they sync (version 1
    used each device's own first day; `migrateShopping` moves it). Weeks
    older than 8 are let go (`pruneShopping`). Up to 500 things added by
    hand are kept, all weeks together, ticked or not (`MAX_SHOPPING`):
    about 55 a week over the 9 weeks' lists kept. Then adding one is
    refused, and the list says to remove some first; ticking still works
    (ticks on the planned meals' ingredients don't count), and room comes
    back as old weeks are let go;
  - reminders (`shkriuss:meal-reminders`): for each meal of the day, a time
    to be told what's planned ("Dinner: Lentil soup"), or off. Only the ones
    ever set are saved, so a new device has nothing that could win over
    another device's times when they first sync.

  All of it is saved on the device, where a browser keeps about 5 MB for
  each site, and with sync on, sync keeps about as much again to know what
  changed. The test "has room for everything at its limits" fills every
  limit, at its longest: all the text meals can hold, a full plan and
  everything that can be added by hand. How many ticks and deleted things
  sync remembers depends on use, so for those it takes a generous guess
  (100 ticks a week). It checks that it all still fits, on an iPhone too,
  and in the copy that syncs. If a change makes them bigger, that test
  fails, and a limit has to come down (audit 4 F2-13: the plan held 5,000
  and the lists 2,000 things added by hand, and 500 meals each at every
  limit of their own were 5.5 million characters: more than fits).

- `src/scripts/reminders.ts`: reminders while Meals is open, and, if "Also
  remind me when Meals is closed" is on, through the shared notification
  service ([ADR 0009](../../docs/adr/0009-push-notifications.md)). There's a
  reminder only on days with something planned for that meal. The
  notification service gets the soonest 100 (`MAX_NOTICES`), and the next
  ones each time Meals is opened, or the plan or a reminder time changes.
  With reminders for all four meals of the day and every meal planned, 100
  last 25 days: for a plan made further ahead than that, open Meals at least
  once in 25 days, or the later reminders don't come while it's closed. Why
  not more: they're all encrypted and sent again after each change to the
  plan, and a plan is mostly made a week at a time.
- `src/scripts/meals.ts`: connects the page to those rules. It shows one
  week at a time, starting on the day weeks start where you are
  (`firstDayOfWeek`). "Copy last week's meals" fills an empty week (if
  the plan is too full for all of it, the notice at the top says so).
  Old shopping lists and planned meals are let go when Meals opens and
  at each new day.
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for a day, a planned meal, a shopping line
  and a meal; the forms are dialogs.
- `src/worker.ts`: runs the shared notification and sync servers
  ([ADR 0010](../../docs/adr/0010-account-and-sync.md)). With sync on, the
  newest change to each planned meal, tick and reminder time wins; a meal
  changed on two devices at once is kept in both versions. A meal's or a
  planned meal's form that's open while a sync (or another tab) changes it
  saves only what was changed in the form (`withEdits` from
  `@shkriuss/sync/edits`), so the other change stays. If the meal is
  deleted there, or the planned meal taken off the plan, the form closes
  and says so. While sync is
  on, letting go of old plans and lists deletes them on every device, so a
  phone whose clock is set far ahead mustn't decide what's old: Meals
  counts back from the sync server's clock at the last sync, if that's
  earlier than the phone's (`trustedNow` in `@shkriuss/sync`), as Water
  does.
- `e2e/`: browser tests (`helpers.ts` is shared by them). The shared
  accessibility, security, offline and sync checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
