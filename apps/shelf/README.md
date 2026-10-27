# Shelf

Keep track of what you buy and love: food, clothes, tech, personal care and
anything else, with brands, prices, shops and links. Lives at
<https://shelf.shkriuss.app>.

- `src/lib/items.ts`: the rules as plain functions, with unit tests next to
  them (`items.test.ts`). An item has a name, plus optional category,
  brand, how you like it (love it, use it, want to try, won't buy again),
  price and currency, shop, size or variant, one link, the day you last
  bought it and notes. A price is read the way the money apps read amounts
  (`parseDecimal` from `@shkriuss/ui/numbers`: "12,50", "1,299.50" in
  English, "1.299,50" in German, any script's digits), kept to the cent, and
  over 1,000,000,000 is said to be too much (audit 5 F3-10). Links must be
  `http://` or `https://` web addresses; a link is kept as typed (trimmed,
  "https://" added), not as the browser would write it, so the form shows it
  as it was written, and one longer than its box takes is said to be too
  long (audit 5 F3-3). A name of flags or other emoji cut for the "(second
  version)" item is cut between whole characters (audit 5 F3-2). Saved on
  the device under `shkriuss:shelf` (data version 1).
- `src/lib/hosts.ts`: the website a link goes to, as people read it, with
  tests (`hosts.test.ts`). Browsers keep a name like "მაღაზია.გე" as
  punycode ("xn--lodaaxko2f.xn--node"); Shelf shows it in its own letters
  when each such part is in one script whose letters don't look like Latin
  ones (Georgian, Chinese, Japanese, Korean). Japanese counts as one script:
  its names mix kanji and kana, with the marks "ー" and "・" (audit 5 F3-4).
  Others, which could pass for another site's name (a Cyrillic "аррӏе" looks
  like "apple"), stay as punycode, as browsers show them.
- `src/lib/categories.ts`: the categories, with tests (`categories.test.ts`).
  Shelf starts with seven; any can be renamed or removed, and you can add
  your own (up to 100). Only those changes are saved, under
  `shkriuss:shelf-categories`, so a new device (which has just the starting
  list) never brings back a removed category when it syncs. An item keeps
  its category's id, or none; one whose category is gone shows none.
- `src/scripts/shelf.ts`: connects the page to those rules and saves with
  `@shkriuss/storage`. Search (in names, brands, shops, sizes, notes and
  category names), filters (category, how you like it, brand) and sorting
  only change what's shown, never what's saved. The brands list puts the
  most loved first; tapping a brand shows just its items. Tapping a
  category opens it to rename or delete it; deleting one moves its items
  to another category, or leaves them without one (if another device
  deletes that category meanwhile, it asks again: audit 4 F3-5). A form
  that can't be saved (the device is full) stays open, saying why, with
  what was typed (audit 4 F3-1). An item deleted on another device while
  its form was open comes back only if something in the form was changed;
  saved as it was, it stays deleted, and the page says so (audit 5 F3-1).
  Text limits count characters as people see them, as Safari's text boxes
  do, so nothing a box lets in is cut (audit 4 F3-4).
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for one item, brand and category; the forms
  are dialogs.
- Sync between devices (optional): `src/worker.ts` runs the shared sync
  server. When the same item is changed on two devices before they sync,
  both versions are kept: the second becomes its own item, named
  "… (second version)" ([ADR 0010](../../docs/adr/0010-account-and-sync.md)).
  For a category changed on both, the newest change wins.
- `e2e/shelf.spec.ts`, `e2e/categories.spec.ts` and `e2e/sync.spec.ts`:
  browser tests. The shared accessibility, security and offline checks in
  `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
