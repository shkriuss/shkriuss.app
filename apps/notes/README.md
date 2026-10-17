# Notes

Write things down. Lives at <https://notes.shkriuss.app>.

- `src/lib/notes.ts`: the rules as plain functions, with unit tests next to
  them (`notes.test.ts`). A note is plain text; its first line is its title.
- `src/scripts/notes.ts`: connects the page to those rules and saves on the
  device with `@shkriuss/storage`. Two views, the list and one note;
  `#note=<id>` in the address opens a note, so the back button works.
  Typing is saved a moment after the last key press, and straight away when
  leaving the note or the page.
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  A `<template>` holds the markup for one note in the list.
- Sync between devices (optional): `src/worker.ts` runs the shared sync
  server. When the same note is changed on two devices before they sync,
  the newest change wins ([ADR 0010](../../docs/adr/0010-account-and-sync.md)).
- `e2e/notes.spec.ts` and `e2e/sync.spec.ts`: browser tests. The shared
  accessibility, security and offline checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
