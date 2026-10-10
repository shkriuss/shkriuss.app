# @shkriuss/shell

The frame around every app's screens, and around the hub's pages ([architecture §5](../../docs/architecture.md#5-repository-layout)), so that every app is laid out, navigates, updates and fails alike. It builds on `@shkriuss/ui` and on TanStack Router, with routes declared in code ([ADR 0013](../../docs/decisions/0013-routes-in-code.md)), and its text comes from its own message modules: `messages.ts` for what every app shows, and `data-messages.ts` for what only apps with data show, which an app without data does not have ([ADR 0012](../../docs/decisions/0012-typed-messages.md)).

| Export                                                      | What it is                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppFrame`                                                  | The frame, which the app's root route shows: a header with the app's name and its navigation, the update banner and others, and the screen as the page's main content                                                                  |
| `Frame`                                                     | The frame of every page, of the apps and the hub: a header with the name and the navigation, banners, the page, and a footer. `AppFrame` is a `Frame` with the app's settings and the update banner                                    |
| `SOURCE_URL`, `LICENSES_PATH`, `SECURITY_URL`, `REPORT_URL` | Where the source code is, the licenses of what a build includes, the security policy, and the private report of a vulnerability that every site's `security.txt` gives                                                                 |
| `ScreenLink`                                                | A link to another screen, which the router opens without loading the page again; its `to` is checked against the app's routes                                                                                                          |
| `Screen`                                                    | A screen: its heading, which takes the focus when the user comes to it from another, and the page's title                                                                                                                              |
| `NotFound`                                                  | What the app shows at an address that none of its screens has: the router's `defaultNotFoundComponent`                                                                                                                                 |
| `SettingsScreen`                                            | The settings at `/settings`: the app's own, then installing, storage, backups and About, alike in every app. They load on demand, with the backup dialog; the app's settings route loads them first, with `loader: loadSettingsScreen` |
| `SettingsScreenWithoutData`                                 | The settings of an app without data: installing and About. It imports neither storage nor backups, so the app's build has none of their code                                                                                           |
| `StartFailed`                                               | What the app shows in place of its frame when it cannot open its database, as when a newer version upgraded it or the device has no space left, with a backup of the data as stored                                                    |
| `appUpdates`                                                | The service worker's updates, to which it adds the database: a newer version that closed it makes the page outdated                                                                                                                    |
| `UpdateBanner`                                              | Tells the user that a new version is ready, and updates the app when they agree ([service worker spec](../../docs/specs/service-worker.md) §7.2)                                                                                       |
| `AppError`                                                  | What a failed screen shows: that something went wrong, and a button that reloads the app; the router's `defaultErrorComponent`                                                                                                         |
| `useObserved`                                               | The latest result of an observed query, such as `db.observe()`, which re-renders the component at each new result                                                                                                                      |
| `StorageSection`                                            | The storage part of Settings: how much the app stores, whether the browser keeps it, and a button that asks the browser to keep it                                                                                                     |
| `BackupSection`                                             | The backup part of Settings: when the last backup was made and how much has changed since, a dialog that makes one, and one that restores one                                                                                          |
| `Restore`                                                   | The button and dialog that restore a backup, which `BackupSection` shows                                                                                                                                                               |
| `BackupReminder`                                            | A banner that reminds the user to back up, with a button that makes the backup at once                                                                                                                                                 |
| `InstallSection`                                            | The install part of Settings: the browser's install prompt, how to add the app to the Home Screen of an iPhone or iPad, and how to take its data along there, or that it is installed                                                  |
| `AboutSection`                                              | The about part of Settings: what the app does, where its data stays, or that it keeps none, its license and source code, the licenses of what it includes                                                                              |
| `InstallBanner`                                             | On iPhone and iPad, a banner that suggests installing the app before anything is entered                                                                                                                                               |

## Building an app

`@shkriuss/shell/vite` is every app's build. An app's `vite.config.ts` is only:

```ts
import { app } from "@shkriuss/shell/vite";
import { config } from "./app.config.ts";

export default app(config);
```

`app.config.ts` says what the app is (`AppConfig`): its permanent id, its name and description from its messages, the accent color and glyph of its icons, the browser features it needs, if any, whether its workers compile WebAssembly (`webAssembly`, [ADR 0014](../../docs/decisions/0014-webassembly.md)), the large files that its service worker keeps only once the app first uses them (`keepOnFirstUse`, such as `[".wasm"]`, [ADR 0019](../../docs/decisions/0019-files-kept-on-first-use.md)), and whether it keeps data (`keepsData`, true if left out). An app without data has no database and no backups: its build fails if it has the code of `@shkriuss/data` or `@shkriuss/backup`, or the shell's text for apps with data, and so any of the shell's parts that show it (see `excludedPackages` and `excludedFiles` of [`@shkriuss/edge`](../edge/README.md#excluded-packages)), and its settings are `SettingsScreenWithoutData`. The build of an app fails if its first page loads more than 180 kB of JavaScript, gzipped, or 150 kB for an app without data ([budgets](../edge/README.md#budgets)). `app()` refuses an id that cannot be an app's, then puts together React, Tailwind CSS, the page's title and description, the manifest and the icons, the service worker, and `edge()`, last, which writes the security headers once every other file is final. For the service worker's procedures of last resort, `app(config, { serviceWorker: { replaces: […] } })` or `{ remove: true }` ([`@shkriuss/pwa`](../pwa/README.md)).

`tooling/app-template` and `tooling/app-template-no-data` are apps built so, which CI builds and tests.

The package has no side effects (`"sideEffects": false` in its `package.json`): a module of it runs only for what an app uses of it, and an app's build leaves the rest out. So an app without data gets none of the code of the backups, though `@shkriuss/shell` exports it.

## The hub

The hub is a site without data, and no app. It takes two entry points of the shell:

- **`@shkriuss/shell/site`:** what it shares with the apps: `Frame`, `Screen`, `ScreenLink` and the links above, without the apps' parts, whose links to `/settings` its routes do not have.
- **`catalog(appsDirectory)` of `@shkriuss/shell/vite`:** its build's catalog of apps ([hub spec](../../docs/specs/hub.md) §2). It reads the `app.config.ts` of every app in `apps/`, checks it, and gives the hub each app's id, name, description, icon, browser features and whether it keeps data as the module `virtual:shkriuss/catalog`. Only those values reach the hub's bundle. It is the one place that reads another app's configuration; `pnpm check imports` refuses imports of an app anywhere. `readCatalog()` reads the same, for the hub's tests.

## Use

The app's routes, declared in code ([ADR 0013](../../docs/decisions/0013-routes-in-code.md)): the root route shows the frame, and every app has `/` and `/settings`, which the frame links to. The app template's `src/` shows all of it at work: starting, routes, a screen and the settings.

```tsx
import "@shkriuss/ui/styles.css";
import { startServiceWorker } from "@shkriuss/pwa";
import {
  AppError,
  AppFrame,
  BackupReminder,
  InstallBanner,
  NotFound,
  Screen,
  ScreenLink,
} from "@shkriuss/shell";
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";

const updates = startServiceWorker();

const root = createRootRoute({
  component: () => (
    <AppFrame
      name={m.appName()}
      updates={updates}
      navigation={<ScreenLink to="/lists">{m.lists()}</ScreenLink>}
      banners={
        <>
          <InstallBanner install={install} db={db} />
          <BackupReminder app="notes" db={db} />
        </>
      }
    >
      <Outlet />
    </AppFrame>
  ),
});
const home = createRoute({ getParentRoute: () => root, path: "/", component: Home });
const lists = createRoute({ getParentRoute: () => root, path: "/lists", component: Lists });
const settings = createRoute({
  getParentRoute: () => root,
  path: "/settings",
  component: Settings,
});

function Lists() {
  return <Screen title={m.lists()}>{/* The screen's content, under its heading. */}</Screen>;
}

export const router = createRouter({
  routeTree: root.addChildren([home, lists, settings]),
  defaultErrorComponent: AppError,
  defaultNotFoundComponent: NotFound,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

- **The frame** has a banner, a navigation and a main landmark. The app's name leads to its first screen, and the navigation ends with the settings. A link that keyboard users reach first skips to the screen (WCAG 2.4.1), without adding to the browser's history. The banners are in the page's status region, which is there from the start, empty while there is none: screen readers read a banner as it appears (WCAG 4.1.3), which they often do not for a live region that appears with its text. A banner that goes away with the button that had the focus, as after "Later", gives the focus to the screen, so that it is not lost (WCAG 2.4.3).
- **Navigation:** `ScreenLink` opens another screen without loading the page again. TypeScript checks its `to` against the app's routes, once the app registers its router as above. It is a plain link, so the browser opens it in a new tab when the user asks, and the link to the screen that shows has `aria-current="page"`.
- **Screens:** each screen is a `<Screen title={…}>`, whose title is its heading and names it in the page's title, as "Settings – Notes" (WCAG 2.4.2). When the user comes to a screen from another, with a link or with the browser's back and forward buttons, its heading takes the focus, and screen readers read it, as after loading a page (WCAG 2.4.3). The router has scrolled to the top by then. The first screen leaves the focus where a page leaves it. A screen whose heading is something that the user named, such as a list, gives the page a title of its own, as `<Screen title={name} pageTitle={m.list()}>`: browsers keep page titles in their history, which they may sync (threat model T11).
- **Addresses the app does not have,** such as an old bookmark, show `NotFound` in the frame, with a link to the app's first screen.
- **Updates** never interrupt: the banner shows that a new version is ready, and "Later" hides it until there is news again, such as another window that updated the app. An app that keeps something only in the page, such as a text, gives the frame a `reloadWarning`, which the banner adds while it offers to update: that updating, which reloads the page, clears it.
- **Errors:** a screen that fails shows `AppError` inside the frame, which keeps the update banner, since a new version may well fix it. The error's details stay in the app; nothing reports them anywhere.
- **Starting:** the app opens its database before it shows its frame. If that fails, it shows `StartFailed` instead: that a newer version of the app has opened the data already, which reloading brings, or that the data could not be opened, with a button that reloads. Then it also offers the backup dialog for the data as the device stores it (`rescueSnapshot()` of `@shkriuss/data`), which a version of the app that works can restore (backup format §4). It takes the app's id and its schemas: `<StartFailed name={m.appName()} app={config.id} schemas={schemas} error={error} />`.
- **Versions side by side:** a newer version of the app, in another window, upgrades the database and closes it here ([data model](../../docs/specs/data-model.md) §7). With `appUpdates(startServiceWorker())` as the frame's `updates`, and its `databaseClosed` as `onVersionChange` of `openDatabase()`, the update banner then says that the app was updated in another window, and reloads it.
- **Settings:** `<SettingsScreen>` at `/settings` shows the app's own settings, its children, then the parts that every app has, below. With the backup dialog, which the reminder opens too, they are what an app with data loads on demand, after its first page ([ADR 0018](../../docs/decisions/0018-quality-gates-as-enforced.md)): one module, `later.ts`, so that they load as one chunk, which may import only the entry script statically, as Safari requires. The app's settings route loads them in its `loader`, before they show, so that their heading takes the focus, as every screen's does.
- **Observed data:** create the observable once, with `useMemo`, so that each render does not start a new observation:

  ```tsx
  const notes = useObserved(useMemo(() => db.observe((reader) => reader.list("notes")), [db]));
  ```

  It is `loading` until the first result, then `ready` with each new one, or `failed` with the error that ended the observation.

- **Storage:** `<StorageSection storage={appStorage()} />` shows how much the app stores and whether the browser keeps it until the user deletes it, with `appStorage()` from `@shkriuss/pwa`. When the browser may delete the data, a button asks it to keep it; Firefox then asks the user. The section reads the status again whenever it appears.
- **Backups:** `<BackupSection app="notes" db={db} schemas={schemas} />` makes backups of the app's database and restores them, as the [backup format](../../docs/specs/backup-format.md) §3–§6 say.
  - **Encrypted:** with a generated passphrase, which the user writes down, or with one that the user types twice, of at least 12 characters and not easy to guess. The page keeps the generated passphrase only while the dialog shows it, or may show it again after a failure, and lets go of it once the backup is made.
  - **Plain:** only after a warning that anyone who gets the file can read all of it.
  - **Saving:** once the file is ready, "Save backup" hands it to the share sheet where the browser shares it (`navigator.canShare()`), or downloads it, and the database records the backup: the changes made while the dialog waited still count as changes since. A share sheet that the user closes saves and records nothing. Closing the dialog while it makes the backup stops the worker that derives the key.
  - **Dates ahead:** if the backup has changes dated more than a day ahead of this device's clock, as after a change made while the date was set ahead ([data model §3.5](../../docs/specs/data-model.md#35-clocks-from-the-future)), the dialog says so with the file: if this device's clock is wrong, the user can correct it; otherwise restoring the backup will ask to confirm those dates.
  - **Status:** the section shows when the last backup was made and how many changes it lacks. It shares what it knows with the reminder, so that a backup made or restored in one shows in the other.
  - **Restoring:** "Restore from a backup" opens the file picker. The file is size-checked, decrypted with its passphrase if it is encrypted, where the user can try again after a wrong one, then read, checked and migrated with the app's `schemas`. The dialog shows when the backup was made and what restoring it brings, such as "12 new, 3 updated, 1 deleted", and writes only when the user agrees, in one transaction. If its changes are dated more than a day ahead of this device's clock, it says so, and restores only with "Restore anyway". A backup that brings only deletions of items this device never had can still be restored, so that an older backup cannot bring them back. Closing the dialog while it decrypts stops the worker that derives the key; once the import has started, Escape no longer closes it, until the import has ended. A file that cannot be restored is refused with what happened and what to do (§6), and changes nothing, and so is a restore that the device has no space for.
- **Reminders** ([architecture §8](../../docs/architecture.md#8-backups)): `<BackupReminder app="notes" db={db} />`, among the frame's `banners`, reminds the user to back up when the device has changes that none of its backups has, and it never made a backup, or made its last one a week ago or more. A last backup that the clock puts more than a day ahead counts as old, so that a wrong clock does not silence the reminders.
  - **Never in the middle of a task:** it checks when the app opens and whenever it comes back into view. A change does not bring it, nor does a restore; a backup, made from the reminder or in the settings, takes it away.
  - **"Back up"** opens the backup dialog at once, as in the settings. After the backup, the reminder is gone, and the focus goes to the screen.
  - **"Later"** hides it until the app opens again, for a day at most. Keeping "Later" over the next opening would need the database to store it, which the [data model](../../docs/specs/data-model.md) §7 does not provide.
- **Installing** ([architecture §9](../../docs/architecture.md#9-offline-install-and-updates)): `<InstallSection install={appInstall()} />` in the settings, with `appInstall()` from `@shkriuss/pwa`, called when the app starts.
  - **Chromium:** where the browser offers to install the app, an "Install" button shows its prompt. Once the user answers, the focus goes to the section, whose text says what changed.
  - **iPhone and iPad:** the section says how to add the app to the Home Screen, and that the app there keeps its own data: to take it along, back it up in the browser, then restore the backup in the app.
  - **Elsewhere:** the section says that some browsers install apps from their menu.
  - **Before anything is entered:** on iPhone and iPad, `<InstallBanner install={install} db={db} />`, among the frame's `banners`, suggests installing the app first, while the device has no data. Like the reminder, it checks when the app opens and whenever it comes back into view; "Later" hides it until the app opens again. Once there is data, the backup reminder takes its place.
- **About:** `<AboutSection name={m.appName()} description={m.appDescription()} />` says what the app does and that its data stays on the device, and that it is free software under AGPL-3.0.
  - **Links:** the source code, as the license gives every user the right to it, and how to report a security problem. They open a new tab: an app installed on an iPhone has no back button.
  - **Licenses** of the software of others that the app includes, from the build's `/licenses.txt`, show in a dialog, also offline. A tab of their own would not do: Chromium shows a text file with a `style` attribute, which the Content-Security-Policy refuses.
  - **No version yet:** showing which version runs needs the service worker to tell its version id, a change to its spec that comes on its own.
- **Styles:** the shell's components use Tailwind's classes, which `@shkriuss/ui/styles.css` covers.

## Tests

The store behind `useObserved`, the backup status that the settings and the reminder share, when the reminder comes, the links of About, saving a file, comparing passphrases, the messages of restore errors, the text, and the updates that a closed database makes outdated have unit tests. So does the build of an app, with real builds of a tiny app: its page's title and description, the manifest, the service worker and the security headers, the browser features it allows, the service worker's procedures of last resort, ids that cannot be an app's, an app without data, whose build refuses the code that keeps data and the shell's text for apps with data, and the budgets of the first page. The components and hooks need React in a browser, so `tooling/platform-e2e` tests them on its pages `/shell`, `/shell/archive` and `/shell/settings`, whose routes are declared in code: axe in both themes, the landmarks and the skip link; links between screens, which do not load the page again, with the pointer, with Enter and with the browser's back and forward buttons, the focus on each new screen's heading and the page's title, a link opened with a modifier key, which stays the browser's, and an address that the app does not have; the banner in every state, with what updating clears and without, notes that change while the screen shows them, a screen that fails, the storage section in every state, asking the browser with a yes and with a no, and backups: encrypted with either passphrase or plain, a passphrase that is easy to guess, the page's memory, which no longer holds the generated passphrase once the backup is made, saved as a download or through a share sheet that the tests stand in for, read back, and restored on another device, with every error that a file can cause, and a backup whose changes are dated ahead, which says so and restores elsewhere only once the user confirms; the reminder: when it comes and when it does not, its backup, "Later" for a day, and where the focus goes; installing, with the browser's prompt and on iPhone and iPad; and About, with its links and the licenses.
