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
  never freezes. It loads Harper (a 16 MB WebAssembly file, about 8 MB
  compressed), checks text, and sends back plain copies of what it finds.
- `src/scripts/grammar.ts`: the page. Saves the text, the English choice and
  the dictionary on the device with `@shkriuss/storage`, checks a moment
  after typing stops, and applies fixes. On a first visit it starts the
  checker once the offline copy is saved (`offlineCopySaved()`), so the big
  file is downloaded once and then comes from that copy, offline too.
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for one suggestion, one fix and one word.
- `public/licenses/harper.txt`: Harper's licence (Apache 2.0), linked from
  the page.
- `e2e/grammar.spec.ts`: browser tests with the real checker. The shared
  accessibility, security and offline checks in `tests/e2e/` run too.

`"webAssembly": true` in
[`packages/registry/apps.json`](../../packages/registry/apps.json) lets this
app's security policy compile WebAssembly; its name, description, icon and
colour are there too.
