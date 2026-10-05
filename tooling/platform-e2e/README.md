# Platform end-to-end tests

A small test app, never deployed, that tests the shared platform in real browsers: Chromium, Firefox and WebKit, at phone and tablet sizes. Like every app, it is built with `@shkriuss/edge` and served by Wrangler with the generated `_headers`, as in production. Apps test their own features; this app tests what the platform promises every app.

It covers workers under Trusted Types ([ADR 0011](../../docs/decisions/0011-worker-trusted-types-policy.md)):

- the app starts its worker and registers its service worker, which runs for the whole app;
- worker scripts are served with the same security headers as the page, and code in a worker or the service worker cannot create another Trusted Types policy;
- the worker policy starts nothing but the app's own worker scripts, and the browser refuses plain strings as worker scripts;
- no script can create another policy, or the worker policy a second time.

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

And the formats of the UI (`@shkriuss/i18n`), with each browser's own Unicode data: English with a German device's regional conventions, and English with the device's clock in a region without English formats.

| Command                                      | What it does                     |
| -------------------------------------------- | -------------------------------- |
| `pnpm --filter @shkriuss/platform-e2e build` | Builds the test app into `dist/` |
| `pnpm --filter @shkriuss/platform-e2e e2e`   | Runs the tests against the build |

`src/main.ts` hands the tests what they need on `window.platform`. The service worker in `src/sw.ts` is built into `/sw.js` by a small plugin in `vite.config.ts`, until `@shkriuss/pwa` builds the real one.
