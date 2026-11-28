# Data inventory

What each app stores on the phone, where, whether it is in a backup, and
what leaves the phone and how.

- Status: covers Catalog, Water, Reminders, Tasks, Notes and Sync. It is
  written from the code, not from other pages. The file names and keys
  below are the ones in the code.
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
   ([data.md](../architecture/data.md)). A deleted record keeps its
   content, except where an app wipes it
   ([ADR 0042](../adr/0042-wiping-the-content-of-deleted-records.md)):
   Notes does.

## Catalog (`app.shkriuss.catalog`)

Catalog stores nothing of its own.

- It has no database, no preferences file and no keys. It has no app
  class, so nothing of `core/crypto`, `core/security` or `core/notify`
  starts in it.
- Its sample recovery words come from the word list inside the APK. They
  are no real key.
- Its manifest removes the screens of `core/security`, the two
  permissions they bring, its status provider and its `<queries>`, and
  the emoji font loader
  ([permissions.md](permissions.md#catalog-appshkriusscatalog)). So
  Catalog takes no part in the handover between apps.
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
5. **Keys to another app of the suite on the phone**, only through the
   handover between apps, and only when you allow it on Water's screen
   and answer the system prompt
   ([ADR 0041](../adr/0041-the-handover-between-apps.md)).
   - What goes: that app's own three keysets, which Water makes from the
     recovery key it keeps. Never the recovery key, never Water's own
     keys, never a record.
   - To whom: only the app that Android names as the one that asked, and
     only if it is a data app of the suite signed with exactly Water's
     own current certificate
     ([permissions.md](permissions.md#the-handover-between-apps)).
   - How: in the answer of Water's handover screen, which Android hands
     to that app. Never in a file, the clipboard, a notification, a
     screen's saved state or a log.
   - When another app turns its app lock on, you can let Water check
     four of your words instead. Water then gives that app its keys in
     the same way, marked "words checked". It stores nothing.
   - For the Sync app only, in the mode "Sign a device": Water signs
     that this phone may join the sync server that Sync names. Only
     when you allow it on Water's screen, which names the server, and
     answer the system prompt, or, when Water does not keep the key,
     enter the 24 words of Water's own key. What goes: the join
     statement (the server's ID and address, this phone's device key,
     the key's short name and the time), its signature, the account
     public key, and the name key, which seals only the names of
     devices. Never the recovery key, Water's own keys or a record. To
     whom: only the Sync app of the suite signed with exactly Water's
     own current certificate, in the answer of the handover screen
     ([crypto-design.md](crypto-design.md#the-handover-format-version-2)).
   - Water's status provider tells such an app, or the Sync app, when
     it asks, whether Water keeps the recovery key now, and the short
     name of the key its keys come from. Nothing else, and nothing to
     any other app.
   - Water also takes its own keys from another app that keeps the
     recovery key, the same way, when you tap **Get the keys from** that
     app.
6. **Nothing else.** Water has no network permission. Android backup and
   device transfer are off. Water shares nothing else with other apps, puts
   nothing on the clipboard itself and writes no log. Its number fields
   offer the usual copy and paste, so what you copy from them goes to
   the clipboard.

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

On its screens you add, change and delete reminders. It stores them and
what this phone remembers of them, shows each reminder as a
notification at its time, and makes and restores backups, as below.

### On the phone

Everything is in Reminders' private storage, except the keys that the
Android Keystore holds.

| What | Where | What it holds | In a backup |
|---|---|---|---|
| The database `reminders.db` | Reminders' database folder | One record table, `reminder`, one row per reminder: its title, its date, its time, its repeat and its days of the week ([spec.md](../apps/reminders/spec.md#table-reminder)). Each row also has its random ID, its times and its deletion marker. A deleted reminder keeps its title. The table `change_counter` holds one number. **Text: the titles.** | `reminder`: yes, deleted rows too. The change numbers and `change_counter`: no |
| The preferences file `app.shkriuss.reminders` | Reminders' preferences folder | For each reminder, by its random ID: its mark (`mark.<id>`, a local date and minute), the end of its snooze (`snooze.<id>`) and the time of its notification on screen (`showing.<id>`) ([spec.md](../apps/reminders/spec.md#on-this-phone-only)). IDs and times only. Never a title. | No |
| The preferences file `app.shkriuss.core.notify` | Reminders' preferences folder | For each alarm, named by the random ID of its reminder: the time it is set for (`registered:<id>`) and the time it last fired (`fired:<id>`). And `permission-asked`: whether Android's question for notifications was answered ([notifications.md](../architecture/notifications.md#what-goes-where)). IDs and times only. | No |
| The preferences file `app.shkriuss.core.security` | Reminders' preferences folder | Three settings of the app lock: `lock-after` (when it locks), `block-screenshots` and `notification-text` ([ADR 0032](../adr/0032-app-lock-settings-in-android-preferences.md)). Whether the app lock is on is not a setting in this file. It is which hardware key wraps the `file-key` keyset. | No |
| Key files, `shk-keys/` | Reminders' no-backup folder | The keysets `record`, `backup` and `file-key`, each wrapped by a hardware key. `recovery`, the recovery key, only if the phone keeps it, wrapped by a key that needs the system prompt for every use. `file-key-old` only for a moment after a setup was started over. None of them exists before the recovery key is set up ([crypto-design.md](crypto-design.md#where-keys-are-stored)). | No |
| Set-aside key files, `shk-keys-set-aside/` | Reminders' no-backup folder | A copy of a keyset file that could not be read, kept before the file is written again. Still wrapped. | No |
| Hardware keys | The Android Keystore, in StrongBox where the phone has it | Up to four keys per app, which cannot be read out: the Background key, the Unlocked key, the Lock key (while the app lock is on) and the Recovery guard (while the phone keeps the recovery key) ([crypto-design.md](crypto-design.md#hardware-keys)). | No |
| The restore staging folder, `shk-restore/` | Reminders' no-backup folder | Only while a restore runs: the records of the backup, **not encrypted**, titles too, so that nothing changes until the whole file is checked. Deleted when the restore ends, well or badly, and again at every start of Reminders. It is an ordinary delete ([backup-format.md](../architecture/backup-format.md#staging)). | Not applicable |

- Reminders stores no files: it never asks `core/crypto` for a file key.
- Android's SQLite keeps the write-ahead files `reminders.db-wal` and
  `reminders.db-shm` next to the database. They can hold rows of it,
  titles too, until SQLite writes them into `reminders.db`.

Android also keeps some things for Reminders, outside Reminders'
folders:

- The alarm of each upcoming reminder: its time and the random ID of its
  reminder. No title.
- A reminder's notification while it shows, with its title. If the user
  turned on Android's notification history, Android keeps the
  notifications of the last 24 hours there, titles too, also after the
  notification is gone or the reminder is deleted.
- A picture of Reminders' screen in the recent apps, which can show
  titles. While the app lock is on, or "Hide in recent apps and block
  screenshots" is on, the picture is blank.
- The saved state of Reminders' screen while it waits in the
  background: the place that is open, a part of Licences, an open date
  or time picker with the date or time in it, and how far each list is
  scrolled. Never a title: the open form lives only while Reminders runs.

The keyboard app sees what is typed into a title, as in any app.
Reminders asks it not to learn titles, so that it keeps no words of them
in its own dictionary (`IME_FLAG_NO_PERSONALIZED_LEARNING`). A keyboard
can ignore the request
([threat-model.md](threat-model.md#out-of-scope), point 3).

### What leaves the phone, and how

1. **A backup file**, only when you make one, to the place you pick in
   Android's file picker. That place can be a USB stick or a cloud
   storage app. Reminders suggests the name `reminders-<date>.shkbackup`,
   for example `reminders-2026-11-16.shkbackup`.
   - In the clear, at its start: that it is a backup of the suite, its
     format version, the app name `reminders`, and the short name (key
     ID) of the recovery key it needs
     ([backup-format.md](../architecture/backup-format.md)).
   - Encrypted with the backup key of the recovery key: when it was
     made, Reminders' data version, every record of `reminder`, deleted
     ones too, with their titles, and their counts.
   - Not in it: keys, the recovery key, the three preferences files,
     change numbers.
   - Its size shows roughly how many reminders it holds, and how long
     their titles are. The date is in the suggested name.
2. **A restore** reads one file that you pick. It writes nothing outside
   Reminders.

Three more things leave Reminders' storage. They stay inside the
phone:

3. **Notifications.** A reminder shows its title, and "Every day",
   "Missed: 09:00" or "Snoozed. It was due at 09:00.", with the buttons
   **Done** and **Snooze 10 min**.
   - On the lock screen it is private: Android shows its title only if
     the phone's setting allows it.
   - A reminder's title and buttons reach another app only if you gave
     that app notification access. Such an app can pass them on to a
     watch.
   - Reminders does not mark its reminders "local only", as Water does
     not ([spec.md](../apps/reminders/spec.md#open), item 1).
   - With the app lock on, a reminder shows only its hidden form:
     "Reminders" and "The app lock hides this notification. Open the app
     to see it.", without its title and without buttons. Unless **Show
     the text in notifications** is on.
   - If a reminder cannot be shown, a notice comes in its place:
     "Reminders" and "A reminder could not be shown. Open the app to see
     it.", with no title and no buttons.
4. **Intents**, which stay inside the phone. An alarm carries only the
   random ID of its reminder. A tap on a reminder opens Reminders with
   that ID. A button's press goes only to Reminders' own receiver, and
   carries the ID, the button, the reminder's time and, for **Snooze 10
   min**, the 10 minutes. Never a title. Reminders opens Android's own
   pages for its notification settings.
5. **Keys to another app of the suite on the phone**, through the
   handover between apps, as in Water: only when you allow it on
   Reminders' screen and answer the system prompt, only that app's own
   keysets, made from the recovery key Reminders keeps, and only to a
   data app of the suite signed with exactly Reminders' own current
   certificate ([ADR 0041](../adr/0041-the-handover-between-apps.md)).
   The check of four words, and the signature for the Sync app, work as
   in Water. Its status provider says only whether Reminders keeps the
   recovery key now, and the short name of the key its keys come from,
   to such an app and to the Sync app. Reminders takes its own keys
   from a keeper the same way.

Reminders has no network permission. Android backup and device transfer
are off. It writes no file outside its storage but the backup you make,
shares nothing else with other apps, puts nothing on the clipboard itself and
writes no log. The title field offers the usual copy and paste, so a
title you copy goes to the clipboard.

### Not checked in the code

As for Water: the files of AndroidX's profile installer about the app's
start-up profile, and the app's compiled code, which Android keeps. They
hold no user data.

### How to delete it

- In Android's Settings, open **Apps**, then **Reminders**, **Storage**,
  and tap **Clear storage**. Everything above goes, the keys too.
  Uninstalling Reminders does the same.
- Backup files stay where you put them. Delete them there.
- Without the recovery words, nobody can open those backups.

## Tasks (`app.shkriuss.tasks`)

On Tasks' screens you add, change and delete lists and tasks. It stores
them and what this phone remembers of the reminder of each task, shows
the reminder of a task as a notification, and makes and restores
backups, as below.

### On the phone

Everything is in Tasks' private storage, except the keys that the
Android Keystore holds.

| What | Where | What it holds | In a backup |
|---|---|---|---|
| The database `tasks.db` | Tasks' database folder | Two record tables ([spec.md](../apps/tasks/spec.md#data)). `task_list`, one row per list: its name. `task`, one row per task: the random ID of its list, or none for Inbox, its title, its due day, its repeat, its days of the week, the day the repeat counts from, its reminder time and when it was done. Each row also has its random ID, its times and its deletion marker. A deleted list keeps its name and a deleted task its title. The table `change_counter` holds one number. **Text: the names of lists and the titles of tasks.** | `task_list` and `task`: yes, deleted rows too. The change numbers and `change_counter`: no |
| The preferences file `app.shkriuss.tasks` | Tasks' preferences folder | For each task with a reminder, by its random ID: the reminder number its entries were written for (`for.<id>`, made of the due day, the repeat and the reminder time), its mark (`mark.<id>`, a local date and minute), the end of its snooze (`snooze.<id>`) and the time of its notification on screen (`showing.<id>`) ([spec.md](../apps/tasks/spec.md#on-this-phone-only)). IDs, times and numbers only. Never a title or a name. | No |
| The preferences file `app.shkriuss.core.notify` | Tasks' preferences folder | For each alarm, named by the random ID of its task: the time it is set for (`registered:<id>`) and the time it last fired (`fired:<id>`). And `permission-asked`: whether Android's question for notifications was answered ([notifications.md](../architecture/notifications.md#what-goes-where)). IDs and times only. | No |
| The preferences file `app.shkriuss.core.security` | Tasks' preferences folder | Three settings of the app lock: `lock-after` (when it locks), `block-screenshots` and `notification-text` ([ADR 0032](../adr/0032-app-lock-settings-in-android-preferences.md)). Whether the app lock is on is not a setting in this file. It is which hardware key wraps the `file-key` keyset. | No |
| Key files, `shk-keys/` | Tasks' no-backup folder | The keysets `record`, `backup` and `file-key`, each wrapped by a hardware key. `recovery`, the recovery key, only if the phone keeps it, wrapped by a key that needs the system prompt for every use. `file-key-old` only for a moment after a setup was started over. None of them exists before the recovery key is set up ([crypto-design.md](crypto-design.md#where-keys-are-stored)). | No |
| Set-aside key files, `shk-keys-set-aside/` | Tasks' no-backup folder | A copy of a keyset file that could not be read, kept before the file is written again. Still wrapped. | No |
| Hardware keys | The Android Keystore, in StrongBox where the phone has it | Up to four keys per app, which cannot be read out: the Background key, the Unlocked key, the Lock key (while the app lock is on) and the Recovery guard (while the phone keeps the recovery key) ([crypto-design.md](crypto-design.md#hardware-keys)). | No |
| The restore staging folder, `shk-restore/` | Tasks' no-backup folder | Only while a restore runs: the records of the backup, **not encrypted**, names and titles too, so that nothing changes until the whole file is checked. Deleted when the restore ends, well or badly, and again at every start of Tasks. It is an ordinary delete ([backup-format.md](../architecture/backup-format.md#staging)). | Not applicable |

- Tasks stores no files: it never asks `core/crypto` for a file key.
- Android's SQLite keeps the write-ahead files `tasks.db-wal` and
  `tasks.db-shm` next to the database. They can hold rows of it, names
  and titles too, until SQLite writes them into `tasks.db`.

Android also keeps some things for Tasks, outside Tasks' folders:

- The alarm of each task with a reminder to come: its time and the
  random ID of its task. No title.
- A task's notification while it shows, with its title. If the user
  turned on Android's notification history, Android keeps the
  notifications of the last 24 hours there, titles too, also after the
  notification is gone or the task is deleted.
- A picture of Tasks' screen in the recent apps, which can show titles
  and the names of lists. While the app lock is on, or "Hide in recent
  apps and block screenshots" is on, the picture is blank.
- The saved state of Tasks' screen while it waits in the background: the
  place that is open, a part of Licences, the dialog of the form that is
  open, with the date or time in an open picker, and how far each list
  is scrolled. Never a title or a name: the open form, the open list and
  the dialog of a list's name live only while Tasks runs.

The keyboard app sees what is typed into a title or the name of a list,
as in any app. Tasks asks it not to learn them, so that it keeps no
words of them in its own dictionary
(`IME_FLAG_NO_PERSONALIZED_LEARNING`). A keyboard can ignore the request
([threat-model.md](threat-model.md#out-of-scope), point 3).

### What leaves the phone, and how

1. **A backup file**, only when you make one, to the place you pick in
   Android's file picker. That place can be a USB stick or a cloud
   storage app. Tasks suggests the name `tasks-<date>.shkbackup`, for
   example `tasks-2026-11-16.shkbackup`.
   - In the clear, at its start: that it is a backup of the suite, its
     format version, the app name `tasks`, and the short name (key ID)
     of the recovery key it needs
     ([backup-format.md](../architecture/backup-format.md)).
   - Encrypted with the backup key of the recovery key: when it was
     made, Tasks' data version, every record of `task_list` and `task`,
     deleted ones too, with their names and titles, and their counts.
   - Not in it: keys, the recovery key, the three preferences files,
     change numbers.
   - Its size shows roughly how many lists and tasks it holds, and how
     long their names and titles are. The date is in the suggested name.
2. **A restore** reads one file that you pick. It writes nothing outside
   Tasks.

Three more things leave Tasks' storage. They stay inside the phone:

3. **Notifications.** A task's reminder shows its title, and "Due
   today", "Due today · Every day", "Missed: 09:00" or "Snoozed. It was
   due at 09:00.", with the buttons **Done** and **Snooze 10 min**.
   - On the lock screen it is private: Android shows its title only if
     the phone's setting allows it.
   - A task's title and buttons reach another app only if you gave that
     app notification access. Such an app can pass them on to a watch.
   - Tasks does not mark its reminders "local only", as Water and
     Reminders do not ([spec.md](../apps/tasks/spec.md#open), item 3).
   - With the app lock on, a reminder shows only its hidden form: "Task
     reminders" and "The app lock hides this notification. Open the app
     to see it.", without its title and without buttons. Unless **Show
     the text in notifications** is on.
   - If a reminder cannot be shown, a notice comes in its place: "Task
     reminders" and "A reminder could not be shown. Open the app to see
     it.", with no title and no buttons.
4. **Intents**, which stay inside the phone. An alarm carries only the
   random ID of its task. A tap on a reminder opens Tasks with that ID.
   A button's press goes only to Tasks' own receiver, and carries the
   ID, the button, the reminder's time and, for **Done**, the task's
   reminder number, made of its due day, repeat and reminder time, or
   for **Snooze 10 min**, the 10 minutes. Never a title. Tasks opens
   Android's own pages for its notification settings.
5. **Keys to another app of the suite on the phone**, through the
   handover between apps, as in Water: only when you allow it on
   Tasks' screen and answer the system prompt, only that app's own
   keysets, made from the recovery key Tasks keeps, and only to a data
   app of the suite signed with exactly Tasks' own current certificate
   ([ADR 0041](../adr/0041-the-handover-between-apps.md)). The check of
   four words, and the signature for the Sync app, work as in Water.
   Its status provider says only whether Tasks keeps the recovery key
   now, and the short name of the key its keys come from, to such an
   app and to the Sync app. Tasks takes its own keys from a keeper the
   same way.

Tasks has no network permission. Android backup and device transfer
are off. It writes no file outside its storage but the backup you make,
shares nothing else with other apps, puts nothing on the clipboard
itself and writes no log. The title and name fields offer the usual
copy and paste, so a title or a name you copy goes to the clipboard.

### Not checked in the code

As for Water: the files of AndroidX's profile installer about the app's
start-up profile, and the app's compiled code, which Android keeps. They
hold no user data.

### How to delete it

- In Android's Settings, open **Apps**, then **Tasks**, **Storage**,
  and tap **Clear storage**. Everything above goes, the keys too.
  Uninstalling Tasks does the same.
- Backup files stay where you put them. Delete them there.
- Without the recovery words, nobody can open those backups.

## Notes (`app.shkriuss.notes`)

On Notes' screens you write, change and delete notes, and add and
remove files through Android's file picker. It stores them as below,
and makes and restores backups. It shows no notification. When it
starts, it sweeps: it wipes what is still deleted and removes the
streams that no file needs.

### On the phone

Everything is in Notes' private storage, except the keys that the
Android Keystore holds.

| What | Where | What it holds | In a backup |
|---|---|---|---|
| The database `notes.db` | Notes' database folder | Two record tables ([spec.md](../apps/notes/spec.md#data)). `note`, one row per note: its title, its text with its marks, whether it is pinned, and how many times a file of it was added, removed or brought back. `attachment`, one row per file: the random ID of its note, the file's name and type as the picker gave them, its size, and its file key, wrapped by the `file-key` keyset. Each row also has its random ID, its times and its deletion marker. The table `change_counter` holds one number. **Text: the titles and texts of notes, and the names of files.** | `note` and `attachment`: yes, deleted rows too, in their wiped form. The change numbers and `change_counter`: no |
| The streams of the files, `attachments/` | Notes' no-backup folder | One file per attached file, named by the random ID of its record: the file's bytes, **encrypted** with its own random key ([crypto-design.md](crypto-design.md#file-keys)). While a file is added, `<id>.part`, deleted at every start. | Yes, byte for byte, still encrypted: the streams of the files that are not deleted, are on the phone and have the right length |
| The preferences file `app.shkriuss.core.security` | Notes' preferences folder | Two settings of the app lock: `lock-after` (when it locks) and `block-screenshots` ([ADR 0032](../adr/0032-app-lock-settings-in-android-preferences.md)). Notes offers no choice about the text of notifications, so it never writes `notification-text`. Whether the app lock is on is not a setting in this file. It is which hardware key wraps the `file-key` keyset. | No |
| Key files, `shk-keys/` | Notes' no-backup folder | Before the recovery key: `file-key`, one random key that exists only on this phone, made at the first file. With the recovery key: `record`, `backup` and `file-key`, each wrapped by a hardware key, and `file-key-old` until every file key is sealed again ([spec.md](../apps/notes/spec.md#before-the-recovery-key-the-file-key-move)). `recovery`, the recovery key, only if the phone keeps it, wrapped by a key that needs the system prompt for every use ([crypto-design.md](crypto-design.md#where-keys-are-stored)). | No |
| Set-aside key files, `shk-keys-set-aside/` | Notes' no-backup folder | A copy of a keyset file that could not be read, kept before the file is written again. Still wrapped. | No |
| Hardware keys | The Android Keystore, in StrongBox where the phone has it | Up to four keys per app, which cannot be read out: the Background key, the Unlocked key, the Lock key (while the app lock is on) and the Recovery guard (while the phone keeps the recovery key) ([crypto-design.md](crypto-design.md#hardware-keys)). | No |
| The restore staging folder, `shk-restore/` | Notes' no-backup folder | Only while a restore runs: the records of the backup, **not encrypted**, titles, texts and file names too, and the streams of its files, still encrypted with their own keys, so that nothing changes until the whole file is checked. A stream the restore takes moves from here into `attachments/`. The rest is deleted when the restore ends, well or badly, and again at every start of Notes. It is an ordinary delete ([backup-format.md](../architecture/backup-format.md#staging)). | Not applicable |

- **Deleted notes are wiped.** A deleted note keeps its text and its
  files only while its **Undo** is open. Then its title and text, the
  names, types and wrapped keys of its files are cleared in the
  database, and their streams are removed. A removed file is wiped the
  same way. What is left is the deletion marker: the random IDs, the
  times, and for a file the random ID of its note
  ([spec.md](../apps/notes/spec.md#the-wiped-form)). A stop before the
  wipe is mended at the next start. Before a backup, Notes wipes every
  deleted record that is not wiped yet, and makes no backup if it
  cannot, so a backup never holds deleted content.
- `notes.db` is opened with SQLite's `secure_delete` on, so the bytes a
  write clears are written over. Android's SQLite keeps the write-ahead
  files `notes.db-wal` and `notes.db-shm` next to the database. They can
  hold rows, titles, texts and names too, until SQLite writes them into
  `notes.db`. After a wipe, and at every start, Notes moves them into
  `notes.db` and cuts the write-ahead file to zero.
- What a wipe cannot reach: a backup made before it, and old blocks that
  the flash storage keeps, of the streams, of `notes.db` and of its
  write-ahead file, under Android's file-based encryption.
- Nothing Notes decrypts is written anywhere but into a copy the user
  saves: an image is decoded in memory only, at the size it shows at,
  and goes when its row or the image view goes, when the note closes
  and when Notes locks. A search is not stored.

Android also keeps some things for Notes, outside Notes' folders:

- A picture of Notes' screen in the recent apps, which can show titles,
  texts and images. While the app lock is on, or "Hide in recent apps
  and block screenshots" is on, the picture is blank.
- The saved state of Notes' screen while it waits in the background:
  the place that is open, the random IDs of the open note and of the
  file whose image shows or whose copy is being saved, a part of
  Licences, and how far each place is scrolled. Never a title, a text,
  a name or a search: what is typed lives only while Notes runs, and a
  note is saved when Notes leaves the screen.

The keyboard app sees what is typed into a title or a text, as in any
app. Notes asks it not to learn them
(`IME_FLAG_NO_PERSONALIZED_LEARNING`). A keyboard can ignore the request
([threat-model.md](threat-model.md#out-of-scope), point 3).

### What leaves the phone, and how

1. **A backup file**, only when you make one, to the place you pick in
   Android's file picker. That place can be a USB stick or a cloud
   storage app. Notes suggests the name `notes-<date>.shkbackup`, for
   example `notes-2026-11-24.shkbackup`.
   - In the clear, at its start: that it is a backup of the suite, its
     format version, the app name `notes`, and the short name (key ID)
     of the recovery key it needs
     ([backup-format.md](../architecture/backup-format.md)).
   - Encrypted with the backup key of the recovery key: when it was
     made, Notes' data version, every record of `note` and `attachment`,
     deleted ones too in their wiped form, with their titles, texts,
     file names, types, sizes and wrapped file keys, and their counts.
     Then the stream of each file that is not deleted and is whole on
     the phone, byte for byte as stored, still encrypted with its own
     key.
   - Not in it: the keysets, the recovery key, the preferences file,
     change numbers, and the streams of files that are not on the phone
     or are damaged.
   - Its size shows roughly how many notes and files it holds, and how
     large they are: 1 GB of files makes a backup of about 1 GB. The
     date is in the suggested name.
2. **A restore** reads one file that you pick. It writes nothing outside
   Notes.
3. **A copy of a file**, only when you tap **Save a copy**, decrypted,
   byte for byte, to the place you pick in Android's file picker. The
   copy holds all the picked file held, such as where a photo was taken
   ([spec.md](../apps/notes/spec.md#showing-an-image-and-saving-a-copy)).
4. **Keys to another app of the suite on the phone**, through the
   handover between apps, as in Water: only when you allow it on
   Notes' screen and answer the system prompt, only that app's own
   keysets, made from the recovery key Notes keeps, and only to a data
   app of the suite signed with exactly Notes' own current certificate
   ([ADR 0041](../adr/0041-the-handover-between-apps.md)). The
   signature for the Sync app works as in Water. Its status provider
   says only whether Notes keeps the recovery key now, and the short
   name of the key its keys come from, to such an app and to the Sync
   app. Notes takes its own keys from a keeper the same way.

Notes has no network permission and shows no notification. Android
backup and device transfer are off. It writes no file outside its
storage but a backup or a copy you make, shares nothing else with other
apps, puts nothing on the clipboard itself and writes no log. The title,
the text and the search field offer the usual copy and paste, so text
you copy goes to the clipboard.

### How to delete it

- In Android's Settings, open **Apps**, then **Notes**, **Storage**,
  and tap **Clear storage**. Everything above goes, the keys too.
  Uninstalling Notes does the same.
- Backup files and copies stay where you put them. Delete them there.
- Without the recovery words, nobody can open those backups.

## Sync (`app.shkriuss.sync`)

Sync is the only app with the network. It keeps state of this phone
only: no records, no content of any app, no key that opens data and
never the recovery words. Its screens are not built yet; what is below
is what its code stores and sends.

### On the phone

Everything is in Sync's private storage, except the device key, which
the Android Keystore holds.

| What | Where | What it holds | In a backup |
|---|---|---|---|
| The preferences file `app.shkriuss.sync` | Sync's preferences folder | The state of this phone ([spec.md](../apps/sync/spec.md#data)): where the join stands, **the server's address**, the server ID, the epoch and the server's key ID, the account revision, the limits of the server, the number of the device key and the device ID, **this phone's name**, while joining the kind of code and **the setup code**, the addresses whose setup code waits to be deleted from the Worker, the IDs of devices seen as removed, the setting **Files on mobile data**, and for each data app its head on the server, when it last synced, and whether it has sync on, work to do or poked. Times and counts of waits and problems. Never a device code, a record ID or any content of an app. | No: Sync has no backup |
| Key files, `shk-keys/` | Sync's no-backup folder | The name key, as Sync's `record` keyset, wrapped by its Background key ([crypto-design.md](crypto-design.md#the-name-key)). It opens only the names of devices. | No |
| Set-aside key files, `shk-keys-set-aside/` | Sync's no-backup folder | A copy of a keyset file that could not be read, kept before the file is written again. Still wrapped. | No |
| Hardware keys | The Android Keystore, in StrongBox where the phone has it | The device key `shk.device.<number>`, which signs each request and cannot be read out, and the Background key that wraps the name key ([crypto-design.md](crypto-design.md#the-device-key)). | No |
| JobScheduler's two jobs | Android's own storage of jobs | When Sync runs: a periodic job and one soon. No ID, name or address. | No |

- Batches, pages and file chunks pass through Sync's memory and pipes
  only. Sync writes none of them to its storage.
- The setup code is kept from the moment it shows until the join ends
  or is cancelled ([spec.md](../apps/sync/spec.md#decided-by-the-owner),
  point 4). A join left for a day is cancelled at the next start.

### What leaves the phone, and how

| To | What | How |
|---|---|---|
| The user's own server, at the address the user typed | Every request is signed with the device key, and carries the device ID and the phone's clock in its headers. What it sends: the device's public key and its join statement from a data app, a one-time code, **this phone's name sealed** with the name key, **records sealed** by the data apps, **file chunks** as the data apps stored them, encrypted, and which files and devices it asks about. In the clear beside them: each app's name, record IDs, file IDs, numbers and sizes ([sync-protocol.md](../architecture/sync-protocol.md#what-the-server-can-still-learn)). | HTTPS only, through Android's own HTTP client, with the certificate authorities built into Android, no redirect followed, and one fixed `User-Agent`, `shkriuss-sync/1`, so that no request names the phone's model |
| A data app of the suite on this phone, through its courier provider | What Sync last learned of the server: its ID, the epoch, the device ID and the key ID; with `export`, the most records and bytes a batch may hold; the server's whole answer to each batch it sent, with `exported`; pages of sealed records; file chunks | `ContentResolver.call`, with pipes. Sync calls only a data app that passes the check of [ADR 0041](../adr/0041-the-handover-between-apps.md), point 9 |
| A data app of the suite that calls Sync's courier provider | Whether this phone has joined, when a run last ended well for that app, what stops sync now, with the end of the day's wait or the clock's offset from the server's, and whether that app's files wait for a network that is not metered. While **Files on mobile data** is off, the last tells a data app, which has no network permission, whether the phone's network is metered now ([What `state` gives](../architecture/sync-protocol.md#what-state-gives)). | Sync's provider answers only a data app that passes the same check |

- Nothing goes to shkriuss.app, to Google or to anyone else. Sync
  checks versions only with the user's own server.
- A data app gives Sync records only sealed, and keys never
  ([sync-protocol.md](../architecture/sync-protocol.md#the-courier-interface)).

### How to delete it

- In Sync, **Leave the server** removes this phone from the server and
  deletes its keys. Its screens are not built yet.
- In Android's Settings, open **Apps**, then **Sync**, **Storage**, and
  tap **Clear storage**. Everything above goes, the keys too.
  Uninstalling Sync does the same. The server keeps this phone in its
  list of devices until another device removes it.
- What is on the server goes when the user deletes the Worker, its
  database and its bucket in the Cloudflare dashboard.
