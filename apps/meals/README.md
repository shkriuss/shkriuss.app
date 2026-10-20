# Meals

Plan your meals for the week, and what to buy for them. Lives at
<https://meals.shkriuss.app>.

- `src/lib/meals.ts`: the rules as plain functions, with unit tests next to
  them (`meals.test.ts`). Three lists, saved on the device and synced
  separately:
  - your meals (`shkriuss:meals`): dishes you make, each with its
    ingredients (one per line) and notes;
  - the plan (`shkriuss:meal-plan`): a name for a day and a meal of the day
    (breakfast, lunch, dinner or snack). A planned meal uses the
    ingredients of your meal with the same name (capitals and accents
    don't matter), so renaming a meal renames it in the plan too
    (`renamePlanned`);
  - shopping (`shkriuss:meal-shopping`): what's ticked off on each week's
    list, and what was added to it by hand. The list itself is made from
    the week's planned meals (`shoppingList`): each ingredient once, with
    how many meals need it. Weeks older than 8 are let go
    (`pruneShopping`).
- `src/scripts/meals.ts`: connects the page to those rules. It shows one
  week at a time, starting on the day weeks start where you are
  (`firstDayOfWeek`). "Copy last week's meals" fills an empty week.
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for a day, a planned meal, a shopping line
  and a meal; the forms are dialogs.
- `src/worker.ts`: runs the shared sync server
  ([ADR 0010](../../docs/adr/0010-account-and-sync.md)). With sync on, the
  newest change to each planned meal and tick wins; a meal changed on two
  devices at once is kept in both versions.
- `e2e/`: browser tests (`helpers.ts` is shared by them). The shared
  accessibility, security, offline and sync checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
