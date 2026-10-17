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
| **stores**      | `Your notes`                         | What the app saves on the device, in plain words. This goes on the privacy page. Leave it empty if the app saves nothing.                                                               |

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
5. Wait for the checks (green ticks) and the **Preview links** comment.
6. When you're happy, tap **Merge pull request**. A few minutes later the app
   is live at `https://<slug>.shkriuss.app` and listed on the hub with a
   **Beta** badge.

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
2. Adds the app to `packages/registry/apps.json` with `"status": "beta"`.

That's all: the hub, the privacy page, the browser tests, the build and the
deploy all read from the registry and the `apps/` folder.

## Building the app

- Put the page in `apps/<slug>/src/pages/index.astro`, inside `<AppShell>`.
- Use components and classes from `@shkriuss/ui` ([design system](design-system.md)).
- Put logic in `src/lib/*.ts` with a unit test next to it (`*.test.ts`).
- Save data with `createStore` from `@shkriuss/storage`, and keep
  `<DataControls />` on the page so people can back up, restore or delete their
  data.
- Add browser tests in `apps/<slug>/e2e/`. `apps/tally` is the reference
  example for all of this.
- If the app needs a browser feature (for example keeping the screen on),
  allow it in `astro.config.ts`:
  `defineAppConfig({ slug: 'notes', allowFeatures: ['screen-wake-lock'] })`.

## Notifications while the app is closed (optional)

Apps can send reminders even when they're closed, through the shared
`@shkriuss/push` package ([ADR 0009](adr/0009-push-notifications.md)). Calendar
is the example to copy. Ask Claude, or:

1. In `apps.json`, add `"pushNotifications": true` to the app, and a line to
   `dataStored` about the device key (see Calendar's entry).
2. Add `src/worker.ts`:
   `export { default, PushDevice, PushKeys } from '@shkriuss/push/worker';`
3. In `wrangler.jsonc`, copy Calendar's `main`, `assets.binding`,
   `assets.run_worker_first`, `durable_objects`, `migrations` and `previews`.
   A unit test checks these match.
4. Add `"@shkriuss/push": "workspace:*"` to the app's `package.json`.
5. In the page script, call `enablePush()` from a switch, then
   `syncPush(notices)` whenever the app's data changes, and `disablePush()`
   when it's turned off. Each notice has a local start time, a repeat
   pattern, minutes before, and the title and text to show. See
   `apps/calendar/src/scripts/push-reminders.ts`.

The privacy page lists the app automatically, and "Delete all data" already
removes the device from the server.

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

The privacy page lists the app automatically. When an item is changed on two
devices before they sync, the newest change wins.

## Going live

When the app is ready, change its `"status"` in `apps.json` from `"beta"` to
`"live"` (this removes the Beta badge). To deploy an app without listing it
on the hub, use `"hidden"`.

## Removing an app

Delete `apps/<slug>/` and its entry in `apps.json` in one pull request. After
merging, delete the Worker in the Cloudflare dashboard (**Workers & Pages** →
the app → **Settings** → **Delete**). That also removes its address.
