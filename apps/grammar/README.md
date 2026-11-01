# Grammar

Check your English, American or British. Lives at
<https://grammar.shkriuss.app>.

The checking is done by [Harper](https://github.com/automattic/harper)
(`harper.js`), running on the device as WebAssembly. Nothing is sent anywhere
([ADR 0011](../../docs/adr/0011-on-device-grammar-checking.md)).

- `src/lib/grammar.ts`: the rules as plain functions, with unit tests next to
  them (`grammar.test.ts`): what a problem looks like, how a fix changes the
  text, labels and messages, the dictionary, saved data, and the messages
  between the page and the checker.
- `src/scripts/checker.worker.ts`: the checker, in a web worker so the page
  never freezes. It loads Harper (a WebAssembly file of about 20 MB, about
  8 MB compressed; Cloudflare serves files up to 25 MiB, see ADR 0011),
  checks text, and sends back plain copies of what it finds. It handles the
  page's messages one at a time, in order; if it stops working after it
  started, the page starts it again (three times at most).
  `checker.worker.test.ts` runs it with the real Harper.
- `src/scripts/grammar.ts`: the page. Saves the text, the English choice and
  the dictionary on the device with `@shkriuss/storage`, checks a moment
  after typing stops, and applies fixes. On a first visit it starts the
  checker once the offline copy is saved (`offlineCopySaved()`), so the big
  file is downloaded once and then comes from that copy, offline too. The
  checker downloads that file itself first, so when the download doesn't
  finish (the connection dropped), the page says so and offers "Try again",
  instead of blaming the browser (audit 5 G-5); a checker that was
  downloaded but can't start still says updating the browser may help.
- `src/scripts/edit-text.ts` and `src/lib/edit.ts`: a fix, and Deep check's
  "Accept" and "Accept all", change the text as one edit, like typing or
  pasting, so Undo (Ctrl+Z, ⌘Z, or shaking an iPhone) takes it back. Setting
  the text box's value from code would clear its undo history. It uses
  `document.execCommand('insertText')`: old, but the only way that keeps the
  history. Where it doesn't work, the text is set the old way, without undo.
- Sync ([ADR 0010](../../docs/adr/0010-account-and-sync.md)): with sync on,
  the English choice and the dictionary sync between devices
  (`syncedSettings` in `grammar.ts`; the newest change wins). The text never
  does: it isn't one of the synced items, and typing sends nothing.
  `src/worker.ts` runs the shared sync server; `e2e/sync.spec.ts` tests it.
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for one suggestion, one fix and one word.
- `public/licenses/harper.txt`: Harper's licence (Apache 2.0), linked from
  the page.
- `e2e/grammar.spec.ts`: browser tests with the real checker. The shared
  accessibility, security and offline checks in `tests/e2e/` run too.

## Deep check

An optional, more thorough check by an AI model, GECToR Large (by
Grammarly's researchers), also on the device. It's downloaded only when the
person asks (381 MB), then works offline
([ADR 0012](../../docs/adr/0012-deep-check-ai-model.md)).

- `src/lib/sentences.ts`, `bpe.ts`, `gector.ts`, `changes.ts`: the steps, as
  plain functions with unit tests: text → sentences and words → the model's
  word pieces → its labels → corrected words → changes to the text.
- `src/lib/deep-check.ts`: settings, the downloaded files' list
  (`manifest.json`), and the messages between the page and the worker.
- `src/scripts/deep-check.worker.ts`: runs the model with onnxruntime-web, in
  a worker, on up to 4 cores. It tells the page whether files are missing,
  the model didn't start, or it failed while checking (short of memory,
  say), which the page says in those words, not as "couldn't start in this
  browser" (audit 6). `deep-check.worker.test.ts` tests that with a
  stand-in for onnxruntime-web.
- `src/scripts/deep-check.ts`: the page part: download (checking every file's
  SHA-256; a file that arrives damaged is said to be, as it isn't the
  connection: audit 5 F3-10), check (its start is read out, so a screen
  reader doesn't wait in silence: audit 5 G-6), accept or skip changes,
  remove. Removing or updating Deep check while it starts or checks leaves
  "Check my text" working: it stayed busy for good (audit 5 F3-5).
- `scripts/deep-check-files.ts`: runs before every build. Downloads the model
  once into `.cache/` (pinned version, checksum checked), splits it into
  parts Cloudflare can serve, and writes everything to
  `public/on-demand/deep-check/` (not in git).
- `deep-check/`: the model's small data files, as published (see its
  README), and test data made with the tested Python code.
- `e2e/deep-check.spec.ts`: browser tests with the real model, offline too.
- `public/licenses/gector.txt`, `onnxruntime-web.txt`: their licences.
  `src/licenses.test.ts` checks that each names its own rights holder:
  GECToR's carried Harper's "Automattic" notice (audit 5 Z-3).

`"webAssembly": true` in
[`packages/registry/apps.json`](../../packages/registry/apps.json) lets this
app's security policy compile WebAssembly and start its threads; its name,
description, icon and colour are there too.
