# Water changelog

Water (`app.shkriuss.water`) helps you drink enough during the day: log
each drink with one tap, see how close you are to your daily goal, and
get reminders during the hours you choose. Its specification is
[docs/apps/water/spec.md](../../../docs/apps/water/spec.md).

## Unreleased

## 1.0.0 (2026-11-15)

Released as `water-v1.0.0`.

The first release of Water. From pull requests
[36](https://github.com/shkriuss/shkriuss.app/pull/36) (the
specification), [40](https://github.com/shkriuss/shkriuss.app/pull/40)
to [44](https://github.com/shkriuss/shkriuss.app/pull/44), and the pull
request of step 2.6, which set the version and changed nothing else in
the app. How to use it: [Water](../../../docs/user/water.md).

Start:

- Water opens on **Today**, with no setup and no account. The recovery
  key comes only when something needs it: a backup, a restore or the
  app lock.
- Three destinations: **Today**, **History** and **Settings**, in a bar
  along the bottom of a phone, and a rail on a tablet or a phone on its
  side. Each keeps its place when you switch. Back from History or
  Settings goes to Today.

Today:

- The total of today, how much of the goal it is, a progress bar, and
  "Goal reached" with a check once the goal is met.
- Three buttons add a quick amount, such as "+250 ml". **Other amount**
  opens the sheet **Add a drink**. After each new drink, "Added 250 ml"
  offers **Undo**.
- The drinks of today, newest first. At midnight Today moves to the new
  day by itself. On a tablet the drinks are in a pane of their own.
- A reminder line, while reminders are on: when the next reminder comes,
  that the goal is reached, or that none comes today. When notifications
  are not allowed, it says that reminders are silent, with **Allow** or
  **Open settings**.

Add and edit a drink:

- The amount, with the unit after it, and the time. An amount outside 1
  to 3,000 ml, or a time later than now on today, is named and not
  saved.
- A drink's time can be changed, its day cannot. **Delete** offers
  **Undo**.

History:

- One row per day since the first drink, with the total, the goal that
  day had, and "Goal reached". A tap opens the day, where drinks can be
  added and changed. On a tablet the day opens beside the list.
- A change of the goal counts from today. Past days keep theirs.

Settings:

- **Drinking**: the daily goal, the unit (millilitres or US fluid
  ounces) and the three quick amounts. A value outside its limits is
  named in the dialog, which stays open.
- **Reminders**: the switch **Remind me to drink**, **Every** (30
  minutes to 3 hours), **From** and **Until**. "Until" must be at least
  30 minutes after "From". A line says when no reminder fits between
  them.
- **Backup**: **Make a backup** and **Restore a backup**.
- **Security**: **Recovery key** and **App lock**.
- **About**: the version and **Licences**.

Reminders:

- Every interval you chose, between **From** and **Until**, counted
  from your last drink, and none once the goal is met.
- The first time you turn reminders on, Water explains, in the dialog
  "Allow notifications", and then Android asks. **Not now** keeps
  reminders on. After one "no", Water never asks again.
- A reminder says "Time for some water" and today's total and goal.
  **Drank 150 ml** (your first quick amount) logs that drink. **Later**
  reminds you again in 15 minutes. On the lock screen, a button asks you
  to unlock first. A tap opens Today. At midnight the reminder goes
  away.
- A missed reminder, for example while the phone was off, is skipped. A
  reminder whose time came while Android started Water, or in the same
  seconds as a change, still comes, up to a minute late.
- If a reminder cannot be shown, the notice "A reminder could not be
  shown. Open the app to see it." comes in its place, and the next
  reminder still comes.

Backup and restore:

- A backup is one file that you put where you choose, with Android's
  file picker. Water suggests a name such as
  `water-2026-11-13.shkbackup`. It holds the drinks, the goals and the
  settings, and is locked with your recovery key
  ([Back up and restore](../../../docs/user/backup.md)).
- Right after it has written the file, Water reads it again and checks
  it to its last byte. Then it says "Backup written" and how many drinks
  the backup holds, or why the file cannot be used.
- **Restore a backup** checks the whole file first, then asks "Restore
  this backup?", with when the backup was made and how many drinks it
  holds. **Cancel** changes nothing. For every record, the newest edit
  stays.
- When Water does not take a file, it says why, and nothing in Water has
  changed.
- After a restore, the reminders follow the restored data at once.

Recovery key and app lock:

- **Recovery key** opens the security screen ([Your recovery
  key](../../../docs/user/recovery-key.md)). **Make a backup** and **App
  lock** first say "Set up your recovery key first", and **Restore a
  backup** says "Enter your recovery key first". When the key is set up,
  Water goes on by itself with what you tapped.
- With the app lock on, Water asks for your fingerprint, or the phone's
  PIN, pattern or password, before it shows anything. A reminder then
  shows only "Drink reminders" and "The app lock hides this
  notification. Open the app to see it.", with no buttons
  ([The app lock](../../../docs/user/app-lock.md)).

Licences:

- **Licences** lists the seven third-party parts that ship in Water,
  with each one's notice and the full text of its licence
  ([third-party.md](../../../docs/development/third-party.md)).

TalkBack:

- Amounts are read with the unit in words, such as "250 millilitres".
  The summary is one item, and so is each drink and each day of
  History. Section headers are headings.

Permissions and version:

- Five permissions, and no other: `POST_NOTIFICATIONS`, which Android
  asks you for, and `USE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`,
  `USE_BIOMETRIC` and `HIDE_OVERLAY_WINDOWS`, which Android grants at
  install. They are Water's allow list in the APK rules check
  ([permissions.md](../../../docs/security/permissions.md#water-appshkriusswater)).
- No network permission and no storage permission. Android backup and
  device-to-device transfer are off. Only Water's own screen can be
  opened by another app.
- What Water stores, and what leaves the phone:
  [data-inventory.md](../../../docs/security/data-inventory.md#water-appshkriusswater).
- Version code 10000900, from the version code rule in
  [ADR 0021](../../../docs/adr/0021-version-names-and-version-codes.md).
  No earlier version was released.

Inside the APK:

- The seven parts of Licences: the AndroidX libraries, the BIP-39
  English word list, Jetpack Compose and Material 3, the Kotlin standard
  library, kotlinx.coroutines, Tink and the Protocol Buffers inside it.
  R8 removes seven more libraries that Water does not use
  ([third-party.md](../../../docs/development/third-party.md#on-the-class-path-not-in-the-apk)).

Known problems: see
[Known problems](../../../docs/user/water.md#known-problems) in the user
guide.
