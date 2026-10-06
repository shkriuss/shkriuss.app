# @shkriuss/shell

The frame around every app's screens ([architecture §5](../../docs/architecture.md#5-repository-layout)), so that every app is laid out, updates and fails alike. It builds on `@shkriuss/ui`, and its text comes from its own message module.

| Export             | What it is                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AppFrame`         | The frame: a header with the app's name and its navigation, the update banner and others, and the screen as the page's main content              |
| `UpdateBanner`     | Tells the user that a new version is ready, and updates the app when they agree ([service worker spec](../../docs/specs/service-worker.md) §7.2) |
| `AppErrorBoundary` | Shows `AppError` in place of a screen that throws while rendering                                                                                |
| `AppError`         | What a failed screen shows: that something went wrong, and a button that reloads the app                                                         |
| `useObserved`      | The latest result of an observed query, such as `db.observe()`, which re-renders the component at each new result                                |
| `StorageSection`   | The storage part of Settings: how much the app stores, whether the browser keeps it, and a button that asks the browser to keep it               |
| `BackupSection`    | The backup part of Settings: when the last backup was made and how much has changed since, a dialog that makes one, and one that restores one    |
| `Restore`          | The button and dialog that restore a backup, which `BackupSection` shows                                                                         |
| `BackupReminder`   | A banner that reminds the user to back up, with a button that makes the backup at once                                                           |

## Use

```tsx
import "@shkriuss/ui/styles.css";
import { startServiceWorker } from "@shkriuss/pwa";
import { AppErrorBoundary, AppFrame, BackupReminder } from "@shkriuss/shell";

const updates = startServiceWorker();

createRoot(container).render(
  <AppFrame
    name={m.appName()}
    updates={updates}
    navigation={<Sections />}
    banners={<BackupReminder app="notes" db={db} />}
  >
    <AppErrorBoundary>
      <Screen />
    </AppErrorBoundary>
  </AppFrame>,
);
```

- **The frame** has a banner, a navigation and a main landmark. A link that keyboard users reach first skips to the screen (WCAG 2.4.1), without adding to the browser's history. A banner that goes away with the button that had the focus, as after "Later", gives the focus to the screen, so that it is not lost (WCAG 2.4.3).
- **Updates** never interrupt: the banner shows that a new version is ready, and "Later" hides it until there is news again, such as another window that updated the app.
- **Errors:** a screen that fails shows what happened inside the frame, which keeps the update banner, since a new version may well fix it. The error's details stay in the app; nothing reports them anywhere.
- **Observed data:** create the observable once, with `useMemo`, so that each render does not start a new observation:

  ```tsx
  const notes = useObserved(useMemo(() => db.observe((reader) => reader.list("notes")), [db]));
  ```

  It is `loading` until the first result, then `ready` with each new one, or `failed` with the error that ended the observation.

- **Storage:** `<StorageSection storage={appStorage()} />` shows how much the app stores and whether the browser keeps it until the user deletes it, with `appStorage()` from `@shkriuss/pwa`. When the browser may delete the data, a button asks it to keep it; Firefox then asks the user. The section reads the status again whenever it appears.
- **Backups:** `<BackupSection app="notes" db={db} schemas={schemas} />` makes backups of the app's database and restores them, as the [backup format](../../docs/specs/backup-format.md) §3–§6 say.
  - **Encrypted:** with a generated passphrase, which the user writes down, or with one of at least 12 characters that the user types twice. The passphrase stays in memory only while the dialog needs it.
  - **Plain:** only after a warning that anyone who gets the file can read all of it.
  - **Saving:** once the file is ready, "Save backup" hands it to the share sheet where the browser shares it (`navigator.canShare()`), or downloads it, and the database records the backup. A share sheet that the user closes saves and records nothing.
  - **Status:** the section shows when the last backup was made and how many changes it lacks. It shares what it knows with the reminder, so that a backup made or restored in one shows in the other.
  - **Restoring:** "Restore from a backup" opens the file picker. The file is size-checked, decrypted with its passphrase if it is encrypted, where the user can try again after a wrong one, then read, checked and migrated with the app's `schemas`. The dialog shows when the backup was made and what restoring it brings, such as "12 new, 3 updated, 1 deleted", and writes only when the user agrees, in one transaction. A file that cannot be restored is refused with what happened and what to do (§6), and changes nothing.
- **Reminders** ([architecture §8](../../docs/architecture.md#8-backups)): `<BackupReminder app="notes" db={db} />`, among the frame's `banners`, reminds the user to back up when the device has changes that none of its backups has, and it never made a backup, or made its last one a week ago or more. A last backup that the clock puts more than a day ahead counts as old, so that a wrong clock does not silence the reminders.
  - **Never in the middle of a task:** it checks when the app opens and whenever it comes back into view. A change does not bring it, nor does a restore; a backup, made from the reminder or in the settings, takes it away.
  - **"Back up"** opens the backup dialog at once, as in the settings. After the backup, the reminder is gone, and the focus goes to the screen.
  - **"Later"** hides it until the app opens again, for a day at most. Keeping "Later" over the next opening would need the database to store it, which the [data model](../../docs/specs/data-model.md) §7 does not provide.
- **Styles:** the shell's components use Tailwind's classes, which `@shkriuss/ui/styles.css` covers.

The navigation itself, with TanStack Router, comes with the app template (step 1.3). The rest of the settings and the about screen come later.

## Tests

The store behind `useObserved`, the backup status that the settings and the reminder share, when the reminder comes, saving a file, comparing passphrases, the messages of restore errors and the text have unit tests. The components and hooks need React in a browser, so `tooling/platform-e2e` tests them on its pages `/shell` and `/shell/settings`: axe in both themes, the landmarks and the skip link, the banner in every state, notes that change while the screen shows them, a screen that fails, the storage section in every state, asking the browser with a yes and with a no, and backups: encrypted with either passphrase or plain, saved as a download or through a share sheet that the tests stand in for, read back, and restored on another device, with every error that a file can cause; and the reminder: when it comes and when it does not, its backup, "Later" for a day, and where the focus goes.
