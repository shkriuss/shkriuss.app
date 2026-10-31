# Notes

Write things down. Lives at <https://notes.shkriuss.app>.

- `src/lib/notes.ts`: the rules as plain functions, with unit tests next to
  them (`notes.test.ts`). A note has a title and a body, both plain text.
  Data version 2; notes saved by version 1 (one text, its first line the
  title) are split when loaded (`migrateNotes`).
- `src/scripts/notes.ts`: connects the page to those rules and saves on the
  device with `@shkriuss/storage`. Two views, the list (titles only) and
  one note;
  `#note=<id>` in the address opens a note, so the back button works.
  Typing is saved a moment after the last key press, and straight away when
  leaving the note or the page. A new note (made since the page opened)
  left empty goes when it's left, closing the page too (one a closed page
  left behind, never written in, goes the next time Notes opens, ten
  minutes on); any other note that's emptied stays, with its pin, so
  nothing is deleted without asking (audit 5 F3-7). A note deleted on another device while it's being typed in here
  comes back with the typing, even at 2,000 notes (audit 5 F3-8); "Delete
  all data" in another tab of this browser deletes it too, instead of the
  typing putting it back (audit 5 D-2). List titles are cut between whole
  characters: an emoji, a flag, a letter with its accent.
  When the device is full, typing that can't be saved says "Not saved" and
  stays in the box, also through changes saved elsewhere; it's tried again
  with the next typing, and on leaving the note or the page. If it still
  can't be saved when the note is left, the note goes back to what's saved,
  and the page says the typing is gone (audit 4 F3-1). Titles (200) and
  notes (100,000) are limited in characters as people see them, as Safari's
  text boxes count, so nothing a box lets in is cut (audit 4 F3-4).
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  A `<template>` holds the markup for one note in the list.
- Sync between devices (optional): `src/worker.ts` runs the shared sync
  server. When the same note is changed on two devices before they sync,
  both versions are kept: the second becomes its own note, titled
  "… (second version)" ([ADR 0010](../../docs/adr/0010-account-and-sync.md)).
- `e2e/notes.spec.ts` and `e2e/sync.spec.ts`: browser tests. The shared
  accessibility, security and offline checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
