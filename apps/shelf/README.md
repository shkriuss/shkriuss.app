# Shelf

Keep track of what you buy and love: food, clothes, tech, personal care and
anything else, with brands, prices, shops and links. Lives at
<https://shelf.shkriuss.app>.

- `src/lib/items.ts`: the rules as plain functions, with unit tests next to
  them (`items.test.ts`). An item has a name and a category, plus optional
  brand, how you like it (love it, use it, want to try, won't buy again),
  price and currency, shop, size or variant, one link, the day you last
  bought it and notes. Links must be `http://` or `https://` web addresses.
  Saved on the device under `shkriuss:shelf` (data version 1).
- `src/scripts/shelf.ts`: connects the page to those rules and saves with
  `@shkriuss/storage`. Search, filters (category, how you like it, brand)
  and sorting only change what's shown, never what's saved. The brands list
  puts the most loved first; tapping a brand shows just its items.
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for one item and one brand; the form is a
  dialog.
- Sync between devices (optional): `src/worker.ts` runs the shared sync
  server. When the same item is changed on two devices before they sync,
  both versions are kept: the second becomes its own item, named
  "… (second version)" ([ADR 0010](../../docs/adr/0010-account-and-sync.md)).
- `e2e/shelf.spec.ts` and `e2e/sync.spec.ts`: browser tests. The shared
  accessibility, security and offline checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
