# Grammar

Checks English text for mistakes in grammar, spelling and punctuation, and suggests fixes, on this device.

- **Address:** `https://grammar.shkriuss.app`, and `https://grammar.shkriuss.dev` for staging.
- **Id:** `grammar`, which never changes: it is the app's subdomain and folder.
- **Made** with `create-app` from the [app template without data](../../tooling/app-template-no-data/README.md), which says what each file is.
- **Spec:** [docs/specs/apps/grammar.md](../../docs/specs/apps/grammar.md). It keeps no data, and compiles WebAssembly in its worker ([ADR 0014](../../docs/decisions/0014-webassembly.md)).

| Command                                 | What it does                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm --filter @shkriuss/grammar dev`   | Development server, without the production headers and the service worker    |
| `pnpm --filter @shkriuss/grammar build` | Production build in `dist/`                                                  |
| `pnpm --filter @shkriuss/grammar test`  | Unit tests, Harper's own results among them                                  |
| `pnpm --filter @shkriuss/grammar e2e`   | End-to-end tests against the build, served by Wrangler with the real headers |

## The checker

[Harper](https://github.com/Automattic/harper) checks the text: its slim WebAssembly module, from `harper.js`, without Typst and without the thesaurus, which only suggests other words for some that are used too often. It runs in `src/features/check/harper.worker.ts`, which the page starts once the service worker keeps the app for offline use, so that the module, 16 MB (8 MB compressed), comes once.

| File in `src/features/check/` | What it is                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Check.tsx`                   | The check screen: the text, its variety of English, Copy, Delete, and the mistakes with fixes                                          |
| `checker.ts`                  | The page's checker: it starts once the app is kept offline, says when it is ready or failed, and checks one text at a time, the latest |
| `draft.ts`                    | The text, its variety, the mistakes ignored, Undo's text and the last check, kept while the page is open                               |
| `worker-check.ts`             | Starts the worker, and sends it each text with a port for the answer                                                                   |
| `harper.worker.ts`            | The worker: Harper's linter, which answers each request in turn                                                                        |
| `harper.ts`                   | Creates the linter, and gives, in its legal comment, the notices of the crates compiled into Harper                                    |
| `lints.ts`                    | Harper's lints as the app's mistakes: their kind, message, place in the text and fixes, each once                                      |
| `protocol.ts`                 | What the page and the worker say to each other, and the checks of it                                                                   |
| `text.ts`                     | A fix applied to the text, Harper's messages as plain text, the words quoted, and what Ignore hides                                    |
| `variety.ts`                  | The variety of English to start with, from the browser's language                                                                      |

## Updating harper.js

The build copies the legal comment of `harper.ts` into `/licenses.txt`: the notices of every Rust crate compiled into Harper's module, which `harper.js`'s own license does not cover. A test fails once `harper.js` changes version, until they are written anew for it, with a checkout of Harper at that version's tag and Rust's `cargo`:

```sh
git clone --depth 1 --branch v<version> https://github.com/Automattic/harper <checkout>
node apps/grammar/scripts/harper-notices.ts <checkout>
```

Each crate's license must be one that `tooling/checks/license-policy.json` allows, or one accepted for Harper's module: MPL-2.0, Unicode-3.0 and Zlib, which the maintainer accepted on 2026-10-07. A test refuses any other, which needs the same review first.
