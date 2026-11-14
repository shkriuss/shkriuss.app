# Water: specification

What Water does, screen by screen, what it stores, how it reminds, and
what goes into its backup. Steps 2.2 to 2.5 build the app from this page.

- Status: written on 2026-11-13 in Phase 2, step 2.1
  ([PROMPTS.md](../../development/PROMPTS.md#21-specification)). The
  owner answered four questions and added notes on the same day
  ([Decided by the owner](#decided-by-the-owner)). Everything else this
  page chose is listed under [Assumptions](#assumptions). The owner
  accepted them, and the three decision records below, on
  [pull request 36](https://github.com/shkriuss/shkriuss.app/pull/36),
  on 2026-11-13.
- Step 2.2 built the data and the logic on 2026-11-14: the database,
  the rules of this page as plain code, the view models and the backup
  content, in `android/feature/water`, and the app module
  `android/app/water`. The screens come in step 2.3. In the same step the
  owner corrected [rule 3](#when-the-next-reminder-comes), on the snooze
  and a drink ([Decided by the owner](#decided-by-the-owner)).
- If this page is wrong or silent, the fix is a change to this page
  first, agreed with the owner ("If the spec is wrong or silent, stop and
  ask" in the prompt of steps 2.2 to 2.5).
- Package name: `app.shkriuss.water`. App name in keys and backups:
  `water`.
- Three decision records come from this page. The owner accepted all
  three on pull request 36, on 2026-11-13:
  - [0034](../../adr/0034-notification-buttons.md): buttons on
    notifications, for every app.
  - [0035](../../adr/0035-recovery-key-when-first-needed.md): the
    recovery key comes when it is first needed, for every app.
  - [0036](../../adr/0036-app-settings-as-records.md): an app's settings
    are records. It decides point 4 of
    [0004](../../adr/0004-room-on-system-sqlite-no-sqlcipher.md) again.

The page ends with what the owner [decided](#decided-by-the-owner), every
[assumption](#assumptions) and everything still [open](#open).

## What Water is for

Water helps you drink enough during the day: you log each drink with one
tap and see how close you are to your daily goal. It can remind you at a
steady rhythm during the hours you choose, and it keeps everything on
your phone, with no account and no network.

## At a glance

| Part | Choice |
|---|---|
| Screens | Today, History (with one day open), Settings |
| Stored | Drinks, the daily goal, and one settings record, in a Room database |
| Units | Millilitres or US fluid ounces. Stored as whole millilitres. |
| Reminders | Every 30 minutes to 3 hours, between "From" and "Until", counted from your last drink. None once the goal is met. One alarm at a time. |
| Notification buttons | **Drank** (the first quick amount) and **Later** (15 minutes) |
| Missed reminders | Skipped. Never shown late. |
| First start | Straight to Today. No setup. |
| Recovery key | Only when first needed: a backup, a restore, the app lock |
| Backup | Data version 1. Three record types. No files. |
| Permissions | Three from `core/notify`, two from `core/security`. Nothing else. |
| Network | None. Water declares no network permission. |

## Words used on this page

- **Drink.** One amount of water you logged, with its day and time. In
  the code it is an `intake` record.
- **Quick amount.** One of the three amounts on the buttons of Today.
- **Goal.** How much you want to drink in one day.
- **Reminder hours.** From the time "From" to the time "Until", each
  day. Outside them are the quiet hours: no reminder comes then.
- **Interval.** How long Water waits between reminders.
- **Day.** One calendar day of the phone's clock, from midnight to
  midnight.
- **Snooze.** What **Later** sets: one reminder 15 minutes from now.
- **The count.** The moment from which Water counts the interval
  ([When the next reminder comes](#when-the-next-reminder-comes)).

## Screens

### Navigation

1. Water has one activity, `WaterActivity`. Every screen of Water is
   inside `AppLockGate`, inside `ShkTheme`
   ([security-screens.md](../../architecture/security-screens.md#what-an-app-does-for-the-app-lock)).
2. Three destinations, in `ShkNavigationScaffold`:
   - **Today**, the start screen,
   - **History**,
   - **Settings**.
3. Under 600dp they are in a navigation bar along the bottom. From 600dp
   they are in a navigation rail along the start edge
   ([ADR 0024](../../adr/0024-own-adaptive-layouts.md)).
4. Each destination keeps its scroll position and its open day when you
   switch between them.
5. Back from History or Settings goes to Today. Back from Today leaves
   the app.
6. The screens of the recovery key and the app lock are activities of
   `core/security`. Settings opens them
   ([Settings](#settings-screen)).
7. Whether Water uses Navigation 3 for this is [open](#open).

Window widths, as in [ADR 0024](../../adr/0024-own-adaptive-layouts.md):
compact under 600dp (phones), medium from 600dp (small tablets, a phone
on its side), expanded from 840dp (the Pixel Tablet).

### Today

What you see first, every time.

From top to bottom, in one column:

1. **Top bar**: "Today".
2. **Summary**:
   - the total of today, large: "1,250 ml",
   - under it: "of 2,000 ml · 62%",
   - a progress bar, full at 100% and more,
   - when the total reaches the goal: a check icon and the words "Goal
     reached". The words are always there with the icon. Colour is never
     the only sign.
3. **Quick add**: three buttons with the quick amounts, "+150 ml",
   "+250 ml", "+500 ml", and a fourth, "Other amount".
   - A tap on a quick amount logs a drink of that amount, now.
   - "Other amount" opens [Add a drink](#add-a-drink-and-edit-a-drink).
4. **Reminder line**, only while reminders are on. See the table below.
5. **Drinks today**: a section header, then one row per drink, newest
   first. Each row shows the time and the amount: "14:05 · 250 ml". A
   tap opens [Edit a drink](#add-a-drink-and-edit-a-drink).
   - With no drinks: "No drinks yet today."

After each new drink a snackbar says "Added 250 ml", with **Undo**. Undo
marks that drink as deleted.

The reminder line:

| State | The line says | Button |
|---|---|---|
| A reminder is due later today | "Next reminder at 14:30" | None |
| The goal is met | "Goal reached. No more reminders today." | None |
| No reminder fits in the rest of today | "No more reminders today." | None |
| Notifications not asked yet (`NotAsked`) | "Reminders are on, but Water may not show notifications yet." | **Allow**, which starts [the question](#asking-for-notifications) |
| Notifications not allowed (`Denied`) | "Notifications are off for Water. Reminders are silent." | **Open settings**: Android's notification page for Water |
| The channel is off (`ChannelOff`) | "Drink reminders are turned off in Android's settings. Reminders are silent." | **Open settings**: Android's page for the channel |

- The states are the ones of
  [notifications.md](../../architecture/notifications.md#the-permission-and-the-states).
  The screen asks for the state each time it comes to the front.
- `NotAsked` can happen after a restore: the reminders come back on from
  the backup, and Android has not asked yet on this phone.

At midnight, while the screen is open, Today moves to the new day by
itself.

Layout by width:

| Width | Layout |
|---|---|
| Compact | One column that scrolls. The four buttons are two rows of two. At a large font they take one row each. |
| Medium | The same column, with tablet margins. The four buttons are one row, and wrap to more rows when they do not fit. |
| Expanded | Two panes side by side. The start pane holds the summary, the buttons and the reminder line. The end pane holds "Drinks today". Each pane scrolls on its own. |

### Add a drink and edit a drink

One bottom sheet (`ShkBottomSheet`) for both.

**Add a drink** opens from "Other amount" on Today and from "Add a
drink" on a [Day](#day).

1. Title: "Add a drink".
2. **Amount**: a number field, with the unit after it ("ml" or "fl oz").
   Whole numbers only. Empty at the start.
3. **Time**: a row that shows the time, for example "14:05". A tap opens
   `ShkTimePicker`.
   - Today: the time starts at now.
   - Another day: the time starts at 12:00.
4. Buttons: **Save** and **Cancel**.

**Edit a drink** opens from a drink's row.

1. Title: "Edit drink".
2. The same two fields, filled in with the drink.
3. Buttons: **Save**, **Cancel**, and **Delete**.
4. Delete closes the sheet. A snackbar says "Drink deleted", with
   **Undo**. Undo brings the drink back.

Rules:

1. The amount must be from 1 to 3,000 ml (1 to 101 fl oz). Otherwise the
   field says "Enter an amount from 1 to 3,000 ml." under it, in the
   unit shown, and Save does nothing.
2. On today, the time cannot be later than now. The time row then says
   "That time has not come yet." and Save does nothing.
3. The day of a drink cannot be changed. To move a drink to another day,
   delete it and add it on that day.
4. Save with no change closes the sheet and writes nothing.

On every width the sheet is a bottom sheet. From 600dp it is no wider
than the design system's sheet allows.

### History

One row per day, newest first: every day from the day of your first
drink to today. Days with no drink are rows too, with "0 ml".

Each row shows:

- the day: "Today", "Yesterday", or the weekday and date in the phone's
  format, such as "Thu, 12 Nov",
- under it, the total and that day's goal: "1,800 of 2,000 ml",
- at the end, when the goal was met: a check icon and "Goal reached".

A tap opens that [Day](#day).

With no drink ever: "No history yet. The drinks you log show here."

Layout by width:

| Width | Layout |
|---|---|
| Compact and medium | One pane. A tap opens the day in place of the list, with Back in its top bar. Back returns to the list, at the same place. |
| Expanded | `ShkListDetailScaffold`: the list, 360dp wide, and the open day beside it. With no day open, the second pane says "Choose a day." |

### Day

One day from History, today included.

1. Top bar: the full date, for example "Thursday, 12 November 2026", or
   "Today".
2. The same summary as Today, with the goal of that day.
3. A button **Add a drink**, which opens
   [Add a drink](#add-a-drink-and-edit-a-drink) for that day.
4. The drinks of that day, newest first, as on Today. A tap edits a
   drink.
5. The same snackbars as Today after a new drink or a delete.

The goal shown is the goal that day had
([The goal of a day](#the-goal-of-a-day)). A change of the goal never
changes how a past day looks.

### Settings screen

One column of list items under section headers. Each item shows its
current value under its name. A tap opens a dialog, unless it is said
otherwise below.

**Drinking**

| Item | Shows | Opens |
|---|---|---|
| Daily goal | "2,000 ml" | A dialog with a number field. Under it: "The new goal counts from today. Past days keep theirs." |
| Unit | "Millilitres (ml)" | A dialog with two choices: "Millilitres (ml)" and "US fluid ounces (fl oz)" |
| Quick amounts | "150 ml, 250 ml, 500 ml" | A dialog with three number fields: "First", "Second", "Third". Under them: "The first amount is also the one that a reminder's Drank button adds." |

- The daily goal is from 500 to 10,000 ml (17 to 338 fl oz). Otherwise
  the field says "Enter a goal from 500 to 10,000 ml." under it, in the
  unit in use: "Enter a goal from 17 to 338 fl oz." The dialog keeps the
  old goal. The owner decided the words on pull request 40.
- Setting the goal to the value today already has writes nothing
  ([Changing the goal](#the-goal-of-a-day)).

**Reminders**

| Item | Shows | Opens |
|---|---|---|
| Remind me to drink | A switch | Nothing. The switch turns reminders on and off. Turning it on may start [the question](#asking-for-notifications). |
| Every | "1 hour" | A dialog with six choices: 30 minutes, 45 minutes, 1 hour, 1 hour 30 minutes, 2 hours, 3 hours |
| From | "08:00" | `ShkTimePicker` |
| Until | "22:00" | `ShkTimePicker` |

- Under these items, while reminders are on: the same line and button as
  the [reminder line of Today](#today), for the four states of the
  notification permission.
- "Every", "From" and "Until" can be changed while reminders are off.
- "Until" must be at least 30 minutes after "From". A change of "Until",
  or a change of "From", that would leave less than 30 minutes between
  them is refused: the picker's dialog says "Until must be at least 30
  minutes after From." and keeps the old time. The owner accepted the
  rule for "From" on pull request 40.
- When no reminder fits between "From" and "Until" (the interval is
  longer than the hours), a line says: "No reminder fits between From and
  Until. Choose a shorter interval or longer hours." It does not block
  the change.

**Backup**

| Item | Opens |
|---|---|
| A note, only while the app has no recovery key | Nothing. It is text, not a button ([The recovery key when first needed](#the-recovery-key-when-first-needed)). |
| Make a backup | The first-need dialog if there is no recovery key, otherwise Android's "create document" screen ([Backup and restore screens](#backup-and-restore-screens)) |
| Restore a backup | The first-need dialog if there is no recovery key, otherwise Android's "open document" screen |

**Security**

| Item | Shows | Opens |
|---|---|---|
| Recovery key | "Not set up", "Setup not finished", or "Set up" | The security screen of `core/security` (`SecurityScreens.securityIntent`), always |
| App lock | "Off" or "On" | The first-need dialog if there is no recovery key, otherwise the app lock screen (`SecurityScreens.appLockIntent`) |

**About**

| Item | Shows | Opens |
|---|---|---|
| Version | "1.0.0" | Nothing |
| Licences | | The [Licences](#licences) screen |

Layout: one column on every width, in the screen margins of the design
system. Dialogs are `ShkDialog`s.

### Asking for notifications

When you turn on "Remind me to drink", or tap **Allow** on the reminder
line, and Android has not asked yet (`NotAsked`):

1. A dialog explains: "Water reminds you with a notification. Android
   asks next whether Water may show notifications." Buttons:
   **Continue** and **Not now**.
2. **Continue** starts Android's own question for
   `Notify.PERMISSION`. When the answer is in, Water calls
   `notify.permissionAnswered()`.
3. **Not now** closes the dialog. The switch stays on, and the line says
   that notifications are not allowed yet.

After one "no", Water never asks again. The line offers **Open
settings** instead, as
[notifications.md](../../architecture/notifications.md#the-permission-and-the-states)
says.

### Backup and restore screens

Step 2.5 builds them with `core/backup`. This page fixes what they do.
Their exact words are written in step 2.5.

Make a backup:

1. With no recovery key: the
   [first-need dialog](#the-recovery-key-when-first-needed).
2. Android's "create document" screen opens, with the suggested name,
   for example `water-2026-11-13.shkbackup`
   ([backup-format.md](../../architecture/backup-format.md#the-system-file-picker)).
3. While it writes: a dialog with a progress circle, "Writing the
   backup".
4. At the end: a dialog that says the backup is written, and how many
   drinks it holds. Or one of the answers of
   [backup-format.md](../../architecture/backup-format.md#the-answers),
   in the words of [backup.md](../../user/backup.md).

Restore a backup:

1. With no recovery key: the first-need dialog, in its form for a
   restore.
2. Android's "open document" screen opens.
3. Water checks the whole file first: "Checking the backup".
4. A dialog asks: "Restore this backup?" It shows when the backup was
   made and how many drinks it holds. It says: "A restore cannot undo a
   deletion or an edit you made after the backup." Buttons: **Restore**
   and **Cancel**.
5. At the end: "Backup restored", or the answer.

When Water checks a backup it has just written is [open](#open), for
step 2.5.

### Licences

A list of every third-party part that ships in Water, by name. A tap
shows its notice in full. Step 2.5 fills it from
[third-party.md](../../development/third-party.md).

### Every screen

1. Light theme and the true-black dark theme. No dynamic colour.
2. Orientation is never locked. Turning the phone keeps what you typed.
3. At font scale 2.0, text wraps and nothing is cut or covered. Buttons
   wrap to more rows. No row has a fixed height.
4. Every touch target is at least 48dp.
5. Every text is a string resource. Amounts and counts use plurals.
6. Screenshot tests for every screen and dialog: phone and tablet, light
   and dark, font scale 1.0 and 2.0.

## Data model

### The database

1. One Room database, `water.db`, version 1, built with
   `systemSqliteDatabaseBuilder` ([data.md](../../architecture/data.md)).
2. Three record tables, `intake`, `goal` and `settings`, and the table
   `change_counter`.
3. Every record table has the record fields `id`, `createdAt`,
   `updatedAt`, `deletedAt` and the local `changeNumber`, with its unique
   index.
4. All writes go through one `RecordWriter` per table. Deleting only
   marks. Nothing is ever purged in version 1.0.
5. Every read that shows records filters out deleted ones.

### Table `intake`

One row per drink.

| Column | SQL type | What it holds | Limits |
|---|---|---|---|
| `amountMl` | `INTEGER NOT NULL` | The amount, in whole millilitres | 1 to 3,000 |
| `day` | `INTEGER NOT NULL` | The day of the drink: days since 1970-01-01 (`LocalDate.toEpochDay`) | Any day |
| `minuteOfDay` | `INTEGER NOT NULL` | The time of the drink: minutes after midnight | 0 to 1439 |

- Index on `day`, for the total of one day.
- Day and time are stored as the phone's clock showed them when you
  logged the drink, or as you set them. They are not a moment in UTC. So
  after a trip to another time zone, your history stays as you saw it.
- A drink logged now takes today's day and the current minute.
- Order within a day: by `minuteOfDay`, newest first, then by
  `createdAt`.

### Table `goal`

One row per change of the goal.

| Column | SQL type | What it holds | Limits |
|---|---|---|---|
| `amountMl` | `INTEGER NOT NULL` | The daily goal, in whole millilitres | 500 to 10,000 |
| `fromDay` | `INTEGER NOT NULL` | The first day this goal counts for, as `intake.day` | Any day |

#### The goal of a day

1. Take the goals that are not deleted and whose `fromDay` is that day or
   earlier.
2. The one with the latest `fromDay` counts. If two have the same
   `fromDay`, the one with the later `updatedAt` counts. If they also
   have the same `updatedAt`, the one with the larger `id` counts, until
   step 5.1 decides ties ([Open](#open), item 7). Only a restore or sync
   can bring such a tie.
3. If there is none, the goal is 2,000 ml.

Changing the goal:

1. If the goal that counts for today has `fromDay` today, it is updated.
2. Otherwise a new goal is created with `fromDay` today.
3. So a change counts from today, and past days keep the goal they had.
4. Setting the goal to the value that today's goal already has writes
   nothing. The owner accepted this on pull request 40.

### Table `settings`

The settings that belong to your data
([ADR 0036](../../adr/0036-app-settings-as-records.md)).

| Column | SQL type | What it holds | Limits |
|---|---|---|---|
| `unit` | `INTEGER NOT NULL` | 0 for millilitres, 1 for US fluid ounces | 0 or 1 |
| `cup1Ml` | `INTEGER NOT NULL` | The first quick amount, in millilitres | 1 to 3,000 |
| `cup2Ml` | `INTEGER NOT NULL` | The second quick amount | 1 to 3,000 |
| `cup3Ml` | `INTEGER NOT NULL` | The third quick amount | 1 to 3,000 |
| `remindersOn` | `INTEGER NOT NULL` | 1 if reminders are on, 0 if not | 0 or 1 |
| `intervalMinutes` | `INTEGER NOT NULL` | The interval | 30, 45, 60, 90, 120 or 180 |
| `fromMinute` | `INTEGER NOT NULL` | "From", in minutes after midnight | 0 to 1409 |
| `untilMinute` | `INTEGER NOT NULL` | "Until", in minutes after midnight | `fromMinute` + 30 to 1439 |

#### The settings in use

1. The settings in use are those of the record that is not deleted and
   has the latest `updatedAt`. Of two with the same `updatedAt`, the one
   with the larger `id` counts, until step 5.1 decides ties
   ([Open](#open), item 7).
2. With no such record, the defaults count: millilitres, 150, 250 and
   500 ml, reminders off, every 60 minutes, from 08:00 until 22:00.
3. The first change in Settings creates the record, with the defaults
   and that change. Every later change updates the record in use.
4. Water never deletes a settings record.
5. Why this rule: a restore, or later sync, can bring a second settings
   record with another `id`. The newest edit then counts, as for every
   other record ([backup-format.md](../../architecture/backup-format.md#the-restore-rule)).

### On this phone only

Some state belongs to this phone and is not your data. It is not a
record, not in a backup and will not be synced
([ADR 0036](../../adr/0036-app-settings-as-records.md), point 3).

| What | Where |
|---|---|
| The bookkeeping of reminders: when the last reminder was shown, when **Later** was last pressed, the time of a snooze, and which reminder is showing now | One small file of Android's preferences, `app.shkriuss.water`, in Water's private storage. Times only. No amount and no text. |
| The alarms that are registered | `core/notify`'s own file ([notifications.md](../../architecture/notifications.md#what-goes-where)) |
| The three settings of the app lock | `core/security`'s own file ([ADR 0032](../../adr/0032-app-lock-settings-in-android-preferences.md)) |
| Keys | `core/crypto` ([crypto-design.md](../../security/crypto-design.md#where-keys-are-stored)) |

### Files

Water stores no files and has no table with a wrapped file key.

1. Water never asks `core/crypto` for a file key.
2. A start over after a setup that stopped can still leave the keyset
   `file-key-old`. Until it is gone, `core/crypto` refuses a backup
   ("not ready") and the app lock
   ([crypto-design.md](../../security/crypto-design.md#the-file-key-keyset-without-a-recovery-key)).
3. So when Water starts, and when it comes back from a screen of
   `core/security`, it asks `fileKeyMoveIsPending()`. If that is true and
   the app has its keys from a recovery key, it calls
   `finishFileKeyMove()` at once. No row of Water holds a file key, so
   there is nothing to move.
4. **Only because Water stores no files.** Water may finish a pending
   move at once only because no row of Water holds a wrapped file key. A
   later version of Water that stores files must take this call out
   first. It must seal every file key again under the new `file-key`, as
   [crypto-design.md](../../security/crypto-design.md#the-file-key-keyset-without-a-recovery-key)
   says, before it calls `finishFileKeyMove()`. Otherwise the files
   sealed with the old key can never be opened again: they are lost.
5. The code carries the same warning, as a comment on the call to
   `finishFileKeyMove()` (step 2.5).

## Units

1. Two units: **millilitres** (ml), the default, and **US fluid ounces**
   (fl oz).
2. Every amount is stored in whole millilitres. The unit changes only
   what is shown and how amounts are typed.
3. 1 US fluid ounce is 29.5735295625 ml.
4. Shown amounts are whole numbers, rounded to the nearest. 2,000 ml
   shows as 68 fl oz.
5. A typed amount in fluid ounces is turned into millilitres and rounded
   to the nearest millilitre: 8 fl oz is stored as 237 ml. It shows as 8
   fl oz again.
6. Numbers are written in the phone's number format, for example
   "1,250".
7. Limits in each unit:

   | What | Millilitres | US fluid ounces |
   |---|---|---|
   | One drink, one quick amount | 1 to 3,000 | 1 to 101 |
   | Daily goal | 500 to 10,000 | 17 to 338 |

8. The percentage is the total divided by the goal, times 100, rounded
   down: 1,250 of 2,000 ml is 62%. It can pass 100%.
9. Defaults of the quick amounts: 150, 250 and 500 ml, or 5, 8 and 16 fl
   oz (148, 237 and 473 ml). When you change the unit and all three
   quick amounts are still the defaults of the old unit, they become the
   defaults of the new one. Amounts you chose yourself stay as they are.
10. Times are shown in the phone's 12-hour or 24-hour format.
11. A day starts at midnight on the phone's clock.

## Reminders

### What you set

In Settings: "Remind me to drink" (off at the start), "Every", "From"
and "Until" ([Settings](#settings-screen)).

### When the next reminder comes

Water keeps one alarm at a time, with the id `next-drink`. Every change
moves it.

The rule:

1. **The count** starts at the latest of these four, all of today:
   - "From",
   - the time of your latest drink,
   - the time the last reminder was shown,
   - the time you last pressed **Later**.
2. **The next reminder** is the first of "the count + 1 interval",
   "the count + 2 intervals", and so on, that is later than now.
3. **A snooze comes first, while Later is the latest.** A snooze holds
   only while the press of **Later** is still the latest of the four.
   While it holds and its time is later than now, the next reminder is
   at the snooze time.
   - A drink timed at or after the press of **Later** ends the snooze.
     The drink is then the latest of the four, so the next reminder is 1
     interval after it.
   - A drink entered with an earlier time does not end it. The press of
     **Later** is still the latest.
   - The owner decided this in step 2.2, on 2026-11-14
     ([Decided by the owner](#decided-by-the-owner)).
4. **Only inside the reminder hours, and only until the goal is met.**
   If the next reminder would come after "Until", or today's goal is met,
   there is no more reminder today. The next one is tomorrow at "From" +
   1 interval.
5. Reminders off: no alarm.
6. If "From" + 1 interval is after "Until", no reminder fits on any
   day: no alarm. Settings says so.

"The time of your latest drink" is the latest `minuteOfDay` among
today's drinks that are not deleted, as you entered it. A reminder
shown, or a **Later** pressed, counts only if it was today.

Each case, with reminder hours from 08:00 until 22:00 and every hour:

| Case | The next reminder | Example |
|---|---|---|
| The start of reminder hours, no drink since then | "From" + 1 interval | 09:00 |
| A drink is logged: on Today, on a Day, with **Drank**, or by an edit | 1 interval after the drink, if it is now the latest of the four | A drink at 10:20: next at 11:20 |
| A drink is logged with an earlier time | The count does not move back: the latest of the four still counts | At 11:00 you add a drink for 09:30. The last reminder was at 10:30. Next at 11:30. |
| The latest drink is deleted, or its time is made earlier | The count falls back to the latest of the four that is left | |
| A reminder is shown and not answered, or swiped away | 1 interval after that reminder. It replaces the old notification. | Shown at 11:20: next at 12:20 |
| **Later** at time t | t + 15 minutes. If that reminder is not answered either, 1 interval after it. | **Later** at 12:22: next at 12:37, then 13:37 |
| A drink timed at or after the press of **Later**, while a snooze is set | The snooze ends. 1 interval after the drink. | **Later** at 12:22, then a drink at 12:30: no reminder at 12:37, next at 13:30 |
| A drink entered with an earlier time, while a snooze is set | The snooze holds: the press of **Later** is still the latest of the four. After the snooze, 1 interval after it. | **Later** at 12:22, then at 12:25 you add a drink for 11:00: next at 12:37, then 13:37 |
| **Later** when t + 15 minutes is after "Until" | No snooze. The count moves to t, and t + 1 interval is after "Until" too, so none today. Tomorrow at "From" + 1 interval. | **Later** at 21:50: next tomorrow at 09:00 |
| The next time is after "Until" | None today. Tomorrow at "From" + 1 interval. | Last drink at 21:30: next tomorrow at 09:00 |
| The goal is met | None today. Tomorrow at "From" + 1 interval. The shown reminder is removed. | |
| A drink is deleted or changed, and the goal is no longer met | The rule again, from now | |
| A restart of the phone | Nothing before the first unlock ([ADR 0010](../../adr/0010-exact-alarms-and-reminder-storage.md)). After the unlock, reminders whose time passed are skipped, and so is a snooze whose time passed. The next one is the first "the count + n intervals" after the unlock. | Last reminder at 10:00, phone off from 10:30 to 12:20: no reminder at 11:00 or 12:00, next at 13:00 |
| Water was stopped with **Force stop** | The same as a restart, from the moment Water is opened again | |
| Reminders turned on, or "Every", "From" or "Until" changed | The rule again, from now | Turned on at 14:10, last drink at 13:50: next at 14:50 |
| The time zone or the clock changed | The rule again, in the new local time | |
| Midnight | A new day: the count starts at "From" of the new day | |

"Answered" means **Drank**, **Later**, or a drink logged in the app.
Tapping the notification opens Today. It removes the notification and
does not move the count.

### What a reminder shows

1. Title: "Time for some water".
2. Text: today's total and goal, in your unit: "1,250 of 2,000 ml today".
3. Two buttons: **Drank 250 ml** and **Later**
   ([Buttons](#buttons-on-a-reminder)).
4. A tap opens Water on Today.
5. One reminder at a time. A new one replaces the old one.
6. The reminder is removed when:
   - a drink is logged anywhere,
   - reminders are turned off,
   - the goal is met,
   - midnight comes. Android's notification timeout removes it, so
     yesterday's numbers never show as today's.
7. While the app lock hides the text of notifications, the reminder
   shows only the channel's name and the fixed text of `core/notify`,
   and no buttons
   ([notifications.md](../../architecture/notifications.md#while-the-app-lock-is-on)).

The channel:

| Field | Value |
|---|---|
| Id | `drink-reminders`. It never changes. |
| Name | "Drink reminders" |
| Description | "Reminds you to drink during the hours you choose." |
| Importance at the start | Default: with sound. You can change it in Android's settings. |

### Buttons on a reminder

Two buttons. They follow
[ADR 0034](../../adr/0034-notification-buttons.md), which sets the same
rules for every app.

**Drank 250 ml**:

1. Logs one drink of the amount on the button, now (today's day, the
   current minute).
2. The amount is the first quick amount at the moment the reminder was
   shown, in the unit of that moment. If you change your quick amounts
   later, the reminder already shown still logs what its button says.
   The next reminder shows the new first amount.
3. Removes the reminder. The next one comes 1 interval later, or none
   if the goal is now met.

**Later**:

1. Sets a snooze 15 minutes from now. If that is after "Until", it sets
   no snooze, and no more reminder comes today.
2. Moves the count to now, and removes the reminder.
3. 15 minutes later the reminder comes again, with the numbers of that
   moment.

Rules for both:

1. **On the lock screen**, a button first asks you to unlock the phone.
   Without the unlock it does nothing. Android does this
   (`setAuthenticationRequired`).
2. **While the app lock hides the text**, the reminder has no buttons.
   When the app lock hides a reminder that is already showing, its
   buttons go with the text. A tap opens Water behind its lock screen.
3. **While the app lock is on and the text is shown** (the switch "Show
   the text in notifications" on the app lock screen is on), the
   buttons work without the app lock's prompt. They change records,
   which need no prompt, and the phone must be unlocked
   ([crypto-design.md](../../security/crypto-design.md#what-works-while-an-app-is-locked)).
4. **Each button works once**, and only while its reminder is the one
   showing. A press on an older reminder only removes it.
5. **No undo in the notification.** A drink logged with **Drank** is an
   ordinary drink. It is at the top of Today's list at once. To undo it:
   1. Open Water. Today shows the drink at the top, with its time.
   2. Tap it.
   3. Tap **Delete**. The snackbar offers **Undo** if you deleted the
      wrong one.
6. The button sends its press to a receiver of Water that is not
   exported. The press carries the action, the time of the reminder and,
   for **Drank**, the amount in millilitres. No text.

### Missed reminders

The owner decided: a missed reminder is skipped, never shown late.

1. A reminder whose time passed while the phone was off, before the
   first unlock after a restart, while Water was force-stopped, or while
   its profile or Private Space was stopped, is not shown later.
2. The next reminder comes at the time the rule gives after the phone
   is back ([the table](#when-the-next-reminder-comes)).
3. So right after you unlock the phone, no old reminder appears.

What happens in the seconds when an alarm is due and Water moves the
alarm at the same moment is [open](#open), for step 2.4.

### How Water uses `core/notify`

As [notifications.md](../../architecture/notifications.md#what-an-app-does)
says:

1. The app class is a `NotifyHost` and builds one `Notify` with the
   channel `drink-reminders`, an `AlarmSource`, an `AlarmHandler`,
   `Clock.System`, and `hidesText = appLock::hidesNotificationText`.
2. **`AlarmSource`**: names `next-drink` at the time of
   [the rule](#when-the-next-reminder-comes), or nothing. It never names
   a time in the past.
3. **`AlarmHandler`**, when `next-drink` fires at its time T:
   1. If reminders are off, or today's goal is met, or T is outside
      today's reminder hours: it shows nothing.
   2. Otherwise it shows the reminder, and writes into the phone-only
      file: last reminder shown at T, the reminder showing now is T, no
      snooze.
   3. Doing it twice gives the same result: the same notification key,
      the same values.
4. Water calls `notify.sync()` after every change that can move the
   alarm:
   - a drink added, changed, deleted or brought back,
   - a goal or setting changed,
   - a button pressed,
   - a restore.
5. What the user sees when the handler fails is [open](#open), for
   step 2.4.

The limits of Android (after a restart, Private Space, other profiles,
force stop) are the ones in [reminders.md](../../user/reminders.md).

## Settings

Every setting, its default, and where it is kept.

| Setting | Default | Choices or limits | Kept in | In a backup |
|---|---|---|---|---|
| Daily goal | 2,000 ml | 500 to 10,000 ml | `goal` | Yes |
| Unit | Millilitres | Millilitres, US fluid ounces | `settings` | Yes |
| Quick amounts | 150, 250, 500 ml | 1 to 3,000 ml each | `settings` | Yes |
| Remind me to drink | Off | On, off | `settings` | Yes |
| Every | 1 hour | 30 min, 45 min, 1 h, 1 h 30 min, 2 h, 3 h | `settings` | Yes |
| From | 08:00 | Any minute, up to 23:29 | `settings` | Yes |
| Until | 22:00 | At least 30 minutes after "From", up to 23:59 | `settings` | Yes |
| App lock, its timer, "Show the text in notifications", "Hide in recent apps and block screenshots" | Off | As in [app-lock.md](../../user/app-lock.md) | `core/security`'s file | No |
| Reminder bookkeeping | | | Water's phone-only file | No |

- A change takes effect at once. There is no Save button in Settings.
- A setting that comes back with a restore follows the restore rule:
  the newest edit wins ([The settings in use](#the-settings-in-use)).
- Reminder hours cannot cross midnight. "Until" is on the same day as
  "From".

## The recovery key when first needed

The owner decided: Water opens straight on Today, and the recovery key
comes only when something needs it. This is the rule for every app, in
[ADR 0035](../../adr/0035-recovery-key-when-first-needed.md).

Logging drinks, reminders and everything on Today and History need no
recovery key. Three things do:

- making a backup,
- restoring a backup,
- turning on the app lock.

### At the first start

1. Water opens on Today, with the defaults. No welcome screen, no setup.
2. Nothing outside Settings mentions the recovery key.

### What Settings shows before it

| Where | No recovery key | A setup that stopped | Set up |
|---|---|---|---|
| Backup, at the top | A note: "Backups are locked with a recovery key. You set it up when you make your first backup." | A note: "Finish setting up your recovery key to make backups." | No note |
| Security, "Recovery key" | "Not set up" | "Setup not finished" | "Set up" |
| Security, "App lock" | "Off" | "Off" | "Off" or "On" |

- "Make a backup" and "Restore a backup" stay enabled. They lead to the
  dialog below.
- "Recovery key" always opens the security screen, where the key can
  also be created at any time.

### What you see at that moment

**Make a backup** or **App lock**, with no recovery key:

1. A dialog, "Set up your recovery key first":
   - For a backup: "A backup is locked with your recovery key: 24 words
     that you write on paper. Only these words open your backups, on
     this phone or on a new one. If you lose them, nobody can open your
     backups."
   - For the app lock: "The app lock needs your recovery key: 24 words
     that you write on paper. They are the way back in if the app lock
     cannot be opened."
2. Buttons:
   - **Create a recovery key**: opens "Create your recovery key"
     (`SecurityScreens.createIntent`).
   - **I already have one**: opens "Enter your recovery key"
     (`SecurityScreens.enterIntent`). For example, words you made in
     another app of the suite, or on your old phone.
   - **Not now**: closes the dialog.

**Restore a backup**, with no recovery key:

1. A dialog, "Enter your recovery key first": "A backup opens only with
   the 24 words of the recovery key it was made with."
2. Buttons: **Enter the words** (`SecurityScreens.enterIntent`) and
   **Cancel**.
3. There is no "create" here: a new recovery key can never open an old
   backup.

**Any of the three**, after a setup that stopped:

1. A dialog, "Finish your recovery key": "Setting up your recovery key
   did not finish."
2. Buttons: **Open the security screen** (`SecurityScreens.securityIntent`),
   which offers to finish or start over, and **Not now**.

After the flow:

1. When the flow ends and the app has its keys from a recovery key,
   Water goes on with what you started, without another tap:
   - Make a backup: Android's "create document" screen.
   - Restore a backup: Android's "open document" screen.
   - App lock: the app lock screen.
2. When you leave the flow before the end, you are back in Settings and
   nothing else happens. Settings shows the new state.
3. Before it goes on, Water finishes a pending file key move
   ([Files](#files)).

Step 2.5 builds the dialog, its words and the "go on after" once, in
`core/security`, so every app shows the same. Water passes which of the
three it is for.

## Backup contents

Water follows [backup-format.md](../../architecture/backup-format.md).
This section is the part that the format leaves to each app.

### The data version

**Water writes data version 1.** It reads data version 1.

Water raises it, as
[backup-format.md](../../architecture/backup-format.md#the-data-version)
says, when an older Water could not use what a newer one writes: a new
record type, a changed content, or wider limits for a value.

### Record types

| Type name | Table | Content length |
|---|---|---|
| `intake` | `intake` | 12 bytes |
| `goal` | `goal` | 8 bytes |
| `settings` | `settings` | 26 bytes |

- The four record fields travel in the container, as for every app. The
  content holds the other columns.
- Every number is big-endian. "int32" is a signed 32-bit number. A flag
  or a unit is one byte.
- Deleted records are in the backup too, with their full content.

### Content of `intake`

| Offset | Size | Content |
|---|---|---|
| 0 | 4 | `amountMl`, int32, 1 to 3,000 |
| 4 | 4 | `day`, int32, days since 1970-01-01 |
| 8 | 4 | `minuteOfDay`, int32, 0 to 1439 |

Example: 250 ml on 2026-11-13 at 14:05.

```text
000000fa 00005122 0000034d
```

### Content of `goal`

| Offset | Size | Content |
|---|---|---|
| 0 | 4 | `amountMl`, int32, 500 to 10,000 |
| 4 | 4 | `fromDay`, int32, days since 1970-01-01 |

Example: 2,500 ml from 2026-11-13.

```text
000009c4 00005122
```

### Content of `settings`

| Offset | Size | Content |
|---|---|---|
| 0 | 1 | `unit`: `00` millilitres, `01` US fluid ounces |
| 1 | 4 | `cup1Ml`, int32, 1 to 3,000 |
| 5 | 4 | `cup2Ml`, int32, 1 to 3,000 |
| 9 | 4 | `cup3Ml`, int32, 1 to 3,000 |
| 13 | 1 | `remindersOn`: `00` off, `01` on |
| 14 | 4 | `intervalMinutes`, int32: 30, 45, 60, 90, 120 or 180 |
| 18 | 4 | `fromMinute`, int32, 0 to 1409 |
| 22 | 4 | `untilMinute`, int32, `fromMinute` + 30 to 1439 |

Example: fluid ounces, quick amounts 148, 237 and 473 ml, reminders on,
every 90 minutes, from 07:30 until 21:00.

```text
01 00000094 000000ed 000001d9 01 0000005a 000001c2 000004ec
```

### Writing

1. `BackupContent.dataVersion` is 1.
2. `list` gives every record of the three tables, deleted ones too,
   each once. The order of the tables does not matter.
3. Water lists no files, and tells the backup it left out 0 files.

### Reading data version 1

Water's `restore` takes the records in one write transaction, through
`RecordWriter.takeFromBackup`. It stops, and the transaction rolls back
so that nothing changes, when it meets:

1. a type name other than the three,
2. a content of another length than its type's,
3. a value outside its limits in the tables above,
4. a File entry. Water has no files.

This is the third failure of
[backup-format.md](../../architecture/backup-format.md#the-answers): "the
app's own code that fails while it takes the records". The screen says
that this backup holds something this version of Water cannot read.

### Not in a backup

- The phone-only file of reminder bookkeeping, `core/notify`'s file and
  the app lock's file ([On this phone only](#on-this-phone-only)).
- Keys and the recovery key
  ([backup-format.md](../../architecture/backup-format.md#what-an-app-puts-in)).
- Change numbers.

### After a restore

1. Water calls `notify.sync()`. The reminders follow the settings in use
   at once.
2. Today and History show the restored drinks at once: their screens
   read the database through flows.
3. If the backup turned reminders on and Android has not asked on this
   phone yet, the reminder line says so and offers **Allow**.

### Size

A drink takes 39 + 6 + 12 = 57 bytes in the body. Ten drinks a day for
a year is about 208 KB, before the 16 bytes per MiB of the stream.
Backups of Water are small. Progress and a backup while the screen is
off do not matter for Water.

## Permissions

| Permission | From | Why |
|---|---|---|
| `android.permission.POST_NOTIFICATIONS` | `core/notify` | To show reminders. The user allows it or not. |
| `android.permission.USE_EXACT_ALARM` | `core/notify` | To remind at the exact minute ([ADR 0010](../../adr/0010-exact-alarms-and-reminder-storage.md)) |
| `android.permission.RECEIVE_BOOT_COMPLETED` | `core/notify` | To set the alarm again after a restart |
| `android.permission.USE_BIOMETRIC` | `core/security` | The system prompt of the app lock and the recovery key ([ADR 0031](../../adr/0031-use-biometric-for-the-system-prompt.md)) |
| `android.permission.HIDE_OVERLAY_WINDOWS` | `core/security` | To hide other apps' windows over the security screens ([ADR 0033](../../adr/0033-hide-overlay-windows-for-the-security-screens.md)) |

1. No other permission. No network permission (hard rule 4). No storage
   permission: backups go through the system pickers.
2. `app.shkriuss.water.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, which
   `androidx.core` adds, is removed in Water's manifest, as Catalog does
   ([permissions.md](../../security/permissions.md#catalog-appshkriusscatalog)).
3. Android backup and device-to-device transfer are turned off. The
   backup file is the only backup ([backup.md](../../user/backup.md)).
4. Exported: only `WaterActivity`, the launcher screen.
   `androidx.profileinstaller` adds a receiver that is exported to callers
   with `android.permission.DUMP`, for developer tools. Water's manifest
   removes it (owner's decision on pull request 40). The start-up profile
   is still installed when the app starts.
5. Receivers, none exported:
   - the two of `core/notify`,
   - a third one for the buttons of a notification, which step 2.4 adds
     to `core/notify` ([ADR 0034](../../adr/0034-notification-buttons.md)),
   - the screen-off receiver of the app lock, registered at runtime.
6. Steps 2.4 and 2.5 list all of this under Water in
   [permissions.md](../../security/permissions.md) and add Water's allow
   list to the APK rules check.

## TalkBack and accessibility

1. **Units in words.** What TalkBack reads uses the full unit, through
   plurals: "250 millilitres", "8 fluid ounces". The screen shows "ml"
   and "fl oz".
2. **Summary as one item.** The total, the goal, the percentage and the
   bar are read together: "1,250 of 2,000 millilitres today, 62
   percent". When met, "Goal reached" follows. The bar is not a second
   item.
3. **Quick amounts.** Each button is read "Add 250 millilitres". "Other
   amount" is read as it is.
4. **Changes are announced.** The snackbars after an add and a delete
   are read, with their Undo action.
5. **A drink row is one item**: "14:05, 250 millilitres". Its action is
   "Edit".
6. **A History row is one item**: "Thursday 12 November, 1,800 of 2,000
   millilitres, goal reached".
7. **Headings.** Section headers are headings, so TalkBack can jump
   between them.
8. **Not colour alone.** "Goal reached" is always text. The check icon
   next to it is decorative and has no label.
9. **Times** are read in the phone's 12-hour or 24-hour format.
10. **The reminder line and its button** are read in order after the
    quick amounts.
11. **Focus after a sheet or dialog closes** returns to the element that
    opened it.
12. **Notification buttons** have only their visible text. Whether
    TalkBack reads "ml" well there is [open](#open), for the TalkBack
    pass of step 2.6.
13. The automated accessibility checks of the emulator tests run on
    every screen, as for Catalog.

## Out of scope for version 1.0

- Kinds of drinks: coffee, tea, juice, caffeine, and how much each one
  counts.
- Goal advice from weight, activity or weather. Water gives no health
  advice.
- Charts, weekly or monthly statistics, averages, streaks, badges.
- Home screen widgets, quick settings tiles, app shortcuts, Wear OS.
- Health Connect, CSV export or import, or any file other than the
  backup.
- More than three quick amounts, or names and icons for them.
- Reminder hours that cross midnight. A day that starts at another time
  than midnight. Different hours on different weekdays. Reminders at
  fixed times.
- Reminders before the first unlock after a restart
  ([ADR 0010](../../adr/0010-exact-alarms-and-reminder-storage.md),
  point 5).
- Moving a drink to another day. Delete it and add it again.
- UK fluid ounces, litres or cups as units.
- An undo button in the notification.
- Sync (Phase 5) and the handover between apps (step 3.0).
- Georgian. All text is in string resources, ready for it.
- "Restore as it was"
  ([backup-format.md](../../architecture/backup-format.md#open-questions),
  open question 1).
- Reminders to make a backup, and a "last backup" date.

## Changes to shared modules

Water needs these. Each is built in the step named, not on this page.

| Module | Change | Step |
|---|---|---|
| `core/testing` | The check that every screen of an app is behind the app lock: `AppLockCheck`, its app classes and `MergedManifest` ([security-screens.md](../../architecture/security-screens.md#every-screen-is-behind-the-gate)). Built. | 2.2 |
| `core/security` | `AppLockGate` tags its lock screen with `LOCK_SCREEN_TEST_TAG`, so the check can find it. Nothing that shows changes. Built. | 2.2 |
| `core/design` | `ShkProgressBar`, a progress bar with a value from 0 to 1. Features cannot draw Material 3's own. With its page in Catalog, its screenshots and its tests. | 2.3 |
| `core/notify` | Buttons on a notification: a third receiver, not exported, the rules of [ADR 0034](../../adr/0034-notification-buttons.md), no buttons in the hidden form, and a timeout for a notification. `ManifestTest` and [permissions.md](../../security/permissions.md) follow. | 2.4 |
| `core/security` | The first-need dialog of [ADR 0035](../../adr/0035-recovery-key-when-first-needed.md), with its Catalog page. | 2.5 |
| The APK rules check | Water's allow list of five permissions, and the rule of ADR 0033 | 2.4 and 2.5, as the prompts say |

## Steps that build it

| Step | Builds |
|---|---|
| 2.2 | The database, the repositories, the rules of [the goal of a day](#the-goal-of-a-day), [the settings in use](#the-settings-in-use), [units](#units) and [the next reminder](#when-the-next-reminder-comes) as plain code with unit tests, the view models, the backup content readers and writers, and the check that every screen is behind the app lock |
| 2.3 | Every screen of [Screens](#screens) except backup and restore, and `ShkProgressBar` |
| 2.4 | Reminders: `AlarmSource`, `AlarmHandler`, the buttons, the permission question, and the `core/notify` changes |
| 2.5 | Backup and restore screens, the first-need dialog, the app lock in Settings, the file key move of [Files](#files) with its warning as a comment on the call, and the Licences screen |
| 2.6 | The user guide `docs/user/water.md`, the changelog, the release checklist |

## Decided by the owner

On 2026-11-13, in the planning session of this step.

| Question | Decision |
|---|---|
| The first start | Straight to Today. No setup screens. The recovery key comes when it is first needed. This is the pattern for every later app. The owner asked what the user sees at that moment, and what Settings shows before it ([The recovery key when first needed](#the-recovery-key-when-first-needed), [ADR 0035](../../adr/0035-recovery-key-when-first-needed.md)). |
| How reminders are timed | Every chosen interval inside the reminder hours, counted from the last drink. None once the goal is met. One alarm at a time. The owner asked for the exact next time in each case ([When the next reminder comes](#when-the-next-reminder-comes)). |
| Buttons on a reminder | **Drank** with the first quick amount, and **Later** for 15 minutes. The owner asked for rules on the app lock, the lock screen, the amount and undo, for every later app ([Buttons on a reminder](#buttons-on-a-reminder), [ADR 0034](../../adr/0034-notification-buttons.md)). |
| Missed reminders | Skipped. Never shown late. |
| Reminder settings and sync | Reminder settings are a record, so with sync they would reach every device, and every device would remind. The sync design decides which settings are per device ([Open](#open), item 6). |
| The decision records and the assumptions (on [pull request 36](https://github.com/shkriuss/shkriuss.app/pull/36)) | [ADR 0034](../../adr/0034-notification-buttons.md), [ADR 0035](../../adr/0035-recovery-key-when-first-needed.md) and [ADR 0036](../../adr/0036-app-settings-as-records.md) accepted. The 18 [assumptions](#assumptions) accepted as written. |
| The file key move (on pull request 36) | Water may finish a pending move at once only because it stores no files. A later version that stores files must take this call out first, or files sealed with the old key are lost. The spec says so under [Files](#files), and the code carries the same warning as a comment on that call. |
| A drink while a snooze is set (step 2.2, on 2026-11-14) | Rule 3 and the case "A drink is logged" said different things when a snooze was set. The owner decided: a snooze holds only while the press of **Later** is still the latest of the four. A drink timed at or after the press ends it; a drink entered with an earlier time does not. Rule 3 and two rows of [the table](#when-the-next-reminder-comes) say so. |
| On pull request 40 (step 2.2, on 2026-11-14) | The words for a goal outside its limits ([Settings screen](#settings-screen)). Three rules the code had chosen, accepted: on the same `updatedAt` the larger `id` counts, until step 5.1; a change of "From" that leaves less than 30 minutes before "Until" is refused, like a change of "Until"; setting the goal to the value it already has writes nothing. The receiver of `androidx.profileinstaller` is removed from Water's manifest ([Permissions](#permissions)). |

## Assumptions

Choices this page made without a decision by the owner on that point.
The owner read them on pull request 36 and accepted them as written, on
2026-11-13. A later reader may still object to each one.

1. Three destinations: Today, History, Settings.
2. Defaults: goal 2,000 ml, quick amounts 150, 250 and 500 ml,
   millilitres, reminders off, every hour, from 08:00 until 22:00.
3. Limits: a drink 1 to 3,000 ml, a goal 500 to 10,000 ml, reminder
   hours at least 30 minutes long, six intervals from 30 minutes to 3
   hours.
4. Two units: millilitres and US fluid ounces. Stored in whole
   millilitres, shown in whole units.
5. A drink is stored with its local day and time, as entered, not as a
   moment in UTC.
6. The goal is a record per change, with the day it counts from, so
   past days keep their goal.
7. The settings are one record. The newest edit counts. This needs
   [ADR 0036](../../adr/0036-app-settings-as-records.md).
8. The reminder bookkeeping is in a small Android preferences file, on
   this phone only.
9. History shows every day from the first drink, empty days too.
10. A drink's time can be changed, its day cannot. A time after now is
    refused for today.
11. The snooze is 15 minutes and cannot be changed.
12. The notification has no buttons while its text is hidden, and every
    button needs the phone unlocked.
13. A drink logged with **Drank** is undone in the app, not in the
    notification.
14. The reminder is removed at midnight.
15. Backup content is a fixed binary layout, not a serialization
    library. `kotlinx.serialization` is named in
    [ADR 0003](../../adr/0003-kotlin-compose-material-3-navigation-3.md)
    but is not in the build.
16. The backup type names are the table names.
17. Water finishes a pending file key move at once, because it has no
    files. A version that stores files must take this out first
    ([Files](#files)).
18. The percentage is rounded down.

## Open

What is left, with the step that decides it.

1. **Navigation 3 or not.** Water has three destinations and one open
   day. Whether it uses Navigation 3 is the open point 2 of
   [ADR 0003](../../adr/0003-kotlin-compose-material-3-navigation-3.md).
   Step 2.3.
2. **What the user sees when the alarm handler fails.** Today the
   reminder is marked as fired and lost without a word
   ([notifications.md](../../architecture/notifications.md#open), item
   6). Step 2.4, with the owner.
3. **An alarm that is due while Water moves it.** If a sync runs in the
   seconds between an alarm's time and Android's broadcast, the
   `AlarmSource` names the next time and that one reminder is lost. Step
   2.4 decides whether this needs a fix, for example a grace of a few
   seconds, with a test.
4. **When a backup is checked.** After every backup, or when the user
   asks ([backup-format.md](../../architecture/backup-format.md#open-questions),
   open question 2). Step 2.5, with the owner.
5. **How TalkBack reads "ml" and "fl oz" on the notification buttons.**
   The TalkBack pass of step 2.6.
6. **Reminder settings with sync.** The reminder settings are a record,
   so with sync they reach every device, and every device would remind.
   The sync design decides which settings are per device. Step 5.1.
7. **Ties in sync**, for two settings records or two goals with the same
   `updatedAt`
   ([backup-format.md](../../architecture/backup-format.md#the-restore-rule)).
   Step 5.1. Until then, the larger `id` counts (owner's decision on pull
   request 40).
