# Platform end-to-end tests

A small test app, never deployed, that tests the shared platform in real browsers: Chromium, Firefox and WebKit, at phone and tablet sizes. Like every app, it is built with `@shkriuss/edge` and served by Wrangler with the generated `_headers`, as in production. Apps test their own features; this app tests what the platform promises every app.

It covers workers under Trusted Types ([ADR 0011](../../docs/decisions/0011-worker-trusted-types-policy.md)):

- the app starts its worker and registers its service worker, which runs for the whole app;
- worker scripts are served with the same security headers as the page, and code in a worker or the service worker cannot create another Trusted Types policy;
- the worker policy starts nothing but the app's own worker scripts, and the browser refuses plain strings as worker scripts;
- no script can create another policy, or the worker policy a second time.

And WebAssembly in an app that declares it ([ADR 0014](../../docs/decisions/0014-webassembly.md)): a worker compiles `src/add.wasm`, a module of 41 bytes, and runs it; the module is a file of the app, served with its security headers as `application/wasm` and cached by name. The hub's tests check the other side: an app that does not declare it cannot compile any.

And the data layer (`@shkriuss/data`, [data model](../../docs/specs/data-model.md) §3, §6, §7), with two versions of a small app's data in `src/data.ts`:

- records and the device id last across reloads;
- two tabs of the app never issue the same HLC;
- a query observed in one tab follows the changes made in another;
- a newer version of the app upgrades the database, which closes in the older version's tab; loaded again, the older version refuses to open it and leaves it as it is;
- a backup carries the records to another device and to a newer version of the app, and importing it again changes nothing.

And backup files (`@shkriuss/backup`, [backup format](../../docs/specs/backup-format.md) §3–§5), in `src/backups.ts`:

- an encrypted backup, made in the backup worker at work factor 18, carries the records to another device, where a wrong passphrase can be tried again;
- a plain backup carries them too;
- the files that the age command-line tool encrypted, binary and ASCII-armored, read with their passphrase;
- only the backup worker's bundle includes `age-encryption`;
- `/licenses.txt` lists the packages of the page and of its workers, and the notices in files of this repository.

And the app's storage (`appStorage()` of `@shkriuss/pwa`), with the browser's own Storage API: it knows whether the browser keeps its data and how much it stores, its usage grows as it stores data, and it asks the browser to keep its data and shows the answer.

And the web app manifest and the icons that `webAppManifest()` of `@shkriuss/pwa` writes: the page links them, the browser loads them under the CSP, and each icon decodes at its size; Chromium reads the manifest without errors, knows the app by its root, and finds nothing that keeps it from installing the app but the test's private window.

And the formats of the UI (`@shkriuss/i18n`), with each browser's own Unicode data: English with a German device's regional conventions, and English with the device's clock in a region without English formats.

And the components of `@shkriuss/ui`, on the page `/ui`, from `src/gallery.tsx`:

- axe finds no accessibility problem, in either theme, and React Aria adds no stylesheet that the CSP would refuse;
- buttons, text fields, switches, checkboxes, links, dialogs, banners and file buttons work with the pointer and the keyboard, and reach screen readers;
- buttons, switches and checkboxes are at least 44 by 44 pixels.

And the shell of `@shkriuss/shell`, on the pages `/shell`, `/shell/archive` and `/shell/settings`, from `src/shell-page.tsx`, whose routes are declared in code as every app's are ([ADR 0013](../../docs/decisions/0013-routes-in-code.md)): a screen of notes from the data layer, an archive and the settings, in the app's frame:

- axe finds no accessibility problem in the frame and its banners, in either theme;
- the frame has its landmarks, and a keyboard user can skip to the screen first;
- links open another screen without loading the page, with the pointer or with Enter, and the browser's back and forward buttons go through the screens; each new screen's heading takes the focus, and the page's title names it; a link that the user opens with a modifier key stays the browser's, as for a new tab; an address that the app does not have shows that the page does not exist, in the frame, with a link to the app;
- the screen follows the notes as they change;
- the update banner offers an update, applies it when the user agrees, and goes away until there is news when the user says later, giving the focus to the screen;
- a screen that fails shows what happened inside the frame, and reloads the app;
- the settings say how much the app stores and whether the browser keeps it, ask the browser to keep it when the user wants, and say so when the browser does not agree;
- the settings make backups of the notes: encrypted with a generated passphrase or the user's own, which the dialog checks first, or plain after a warning; each file is downloaded, or shared through a stand-in for the share sheet, and read back with its passphrase; a backup that the user cancels saves and records nothing, and one started after the dialog was closed never gives way to the earlier one;
- the settings restore a backup from another device: encrypted, after a wrong passphrase, or plain; restoring it again brings nothing, and a backup that the user does not restore changes nothing; a file that is no backup, too large, of a newer version, of another app or damaged is refused with what happened;
- the reminder to back up comes when the app opens or comes back into view, never with a change or a restore: for a first backup, and a week after the last one, with the time that the tests set; its backup takes it away, as does one made in the settings, and "Later" hides it for a day;
- installing: the settings show the browser's prompt, which a stand-in plays as Chromium would, and say when the app is installed, or point to the browser's menu once the prompt is dismissed; in a browser that the tests make one on an iPhone, the settings say how to add the app to the Home Screen, and a banner suggests installing it before anything is entered, but not after, nor from the Home Screen;
- the settings say what the app is and where its data stays, link its source code and security policy in a new tab, and show the licenses of what it includes in a dialog that scrolls from the top.

| Command                                      | What it does                     |
| -------------------------------------------- | -------------------------------- |
| `pnpm --filter @shkriuss/platform-e2e build` | Builds the test app into `dist/` |
| `pnpm --filter @shkriuss/platform-e2e e2e`   | Runs the tests against the build |

`src/main.ts` hands the tests what they need on `window.platform`. The service worker in `src/sw.ts` is built into `/sw.js` by a small plugin in `vite.config.ts`: a stand-in that answers the tests' messages, which the real service worker ignores. `tooling/pwa-e2e` tests the real one, from `@shkriuss/pwa`.
