# @shkriuss/shell

The frame around every app's screens ([architecture §5](../../docs/architecture.md#5-repository-layout)), so that every app is laid out, updates and fails alike. It builds on `@shkriuss/ui`, and its text comes from its own message module.

| Export             | What it is                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AppFrame`         | The frame: a header with the app's name and its navigation, the update banner, and the screen as the page's main content                         |
| `UpdateBanner`     | Tells the user that a new version is ready, and updates the app when they agree ([service worker spec](../../docs/specs/service-worker.md) §7.2) |
| `AppErrorBoundary` | Shows `AppError` in place of a screen that throws while rendering                                                                                |
| `AppError`         | What a failed screen shows: that something went wrong, and a button that reloads the app                                                         |
| `useObserved`      | The latest result of an observed query, such as `db.observe()`, which re-renders the component at each new result                                |
| `StorageSection`   | The storage part of Settings: how much the app stores, whether the browser keeps it, and a button that asks the browser to keep it               |
| `BackupSection`    | The backup part of Settings: when the last backup was made and how much has changed since, and a dialog that makes one                           |

## Use

```tsx
import "@shkriuss/ui/styles.css";
import { startServiceWorker } from "@shkriuss/pwa";
import { AppErrorBoundary, AppFrame } from "@shkriuss/shell";

const updates = startServiceWorker();

createRoot(container).render(
  <AppFrame name={m.appName()} updates={updates} navigation={<Sections />}>
    <AppErrorBoundary>
      <Screen />
    </AppErrorBoundary>
  </AppFrame>,
);
```

- **The frame** has a banner, a navigation and a main landmark. A link that keyboard users reach first skips to the screen (WCAG 2.4.1), without adding to the browser's history.
- **Updates** never interrupt: the banner shows that a new version is ready, and "Later" hides it until there is news again, such as another window that updated the app.
- **Errors:** a screen that fails shows what happened inside the frame, which keeps the update banner, since a new version may well fix it. The error's details stay in the app; nothing reports them anywhere.
- **Observed data:** create the observable once, with `useMemo`, so that each render does not start a new observation:

  ```tsx
  const notes = useObserved(useMemo(() => db.observe((reader) => reader.list("notes")), [db]));
  ```

  It is `loading` until the first result, then `ready` with each new one, or `failed` with the error that ended the observation.

- **Storage:** `<StorageSection storage={appStorage()} />` shows how much the app stores and whether the browser keeps it until the user deletes it, with `appStorage()` from `@shkriuss/pwa`. When the browser may delete the data, a button asks it to keep it; Firefox then asks the user. The section reads the status again whenever it appears.
- **Backups:** `<BackupSection app="notes" db={db} />` makes backups of the app's database, as the [backup format](../../docs/specs/backup-format.md) §3 and §4 say.
  - **Encrypted:** with a generated passphrase, which the user writes down, or with one of at least 12 characters that the user types twice. The passphrase stays in memory only while the dialog needs it.
  - **Plain:** only after a warning that anyone who gets the file can read all of it.
  - **Saving:** once the file is ready, "Save backup" hands it to the share sheet where the browser shares it (`navigator.canShare()`), or downloads it, and the database records the backup. A share sheet that the user closes saves and records nothing.
  - **Status:** the section shows when the last backup was made and how many changes it lacks.
- **Styles:** the shell's components use Tailwind's classes, which `@shkriuss/ui/styles.css` covers.

The navigation itself, with TanStack Router, comes with the app template (step 1.3). The rest of the settings, the about screen and restoring from a backup come later.

## Tests

The store behind `useObserved`, saving a file, comparing passphrases and the text have unit tests. The components and hooks need React in a browser, so `tooling/platform-e2e` tests them on its pages `/shell` and `/shell/settings`: axe in both themes, the landmarks and the skip link, the banner in every state, notes that change while the screen shows them, a screen that fails, the storage section in every state, asking the browser with a yes and with a no, and backups: encrypted with either passphrase or plain, saved as a download or through a share sheet that the tests stand in for, and read back.
