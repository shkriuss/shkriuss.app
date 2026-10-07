# App template without data

The app that every new app without data starts from ([architecture §6](../../docs/architecture.md#6-anatomy-of-an-app)): it counts the words of a text and keeps nothing. It has no database and no backups; its settings show installing and About only. [`create-app --no-data`](../create-app/README.md) copies it into `apps/<id>`. Like the [app template](../app-template/README.md), it is a package of its own, which CI builds and tests as it does an app, and `pnpm check` holds it to the structure that every app without data keeps. It is never deployed.

Its files are those of the app template, which says what each one is, but for the data:

| File                   | What differs                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `app.config.ts`        | `keepsData: false`: the build fails if it has the code of `@shkriuss/data` or `@shkriuss/backup`           |
| `src/main.tsx`         | Starts the install prompt and the service worker, then the router: there is no database to open            |
| `src/routes/`          | The frame has the update banner only; the settings are `SettingsScreenWithoutData` of `@shkriuss/shell`    |
| `src/features/words/`  | The example feature: a text whose words it counts as the user types, which a new app replaces with its own |
| `src/schema.ts`        | None: an app without data has no schema                                                                    |
| `playwright.config.ts` | The tests' server, on port 4177                                                                            |

| Command                                              | What it does                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm --filter @shkriuss/app-template-no-data dev`   | Development server, without the production headers and the service worker    |
| `pnpm --filter @shkriuss/app-template-no-data build` | Production build in `dist/`                                                  |
| `pnpm --filter @shkriuss/app-template-no-data e2e`   | End-to-end tests against the build, served by Wrangler with the real headers |

## What the tests check

In Chromium, Firefox and WebKit, at phone and tablet sizes, with the app's real service worker, under the production headers:

- **Opening:** the app opens on its first screen, titled with its name, with no accessibility violation in either theme.
- **Words:** they are counted as the user types, and are gone after a reload. The app stores nothing: no database, nothing in local or session storage, and no cache but the service worker's.
- **Settings:** installing and About, without storage or backups; About says that the app keeps none of the user's data. On iPhone and iPad, they say how to add the app to the Home Screen, with no data to take along.
- **Offline:** the app's service worker controls the page, and keeps every file of the build. Once the test cuts the network, the app still opens, at any of its addresses, and counts words.
- **Addresses** that the app does not have show that the page does not exist, in the frame.
