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
  `<DataControls />` on the page so people can download or delete their data.
- Add browser tests in `apps/<slug>/e2e/`. `apps/tally` is the reference
  example for all of this.
- If the app needs a browser feature (for example keeping the screen on),
  allow it in `astro.config.ts`:
  `defineAppConfig({ slug: 'notes', allowFeatures: ['screen-wake-lock'] })`.

## Going live

When the app is ready, change its `"status"` in `apps.json` from `"beta"` to
`"live"` (this removes the Beta badge). To deploy an app without listing it
on the hub, use `"hidden"`.

## Removing an app

Delete `apps/<slug>/` and its entry in `apps.json` in one pull request. After
merging, delete the Worker in the Cloudflare dashboard (**Workers & Pages** →
the app → **Settings** → **Delete**). That also removes its address.
