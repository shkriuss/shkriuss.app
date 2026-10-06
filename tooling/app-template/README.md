# App template

The app that every new app starts from ([architecture §6](../../docs/architecture.md#6-anatomy-of-an-app)): a list that stays on the device, built on the whole platform, with the files that every app has. [`create-app`](../create-app/README.md) copies it into `apps/<id>`. It is a package of its own, which CI builds and tests as it does an app, so that the template always works, and `pnpm check` holds it to the structure that every app keeps. It is never deployed.

| File                                    | What it is                                                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.config.ts`                         | What the app is: its permanent id, its name and description from its messages, the accent color and glyph of its icons, and any browser feature |
| `vite.config.ts`                        | The app's build: `app(config)` of `@shkriuss/shell/vite`                                                                                        |
| `index.html`                            | The page. The build gives it the app's title and description, the manifest and the icons                                                        |
| `src/main.tsx`                          | Starts the app: the install prompt, the service worker, the database, then the router; or says why the app could not start                      |
| `src/router.ts`                         | The router: the routes, declared in code ([ADR 0013](../../docs/decisions/0013-routes-in-code.md)), and what every screen gets from the app     |
| `src/routes/`                           | One file per screen, with its route: `root.tsx`, the frame; `home.tsx`, at `/`; `settings.tsx`, at `/settings`                                  |
| `src/features/items/`                   | The example feature: a list of items, which a new app replaces with its own                                                                     |
| `src/schema.ts`                         | Every version of the app's data, each with its migration ([data model](../../docs/specs/data-model.md) §6)                                      |
| `src/messages.ts`                       | The app's text ([ADR 0012](../../docs/decisions/0012-typed-messages.md))                                                                        |
| `e2e/`                                  | The end-to-end tests                                                                                                                            |
| `playwright.config.ts`, `wrangler.json` | The tests' server: the build with its headers, as Cloudflare serves it, on port 4176                                                            |

| Command                                      | What it does                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm --filter @shkriuss/app-template dev`   | Development server, without the production headers and the service worker    |
| `pnpm --filter @shkriuss/app-template build` | Production build in `dist/`                                                  |
| `pnpm --filter @shkriuss/app-template e2e`   | End-to-end tests against the build, served by Wrangler with the real headers |

## What the tests check

In Chromium, Firefox and WebKit, at phone and tablet sizes, with the app's real service worker, data layer and backup worker, under the production headers:

- **Opening:** the app opens on its list, titled with its name, with no accessibility violation in either theme.
- **Items:** they are added with the button or with Enter, listed in the order they were added, kept across a reload, and deleted. After a deletion, the focus goes to the next item's button, or to the field once the list is empty. An empty item is refused, with what to do.
- **Settings:** every part that every app has, with no accessibility violation.
- **Backups:** an encrypted backup, made with the generated passphrase, restores the items on another device.
- **Offline:** the app's service worker controls the page, and keeps every file of the build.
- **Versions:** a newer version of the app, in another window, closes the database here: the app offers to reload, then says that it was updated.
- **Addresses** that the app does not have show that the page does not exist, in the frame.
