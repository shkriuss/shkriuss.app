# Data inventory

What each app stores on the phone, where, whether it is in a backup, and
what leaves the phone and how.

- Status: covers Catalog, Water and Reminders. It is written from the
  code, not from other pages. The file names and keys below are the ones in the
  code.
- Each later app adds its section before its first release.
- The same, in plain words for users: [privacy.md](../user/privacy.md).
  The permissions behind it: [permissions.md](permissions.md).

## What every app follows

1. **Private storage only.** Every app keeps its data in its own private
   storage, which Android encrypts with the phone's screen lock
   (credential-encrypted storage). No app uses the storage that is
   readable before the first unlock after a restart.
2. **No Android backup and no device transfer.** Every app turns both
   off. Rule 6 of the APK rules check fails an app that does not
   ([build.md](../development/build.md#the-backup-rule)).
3. **No network.** Data apps have no network permission (hard rule 4,
   [ADR 0005](../adr/0005-no-network-permission-in-data-apps.md)).
4. **No logs.** The main code of every module never logs or prints. The
   logging check fails the build if it does
   ([build.md](../development/build.md#logging-check)).
5. **No storage permission.** A file enters or leaves only through
   Android's file picker, to or from the place the user picks.
6. **Records are marked deleted, not removed.** Every record has `id`,
   `createdAt`, `updatedAt`, `deletedAt` and a local `changeNumber`
   ([data.md](../architecture/data.md)).

## Catalog (`app.shkriuss.catalog`)

Catalog stores nothing of its own.

- It has no database, no preferences file and no keys. It has no app
  class, so nothing of `core/crypto`, `core/security` or `core/notify`
  starts in it.
- Its sample recovery words come from the word list inside the APK. They
  are no real key.
- Its manifest removes the screens of `core/security`, the two
  permissions they bring, and the emoji font loader
  ([permissions.md](permissions.md#catalog-appshkriusscatalog)).
- Nothing leaves the phone. It shows no notification and writes no file.

## Water (`app.shkriuss.water`)

### On the phone

Everything is in Water's private storage, except the keys that the
Android Keystore holds.

| What | Where | What it holds | In a backup |
|---|---|---|---|
| The database `water.db` | Water's database folder | Three record tables: `intake`, one row per drink (amount in millilitres, day, minute of the day); `goal`, one row per change of the daily goal (amount, the first day it counts for); `settings`, one row (unit, the three quick amounts, reminders on or off, the interval, "From" and "Until"). Each row also has its random ID, its times and its deletion marker. The table `change_counter` holds one number. Numbers, days, minutes, times and random IDs only. No text. | `intake`, `goal` and `settings`: yes, deleted rows too. The change numbers and `change_counter`: no |
| The preferences file `app.shkriuss.water` | Water's preferences folder | The bookkeeping of reminders, six times in milliseconds: `last-shown`, `last-later`, `snooze`, `showing`, `named` and `last-alarm` ([spec.md](../apps/water/spec.md#on-this-phone-only)). Times only. No amount and no text. | No |
| The preferences file `app.shkriuss.core.notify` | Water's preferences folder | For Water's one alarm, `next-drink`: the time it is set for (`registered:next-drink`) and the time it last fired (`fired:next-drink`). And `permission-asked`: whether Android's question for notifications was answered ([notifications.md](../architecture/notifications.md#what-goes-where)). | No |
| The preferences file `app.shkriuss.core.security` | Water's preferences folder | Three settings of the app lock: `lock-after` (when it locks), `block-screenshots` and `notification-text` ([ADR 0032](../adr/0032-app-lock-settings-in-android-preferences.md)). Whether the app lock is on is not a setting in this file. It is which hardware key wraps the `file-key` keyset. | No |
| Key files, `shk-keys/` | Water's no-backup folder | The keysets `record`, `backup` and `file-key`, each wrapped by a hardware key. `recovery`, the recovery key, only if the phone keeps it, wrapped by a key that needs the system prompt for every use. `file-key-old` only for a moment after a setup was started over. None of them exists before the recovery key is set up ([crypto-design.md](crypto-design.md#where-keys-are-stored)). | No |
| Set-aside key files, `shk-keys-set-aside/` | Water's no-backup folder | A copy of a keyset file that could not be read, kept before the file is written again. Still wrapped. | No |
| Hardware keys | The Android Keystore, in StrongBox where the phone has it | Up to four keys per app, which cannot be read out: the Background key, the Unlocked key, the Lock key (while the app lock is on) and the Recovery guard (while the phone keeps the recovery key) ([crypto-design.md](crypto-design.md#hardware-keys)). | No |
| The restore staging folder, `shk-restore/` | Water's no-backup folder | Only while a restore runs: the records of the backup, **not encrypted**, so that nothing changes until the whole file is checked. Deleted when the restore ends, well or badly, and again at every start of Water. It is an ordinary delete ([backup-format.md](../architecture/backup-format.md#staging)). | Not applicable |

Android also keeps some things for Water, outside Water's folders:

- The alarm of the next reminder: its time and its name `next-drink`.
- A reminder while it shows, and Android's notification history if the
  user turned it on.
- A picture of Water's screen in the recent apps. While the app lock is
  on, or "Hide in recent apps and block screenshots" is on, the picture
  is blank.
- The saved state of Water's screen while it waits in the background,
  such as a number typed into a dialog.

### What leaves the phone, and how

1. **A backup file**, only when you make one, to the place you pick in
   Android's file picker. That place can be a USB stick or a cloud
   storage app. Water suggests the name `water-<date>.shkbackup`, for
   example `water-2026-11-13.shkbackup`.
   - In the clear, at its start: that it is a backup of the suite, its
     format version, the app name `water`, and the short name (key ID)
     of the recovery key it needs
     ([backup-format.md](../architecture/backup-format.md)).
   - Encrypted with the backup key of the recovery key: when it was
     made, Water's data version, every record of `intake`, `goal` and
     `settings`, deleted ones too, and their counts.
   - Not in it: keys, the recovery key, the three preferences files,
     change numbers.
   - Its size shows roughly how many records it holds. The date is in
     the suggested name.
2. **A restore** reads one file that you pick. It writes nothing outside
   Water.
3. **Notifications.** A reminder shows "Time for some water", today's
   total and goal, such as "1,250 of 2,000 ml today", and the buttons
   **Drank 150 ml** (the first quick amount) and **Later**.
   - On the lock screen it is private: Android shows its text only if
     the phone's setting allows it.
   - A reminder's text and buttons reach another app only if you gave
     that app notification access. Such an app can pass them on to a
     watch.
   - Water does not mark its reminders "local only". That mark would not
     hide a reminder from apps with notification access. It only asks
     apps that pass notifications to a watch not to pass it. Whether
     Water should mark them, or offer a setting, is Open
     ([spec.md](../apps/water/spec.md#open), item 9).
   - With the app lock on, a reminder shows only its hidden form:
     "Drink reminders" and "The app lock hides this notification. Open
     the app to see it.", without amounts and without buttons. Unless
     **Show the text in notifications** is on.
   - If a reminder cannot be shown, a notice comes in its place: "Drink
     reminders" and "A reminder could not be shown. Open the app to see
     it.", with no numbers and no buttons.
4. **Intents**, which stay inside the phone. A tap on a reminder opens
   Water. A button's press goes only to Water's own receiver, and
   carries the button, the reminder's time and, for **Drank**, the
   amount in millilitres. Never a text. The alarm carries only its name.
   Water opens Android's own pages for its notification settings.
5. **Nothing else.** Water has no network permission. Android backup and
   device transfer are off. Water shares nothing with other apps, uses
   no clipboard and writes no log.

### Not checked in the code

Android and the libraries keep a few files of their own in Water's
private storage. This page did not check them in the code:

- Android's SQLite keeps the database's write-ahead files, `water.db-wal`
  and `water.db-shm`, next to it. They are part of the database: they
  can hold rows of its tables, your drinks too, until SQLite writes
  them into `water.db`.
- The profile installer of AndroidX keeps small files about the app's
  start-up profile. They hold no user data.
- Android keeps the app's compiled code. It holds no user data.

### How to delete it

- In Android's Settings, open **Apps**, then **Water**, **Storage**, and
  tap **Clear storage**. Everything above goes, the keys too. Uninstalling
  Water does the same.
- Backup files stay where you put them. Delete them there.
- Without the recovery words, nobody can open those backups.

## Reminders (`app.shkriuss.reminders`)

Reminders is being built. Its code stores reminders and what this
phone remembers of them, as below. Its screens are not built yet: the
app shows one line and writes none of it. It has no backup, shows no
reminder and cannot set up the recovery key.

### On the phone

Everything is in Reminders' private storage.

| What | Where | What it holds | In a backup |
|---|---|---|---|
| The database `reminders.db` | Reminders' database folder | One record table, `reminder`, one row per reminder: its title, its date, its time, its repeat and its days of the week ([spec.md](../apps/reminders/spec.md#table-reminder)). Each row also has its random ID, its times and its deletion marker. A deleted reminder keeps its title. The table `change_counter` holds one number. **Text: the titles.** | `reminder`: yes, deleted rows too, once the backup screens are built. The change numbers and `change_counter`: no |
| The preferences file `app.shkriuss.reminders` | Reminders' preferences folder | For each reminder, by its random ID: its mark (`mark.<id>`, a local date and minute), the end of its snooze (`snooze.<id>`) and the time of its notification on screen (`showing.<id>`) ([spec.md](../apps/reminders/spec.md#on-this-phone-only)). IDs and times only. Never a title. | No |

- No key files and no hardware keys: the recovery key cannot be set up
  in Reminders yet.
- No preferences file of `core/security`: the settings of the app lock
  cannot be changed in Reminders yet.
- Android's SQLite keeps the write-ahead files `reminders.db-wal` and
  `reminders.db-shm` next to the database. They can hold rows of it,
  titles too, until SQLite writes them into `reminders.db`.

### What leaves the phone, and how

Nothing. Reminders has no network permission and shows no notification.
Android backup and device transfer are off. It writes no file outside
its storage, shares nothing with other apps, uses no clipboard and
writes no log.

### How to delete it

In Android's Settings, open **Apps**, then **Reminders**, **Storage**,
and tap **Clear storage**. Everything above goes. Uninstalling Reminders
does the same.
