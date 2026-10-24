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
opens a pull request with preview links.

## Option B: from your phone, with the New app workflow

1. On GitHub, open the repository, then tap **Actions**.
2. In the list of workflows, tap **New app**.
3. Tap **Run workflow**, fill in the form (fields above), and tap the green
   **Run workflow** button.
4. Wait about a minute, then tap the finished run. Its summary has an
   **Open a pull request** link: tap it, then tap **Create pull request**.
5. Wait for the checks (green ticks). For preview links, approve **Deploy
   previews** ([how](deployment.md#seeing-a-preview)); the **Preview links**
   comment then appears.
6. When you're happy, tap **Merge pull request**. A few minutes later the app
   is live at `https://<slug>.shkriuss.app` and listed on the hub.

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
2. Adds the app to `packages/registry/apps.json` with `"status": "live"` and
   `"storage": "device"` (change it to `"none"` if the app saves nothing),
   then formats the new files.

That's all: the hub, the privacy page, the browser tests, the build and the
deploy all read from the registry and the `apps/` folder. (One shared test
needs a line once the app saves something; see below.) The hub lists apps in
alphabetical order, so where an entry sits in `apps.json` doesn't matter.

## Building the app

- Put the page in `apps/<slug>/src/pages/index.astro`, inside `<AppShell>`.
- Use components and classes from `@shkriuss/ui` ([design system](design-system.md)).
- Put logic in `src/lib/*.ts` with a unit test next to it (`*.test.ts`).
- Save data with `createStore` from `@shkriuss/storage`, and keep
  `<DataControls />` on the page so people can back up, restore or delete their
  data. Apps whose data is too big for a backup file (like Photos) use
  `<DataControls backup={false}>`, with a sentence inside saying what to do
  instead.
- Saving can fail (storage full, or blocked). Pass what `save()` gives to
  `reportSave()` from `@shkriuss/ui/problem`: it tells the person, in the
  same words as every app, and gives back whether it saved, so the app only
  says "Saved" when it did. After showing a form's errors, put focus on the
  first wrong field with `focusProblem()`, which reads the error out if the
  person pressed Enter in that field. `showFieldProblems()` from
  `@shkriuss/ui/dom` does both for a whole form.
- Add browser tests in `apps/<slug>/e2e/`. `apps/tally` is the reference
  example for all of this. To start a test with saved data, use
  `seedStores()` from `tests/e2e/storage.ts` with the app's own version
  constant (like `TASKS_VERSION`), and `readStore()` to check what was
  saved. Test photos come from `tests/e2e/photos.ts`.
- Once the app saves something, add one line for it to `changes` in
  `tests/e2e/saving.spec.ts`: one tap or entry that saves. Otherwise the
  shared "can't save" test skips the app.
- If the app needs a browser feature (for example keeping the screen on),
  allow it in `astro.config.ts`:
  `defineAppConfig({ slug: 'notes', allowFeatures: ['screen-wake-lock'] })`.

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
   `assets.run_worker_first`, `durable_objects`, `migrations` and `previews`.
   A unit test checks these match. Migrations run in order, so if the app is
   already live, add the new one after the ones it has (see Habits').
4. Add `"@shkriuss/push": "workspace:*"` to the app's `package.json`, and
   `"@shkriuss/server": "workspace:*"` too if its Worker combines push and
   sync.
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
   `scripts/deep-check-files.ts` and `src/scripts/deep-check.ts` show how,
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
   `assets.run_worker_first`, `durable_objects`, `migrations` and `previews`.
   A unit test checks these match.
4. Add `"@shkriuss/sync": "workspace:*"` to the app's `package.json`.
5. Put `<SyncControls />` above `<DataControls />`. In the page script, call
   `createSync({ app: site.slug, stores: [syncedStore({ store, items, withItems })], onChange })`,
   then `mountSyncControls(…)`, and `sync.changed()` after every save. See
   `apps/tally/src/scripts/tally.ts`.

The privacy page and the Account page's list of apps that sync include the
app automatically. When an item is changed on two devices before they sync,
the newest change wins, unless the store passes `conflictCopy` to keep both
versions, as Calendar, Meals, Notes, Reminders, Shelf and Tally do (Tally
is the simplest: see `secondVersion` in `src/lib/counters.ts`). Moving to a
new account key (after a lost device) needs no extra code.

## Listing it on the hub

A new app is listed on the hub as soon as it's merged (`"status": "live"`).
To deploy an app without listing it, for example while it's still a
placeholder, change its `"status"` in `apps.json` to `"hidden"`, and back to
`"live"` when it's ready.

## Removing an app

Delete `apps/<slug>/` and its entry in `apps.json` in one pull request. After
merging, delete the Worker in the Cloudflare dashboard (**Workers & Pages** →
the app → **Settings** → **Delete**). That also removes its address.
