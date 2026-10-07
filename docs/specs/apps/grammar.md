# Grammar

- **Status:** accepted, 2026-10-06 (Phase 2)
- **App id:** `grammar`, at `https://grammar.shkriuss.app`. Permanent (`CLAUDE.md`, product rule 3).
- **Builds on:** [ADR 0014](../../decisions/0014-webassembly.md) (WebAssembly), the [app template without data](../../../tooling/app-template-no-data/README.md), and Harper (`harper.js`, Apache-2.0).
- **Implemented by:** `apps/grammar`

Checks English text for mistakes in grammar, spelling, punctuation and word choice, and suggests fixes. It runs on the device and works offline. It keeps nothing: the text stays only while the app is open.

## 1. Screens

| Screen   | Address     | What it shows and does                                               |
| -------- | ----------- | -------------------------------------------------------------------- |
| Check    | `/`         | A field for the text, and the mistakes found in it, with fixes.      |
| Settings | `/settings` | Installing, and About. No storage or backups: the app keeps nothing. |

**On the Check screen:**

- **The field** takes text that the user types or pastes, up to 20,000 characters. The browser's own spelling checker is off in it, as some browsers send text to a server to check it.
- **Checking** starts as soon as the checker is ready, and again half a second after the user stops typing. It runs in a worker, so typing never waits for it.
- **Getting ready:** "Getting the checker ready…" shows until the checker has started. On the first visit, the checker waits until the app has been kept for offline use, so that its 8 MB download happens once; then it starts from that copy.
- **The mistakes** are listed under the field, in the order of the text. Each shows its kind (Spelling, Grammar, Punctuation, …), what is wrong, and the words it is about, quoted from the text. A status says how many there are, or "No mistakes found"; screen readers hear it.
- **Fixes:** each mistake offers Harper's fixes as buttons, such as "Replace with “an”" or "Remove", without repeats. One press changes the text and checks it again. The focus then goes to the next mistake, or to the field when none is left.
- **Show** selects the mistake's words in the field. **Ignore** hides the mistake until the user changes its words.
- **English variety:** American, British, Australian, Canadian or Indian English. It starts from the browser's language (`en-GB` gives British, …), or else American. It is not kept.
- **Copy** puts the whole text on the clipboard, and says so.
- **If the checker cannot start,** for example in a browser without WebAssembly, the screen says so instead of the list.

## 2. Data

None. The app has no database, no backups and no settings of its own. It stores nothing on the device and sends nothing anywhere. The text exists only in the page and in the checker's worker, while the app is open; closing or reloading the app clears it.

## 3. The checker

- **Harper** (`harper.js`, by Automattic) is an open-source English grammar checker, compiled to WebAssembly. It runs in a worker of the app ([ADR 0014](../../decisions/0014-webassembly.md)). Its module, 16 MB (8 MB compressed), comes with the app from its own origin, and the service worker keeps it.
- **What it finds:** what its rules find, by kind: spelling, grammar, agreement, punctuation, capitalization, repetition, word choice, style and others, each with a message, and fixes where it has some.
- **What it is not:** it follows rules and explains each mistake. It never rewrites whole sentences, and misses some mistakes that a person, or an AI, would catch.
- **Updates:** its rules come with the app's updates.

## 4. What else

- **Export formats:** none; Copy puts the text on the clipboard.
- **Privacy label:** no data collected; nothing leaves the device.
- **Browser permissions:** writing to the clipboard (`clipboard-write`), for Copy.
- **Icon:** a capital A with a check mark, white on indigo (`#4338ca`).

## 5. Platform changes that come with it

- **Apps without data:** an app can have no database. Its settings then show installing and About only, and the hub's privacy label says that nothing leaves the device. `create-app` and `pnpm check structure` support it.
- **WebAssembly:** `webAssembly: true` in `app.config.ts` ([ADR 0014](../../decisions/0014-webassembly.md)).

## 6. Tests

- **Unit tests:** Harper's results as the screen shows them (kinds, quoted words, fixes without repeats); a fix applied to the text; the variety from the browser's language.
- **End to end, in every browser,** with the production headers:
  - the checker starts in its worker and finds the mistakes of a sample text;
  - a fix changes the text, and the list follows; Ignore and Show;
  - another variety gives other results ("color" and "colour");
  - Copy, where the browser allows it in tests;
  - nothing is stored: no IndexedDB database, nothing beyond the service worker's own cache;
  - it works offline after the first visit;
  - no accessibility violation in either theme; everything works with the keyboard.
- **On real devices:** the iPhone, the Pixel and the Pixel Tablet: the first visit, offline use, and how fast it checks.

## 7. Not in version 1

Underlines in the text, AI rewriting, other languages, keeping texts, a personal dictionary ("Add word"), checking files, and sharing text into the app from other apps.
