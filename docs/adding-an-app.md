# Adding a new app

Each app gets its own address (`<slug>.shkriuss.app`), shows up on the hub
automatically, and gets accessibility, security and offline checks without
any extra work.

## Choose the details

| Field           | Example                              | Rules                                                                                                                                                                                   |
| --------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **slug**        | `notes`                              | The address and folder name. 2–30 lowercase letters, digits or single hyphens, starting with a letter. Can't be a reserved word (`www`, `api`, `hub`, …). It can't easily change later. |
| **name**        | `Notes`                              | Shown to people. Up to 30 characters.                                                                                                                                                   |
| **description** | `Quick notes, saved on your device.` | One sentence for the hub card. Up to 160 characters.                                                                                                                                    |
| **icon**        | `note`                               | One of the icons in `packages/ui/src/icons/index.ts`.                                                                                                                                   |
| **color**       | `blue`                               | teal, blue, indigo, violet, pink, red, orange, green or slate.                                                                                                                          |
| **stores**      | `Your notes`                         | What the app saves on the device, in plain words, for the privacy page. Separate several with `;`. The theme choice is always added (every page saves it).                              |

## Option A: ask Claude

Say something like: _"Add a new app called Notes at notes.shkriuss.app: quick
notes saved on my device."_ Claude runs the generator, builds the app, and
opens a pull request.

## Option B: from your phone, with the New app workflow

1. On GitHub, open the repository, then tap **Actions**.
2. In the list of workflows, tap **New app**.
3. Tap **Run workflow**, fill in the form (fields above), and tap the green
   **Run workflow** button.
4. Wait a few minutes (the run installs everything, builds the new app and
   runs the unit tests), then tap the finished run. Its summary has an
   **Open a pull request** link: tap it, then tap **Create pull request**.
5. Wait for the checks (green ticks).
6. When you're happy, tap **Merge pull request**. About half an hour later
   (every check runs again on `main` first, then the deploy) the app is live
   at `https://<slug>.shkriuss.app` and listed on the hub.

The new app starts as a placeholder page. Ask Claude to build the real thing
in that pull request, or in a new one.

## Option C: on a computer

```sh
pnpm new-app notes --name "Notes" --description "Quick notes, saved on your device." \
  --icon note --color blue --stores "Your notes"
pnpm install
pnpm --filter notes dev
```

## What the generator does

1. Copies `templates/app/` to `apps/<slug>/`, replacing `template-app` with
   the slug.
2. Adds the app to `packages/registry/apps.json` with `"status": "live"`,
   `"storage": "device"` and the theme choice in `dataStored` (every page
   saves it, so keep both).
3. Adds a line for the app to the three shared browser tests' tables
   (`tests/e2e/saving.spec.ts`, `keep-focus.spec.ts` and
   `large-text.spec.ts`), as `null` with "New: nothing for this test yet",
   so they don't fail for it. Fill them in as the app grows (see below).
   Then it formats the new files.

That's all: the hub, the privacy page, the browser tests, the build and the
deploy all read from the registry and the `apps/` folder. The hub lists apps
in alphabetical order, so where an entry sits in `apps.json` doesn't matter.

## Building the app

- Put the page in `apps/<slug>/src/pages/index.astro`, inside `<AppShell>`.
- Use components and classes from `@shkriuss/ui` ([design system](design-system.md)).
- Put logic in `src/lib/*.ts` with a unit test next to it (`*.test.ts`).
- Save data with `createStore` from `@shkriuss/storage`, and keep
  `<DataControls />` on the page so people can back up, restore or delete their
  data. Apps whose data is too big for a backup file (like Photos) use
  `<DataControls backup={false}>`, with a sentence inside saying what to do
  instead.
- Data from outside (a backup being restored, a file, another device's
  copy) is untrusted: `createStore`'s `validate` checks its shape, and
  `nestedTooDeep()` from `@shkriuss/storage/nesting` refuses JSON nested
  more than `MAX_NESTING` (64) levels deep before anything walks it.
  Restoring a backup and sync already check that (audit 3 C-1), so an app
  needs it only for files it parses itself.
- For a spreadsheet to download (like Budget's), make the file with
  `csvFile` from `@shkriuss/storage/csv`, which keeps text like "=SUM(…)"
  from running as a formula, starts the file with a byte-order mark (so
  Excel shows letters beyond English as typed), and splits cells by ";"
  where decimals are written with a comma (as spreadsheets there read
  files), and save it with `downloadFile`.
- Saving can fail (storage full, or blocked). Pass what `save()` gives to
  `reportSave()` from `@shkriuss/ui/problem`: it tells the person, in the
  same words as every app, and gives back whether it saved, so the app only
  says "Saved" when it did. After showing a form's errors, put focus on the
  first wrong field with `focusProblem()`, which reads the error out if the
  person pressed Enter in that field. `showFieldProblems()` from
  `@shkriuss/ui/dom` does both for a whole form.
- When the page is drawn again in the background (another tab's `storage`
  event, sync's `onChange`, a new day), draw it with `keepFocus(render, …)`
  from `@shkriuss/ui/keep-focus`, so keyboard focus stays on the same control
  ([design system](design-system.md)). After the person's own change, put
  focus where it makes sense yourself.
- Add browser tests in `apps/<slug>/e2e/`. `apps/tally` is the reference
  example for all of this. To start a test with saved data, use
  `seedStores()` from `tests/e2e/storage.ts` with the app's own version
  constant (like `TASKS_VERSION`), and `readStore()` to check what was
  saved. Test photos come from `tests/e2e/photos.ts`; `paste()` in
  `tests/e2e/clipboard.ts` pastes text the way a person does (cut by a
  box's `maxlength`, unlike `fill()`); `tests/e2e/notifications.ts` fakes
  notifications and runs a small push receiver, for notifications while an
  app is closed.
- Fill in the app's lines in the shared browser tests' tables. Every site
  needs one in each, or the test fails for it (audit 3 J-11), and
  `pnpm new-app` adds them as `null` ("New: nothing for this test yet"):
  `changes` in `tests/e2e/saving.spec.ts` (one tap or entry that saves),
  `cases` in `tests/e2e/keep-focus.spec.ts` (a list that a change in
  another tab draws again) and `cases` in `tests/e2e/large-text.spec.ts`
  (things to put on the page). Leave `null` only where a test can't apply,
  with a comment saying why.
- If the app needs a browser feature (for example keeping the screen on),
  allow it in `astro.config.ts`:
  `defineAppConfig({ slug: 'notes', allowFeatures: ['screen-wake-lock'] })`.

### Changing what an app saves

People keep what an older version saved, and with sync, another device may
still run an older (or newer) version. So when a change saves data in a new
shape (a new field that must be there, a stricter check, a renamed field):

1. Raise the store's `version` in its `createStore` options, and add
   `migrate(data, fromVersion)`, which turns what older versions saved into
   the new shape. Never make `validate` stricter without it.
2. Test it: data saved by the old version (`seedStores()` with the old
   version number) loads, and saves back in the new shape.
3. What happens then: data from a newer version is never saved over. A
   device with an older version keeps it, shows nothing for that store, and
   (with sync) waits until it's updated
   ([ADR 0010](adr/0010-account-and-sync.md)); a backup made by a newer
   version won't restore in an older one. Don't roll back past such a change
   ([deployment](deployment.md#rolling-back)): fix forward instead.

### Syncing settings

Sync works on lists of items, each with a string `id`. Settings (single
values like a unit or a goal) sync the same way: save each one as its own
item, like `{ id: 'unit', unit: 'ml' }`, and only the settings someone
changed are saved. Then two devices changing different settings don't undo
each other. `defineSettings` from `@shkriuss/storage/settings` does the work:
give it the settings' ids and a check for one setting, and it gives
`empty` and `isState` (the store's `fallback` and `validate`), the list for
sync (`fromItems`), and `get` and `set`. Water is the example (`apps/water/src/lib/water.ts`);
Budget, Repairs and Trades use it too.

### Data that belongs to one device

Keys that start with `shkriuss-device:` (the sync state, notification keys,
the account) are left out of backups on purpose. **Delete all data**
(`deleteAll()`) only removes `shkriuss:` keys, so a new feature that keeps
something under `shkriuss-device:` must delete it in the delete handler of
`packages/ui/src/scripts/data-controls.ts` too, as notifications and sync
do.

### Working on a computer

The first `pnpm build` (and `pnpm verify`) downloads Grammar's 361 MB model.
To build everything else without it:
`pnpm -r --filter "./apps/*" --filter "!grammar" build`. `pnpm test:e2e`
then stops at the start, as Grammar has nothing built: test the other sites
with `E2E_SITES=$(ls apps | grep -v '^grammar$' | paste -sd, -) pnpm test:e2e`
(audit 4 J-9).

Each site's local server keeps its data between runs, in
`apps/<slug>/.wrangler/state`. Photos' online-library tests type two wrong
storage codes each run on purpose (in `apps/photos/e2e/online.spec.ts`), and
the server takes only 20 wrong codes an hour from one internet address (on a
computer, every run comes from the same one): after 10 runs in an hour, the
right code is refused too, until the hour is over. Delete
`apps/photos/.wrangler/state` to start afresh.

The app template (`templates/app/`) is linted with everything else, but it's
type-checked and built only once an app is made from it. So after changing a
shared component it uses, try one:
`pnpm new-app scratch --name "Scratch" --description "A test."`,
`pnpm install`, then `pnpm --filter scratch typecheck` and
`pnpm --filter scratch build`. Undo it all before committing: the app's
folder, and its lines in `packages/registry/apps.json`, the three shared
tests and `pnpm-lock.yaml`.

`pnpm --filter <slug> dev` shows the page only: it has no `/api`, so "Turn
on sync", notifications while closed and the online library don't work
there. To try those, build the hub and the app, and run each in
Cloudflare's local runtime the way the browser tests do: the `webServer`
command in `playwright.config.ts`, from each site's folder, on a port of its
own, with its `--var` settings (`HUB_ORIGIN` tells an app where the hub is,
which a local address can't tell; `ACCOUNT_ORIGIN` tells the hub where its
Account page is, for passkeys; `LIBRARY_STORAGE_CODE` unlocks an online
library; `ALLOW_LOCAL_ENDPOINTS:true` lets an app's notifications server
send to a push address on this computer, like the tests' receiver, which
it refuses otherwise). The easiest way to see them working is a browser test:
`E2E_SITES=<slug> pnpm test:e2e apps/<slug>/e2e/sync.spec.ts --headed`.

### Names that are part of the saved data

Some names can't be changed once an app is live, because data saved under
them would no longer be read: the app's slug, a store's `key` (and
`version`, which only goes up), the labels used to derive and seal keys in
`packages/sync` and `packages/crypto` (like `shkriuss sync v1 <app>`), and
the files database's name (`shkriuss-files`). Renaming one is a migration:
read the old name, save under the new one, and test both
(`seedStores()`).

## Notifications while the app is closed (optional)

Apps can send reminders even when they're closed, through the shared
`@shkriuss/push` package ([ADR 0009](adr/0009-push-notifications.md)). Habits
is the simplest example to copy. Ask Claude, or:

1. In `apps.json`, add `"pushNotifications": true` to the app, and a line to
   `dataStored` about the device key (see Calendar's entry).
2. Add `src/worker.ts`:
   `export { default, PushDevice, PushKeys } from '@shkriuss/push/worker';`
   (an app with sync too combines both, like Habits' and Calendar's).
3. In `wrangler.jsonc`, copy Calendar's `main`, `assets.binding`,
   `assets.run_worker_first`, `durable_objects` and `migrations`.
   A unit test checks these match. Migrations run in order, so if the app is
   already live, add the new one after the ones it has (see Habits'), and
   to `APPLIED_MIGRATIONS` in `tests/unit/registry-consistency.test.ts`.
   Never rename, change or reorder one that's live: Cloudflare would refuse
   the deploy.
4. Add `"@shkriuss/push": "workspace:*"` to the app's `package.json`, and
   `"@shkriuss/server": "workspace:*"` too if its Worker combines push and
   sync. Each app with notifications adds its own storage limit on the
   server (40 MB): if `tests/unit/free-plan.test.ts` then fails, the limits
   need lowering first ([ADR 0017](adr/0017-storage-limits.md)).
5. In the app's notifications section, put the status line
   (`<p data-notify-status>Notifications are off.</p>`), the **Turn on
   notifications** button (`data-notify-enable` around a
   `<Button data-action="enable-notifications">`) and `<PushControls />`
   (the "Also remind me when … is closed" switch), as Habits does. The
   shared browser tests check these. In the page script, call
   `mountLocalReminders(document, { app, due, notices, announce })` from
   `@shkriuss/ui/local-reminders`, and its `changed()` after every change.
   `due()` says what's due while the app is open; `notices()` returns the
   notifications for while it's closed: each has a local start time, a
   repeat pattern, minutes before, and the title and text to show. See
   `apps/habits/src/scripts/reminders.ts`.

The privacy page lists the app automatically, and "Delete all data" already
removes the device from the server.

## Keeping the page small

Each page's JavaScript must stay under 35 KB gzipped, counting every file
its scripts import before they run (`pnpm check:dist`). A part that's used
now and then, like a form or a dialog, can load after the page, with
`import('./form.ts')`: what loads later isn't counted, and it's in the
offline copy too. Start loading it once the page has nothing else to do,
not when it's tapped: an iPhone raises its keyboard only for a field
focused within the tap, so the form has to be there by then. Repairs'
forms (`later` and `whenIdle` in `apps/repairs/src/scripts/repairs.ts`)
show how, and Tasks' form and list editor load the same way
(`apps/tasks/src/scripts/later.ts`, audit 5 J-2); Calendar's event editor
(`openEditor` in `apps/calendar/src/scripts/calendar.ts`) loads when first
opened (audit 4 J-6).

## Heavy work and WebAssembly (optional)

Work that takes more than a moment (like Grammar's checker) belongs in a web
worker, so the page never freezes. Grammar is the example to copy:

1. Write the worker as `src/scripts/<name>.worker.ts`, and start it from the
   page script with
   `startWorker(url)` from `@shkriuss/ui/worker`, where `url` comes from
   `import url from './<name>.worker.ts?worker&url'`. Workers may only be
   started from the site's own build files (Trusted Types checks this).
2. Keep big libraries out of the page script: import them only in the
   worker, so the page stays within its size budget.
3. Only if the worker runs WebAssembly: add `"webAssembly": true` to the app
   in `apps.json` (its CSP then allows compiling WebAssembly,
   [ADR 0011](adr/0011-on-device-grammar-checking.md)). If the file is big,
   wait for `offlineCopySaved()` from `@shkriuss/ui/service-worker` before
   starting the worker, so it's downloaded once. WebAssembly that runs on
   several cores starts its own workers: allow exactly their script URLs
   with `allowThreadScripts()` inside your worker
   ([ADR 0012](adr/0012-deep-check-ai-model.md)).
4. Very big files that only some people need (like Grammar's Deep check
   model) go in `public/on-demand/`: they're never in the offline copy, and
   the app downloads them only when asked, into a cache of its own (any name
   not starting with `shkriuss-`). Cloudflare serves files of up to 25 MiB,
   so split bigger ones (`pnpm check:dist` checks). Grammar's
   `apps/grammar/scripts/deep-check-files.ts` and
   `apps/grammar/src/scripts/deep-check.ts` show how,
   including checking every file's SHA-256. These files are left out of the
   build that CI saves for deploying, so give the app an
   `on-demand-into-dist` script in `package.json` that puts them back (see
   Grammar's). Without it, they're missing on the live site.

## Sync between devices (optional)

Apps can sync between a person's devices through their optional shkriuss
account, end-to-end encrypted ([ADR 0010](adr/0010-account-and-sync.md)).
Tally is the simplest example to copy. It works for data saved with
`createStore` as a list of items that each have a string `id`. Ask Claude,
or:

1. In `apps.json`, add `"sync": true` to the app, and a line to `dataStored`
   about the synced copy (see Tally's entry).
2. Add `src/worker.ts`: `export { default, SyncCopy } from '@shkriuss/sync/worker';`
   (an app with notifications too combines both, like Calendar's).
3. In `wrangler.jsonc`, copy Tally's `main`, `assets.binding`,
   `assets.run_worker_first`, `durable_objects` and `migrations`.
   A unit test checks these match. Add the migration to
   `APPLIED_MIGRATIONS` in `tests/unit/registry-consistency.test.ts` too,
   after any the app already has, as in the notifications steps.
4. Add `"@shkriuss/sync": "workspace:*"` to the app's `package.json`. Each
   app with sync adds its own storage limit on the server (120 MB): if
   `tests/unit/free-plan.test.ts` then fails, the limits need lowering
   first ([ADR 0017](adr/0017-storage-limits.md)).
5. Put `<SyncControls />` above `<DataControls />`. In the page script, call
   `createSync({ app: site.slug, stores: [syncedStore({ store, items, withItems })], onChange })`,
   then `mountSyncControls(…)`, and `sync.changed()` after every save. See
   `apps/tally/src/scripts/tally.ts`.
6. Test the app's rules across devices with `tests/unit/sync-devices.ts`:
   pretend devices, each with its own storage, running the real sync client
   against the real sync server in memory (Budget's and Trades' unit tests
   use it). Browser tests of syncing go in `apps/<slug>/e2e/sync.spec.ts`,
   with the helpers in `tests/e2e/account.ts` (`expectSealed()` checks that
   what goes online is sealed).

**Testing a Worker.** Unit tests run a Worker's real code in memory, with
the fakes in `@shkriuss/server/testing`: `memoryNamespace()` makes a Durable
Object namespace whose objects keep their storage in a `Map` (and wakes due
alarms when a test asks), `memoryState()` makes one object's state, and
`MemoryStorage` its storage. `memorySync()` from `@shkriuss/sync/testing` is
a whole sync server built that way (`withFiles` is the sync Worker with
photos on), and `memoryLibrary()` and `MemoryBucket` (an R2 bucket in a
`Map`) in `packages/library/src/testing.ts` do the same for an online
library. The packages' own `*.test.ts` files show each in use;
`tests/unit/sync-devices.ts` (above) builds on `memorySync()`.

**An online library** like Photos' (big files in R2, [ADR 0016](adr/0016-online-photo-library.md))
needs more: `"library": true` in `apps.json`; an R2 bucket named
`shkriuss-<slug>` (`scripts/buckets.ts` makes it at the next deploy); the
app's `deploy:production` script set to `node ../../scripts/deploy.ts`, as
in `apps/photos/package.json`; and a storage code secret
`<SLUG>_STORAGE_CODE` in the `production` environment, which must also be
added to the deploy step's `env:` in `.github/workflows/ci.yml` (only
`PHOTOS_STORAGE_CODE` is there now). If one is missing, the deploy only
warns, and the library stays locked. The 1 TB limit is per app, so each
library adds up to about $15 a month to the bill's ceiling
([deployment](deployment.md)).

The privacy page and the Account page's list of apps that sync include the
app automatically. When an item is changed on two devices before they sync,
the newest change wins, unless the store passes `conflictCopy` to keep both
versions, as Calendar, Meals, Notes, Reminders, Shelf and Tally do (Tally
is the simplest: see `COUNTER_SYNC` in `src/lib/counters.ts`, which also
keeps both when the two devices counted to the same number, with
`keepSame`, a rule for which values are events). Moving to a
new account key (after a lost device) needs no extra code. A form for
changing an item can stay open while a sync brings another device's change
to that item: on Save, put on only what the person changed, with
`withEdits` from `@shkriuss/sync/edits` (see `editedTask` in Tasks).

## Listing it on the hub

A new app is listed on the hub as soon as it's merged (`"status": "live"`).
To deploy an app without listing it, for example while it's still a
placeholder, change its `"status"` in `apps.json` to `"hidden"`, and back to
`"live"` when it's ready.

## Removing an app

People's data for an app is on their own devices, under the app's address,
and with sync, notifications or an online library on its servers too. Once
the app is gone, they can't open it any more to back up or to delete what's
online. So remove an app in steps (ask Claude for each):

1. **Tell people first.** Ship a version that says when the app goes away
   and asks them to tap **Download backup** and, if sync is on, **Delete
   the online copy**. Leave it up for a few weeks.
2. **If it has servers** (`sync`, `pushNotifications` or `library` in
   `apps.json`): in one pull request, take those out of `apps.json` and the
   app, and in `wrangler.jsonc` remove its `durable_objects` and add a last
   migration that deletes their classes (`"deleted_classes"`; Cloudflare's
   [guide](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/)).
   When it deploys, everything its servers kept is deleted.
3. **Remove it:** delete `apps/<slug>/` and its entry in `apps.json` in one
   pull request. After merging, delete the Worker in the Cloudflare
   dashboard (**Workers & Pages** → the app → **Settings** → **Delete**).
   That removes its address too.
4. **An app with an online library** (see below) also has an R2 bucket,
   `shkriuss-<slug>`, and a storage code secret in GitHub
   (`<SLUG>_STORAGE_CODE`). Delete the bucket in the dashboard (**R2** → the
   bucket → **Settings**; R2 asks you to empty it first) and the secret in
   GitHub (**Settings** → **Environments** → `production`: it's a secret of
   that environment, not of the repository).
