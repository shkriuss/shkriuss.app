# Reminders: specification

What Reminders does, screen by screen, what it stores, when a reminder
shows, and what goes into its backup. Where Water already decided a
part, this page links to [Water's specification](../water/spec.md) and
says only what differs. If this page is wrong or silent, the fix is a
change to this page first, agreed with the owner.

- Package `app.shkriuss.reminders`. App name in keys and backups:
  `reminders`. Modules `android/feature/reminders` and
  `android/app/reminders`.
- The page ends with what the owner [decided](#decided-by-the-owner),
  every [assumption](#assumptions) and what is still [open](#open).

## What Reminders is for

Reminders shows a notification with your title at the time you set:
once, or again every day, week, month or year. It keeps everything on
your phone, with no account and no network.

## At a glance

| Part | Choice |
|---|---|
| Screens | Upcoming, Past, Settings, and the reminder form |
| Stored | Reminders, in one record table, `reminder` |
| Repeats | Once, every day, every week on chosen days, every month, every year |
| Times | The phone's local time. No time zone is stored. |
| Notification buttons | **Done** and **Snooze 10 min** |
| Missed reminders | Shown late, once: the latest missed time of each reminder |
| Backup | Data version 1. One record type. No files. |
| Permissions | The five of Water. No network. |

## As in Water

Each part below is as Water's spec says, with the change named.

| Part of Water's spec | What differs in Reminders |
|---|---|
| [Navigation](../water/spec.md#navigation) | The activity is `RemindersActivity`. The destinations are **Upcoming** (the start), **Past** and **Settings**. |
| [Asking for notifications](../water/spec.md#asking-for-notifications) | It comes after the first save while Android has not asked (`NotAsked`), and from **Allow**. The text: "Reminders shows each reminder as a notification. Android asks next whether Reminders may show notifications." The reminder is saved either way. |
| [Settings screen](../water/spec.md#settings-screen) | Only the sections Backup, Security and About. Reminders has no settings of its own: the snooze is fixed. |
| [Backup and restore screens](../water/spec.md#backup-and-restore-screens) | "Water" becomes "Reminders", "drinks" becomes "reminders": "It holds 42 reminders." The file name: `reminders-2026-11-16.shkbackup`. |
| [Licences](../water/spec.md#licences), [Every screen](../water/spec.md#every-screen) | Nothing. |
| [The database](../water/spec.md#the-database) | `reminders.db`, version 1, the table [`reminder`](#table-reminder) and `change_counter`. |
| [On this phone only](../water/spec.md#on-this-phone-only) | Its first row is [Reminders' own file](#on-this-phone-only). |
| [Files](../water/spec.md#files) | Nothing: no files, the pending file key move finished at once, with the same warning. |
| [The recovery key when first needed](../water/spec.md#the-recovery-key-when-first-needed) | See [The recovery key](#the-recovery-key). |
| [Permissions](../water/spec.md#permissions) | The same five and the same manifest rules. Only `RemindersActivity` is exported. |
| [TalkBack](../water/spec.md#talkback-and-accessibility) | Reminders' own points are in [TalkBack](#talkback). |
| [Limits of Android](../../architecture/notifications.md#limits-of-android) and [reminders.md](../../user/reminders.md) | After them, Reminders shows the latest missed time late. |

## Words used on this page

- **Occurrence.** One local date and time that a reminder's repeat
  gives. A one-time reminder has one.
- **Moment.** Where an occurrence falls, in the phone's time zone now.
- **Late.** Shown more than one minute after its moment.
- **The mark.** On this phone, the latest occurrence of a reminder that
  is dealt with, as a local date and minute.
- **Upcoming.** A reminder with an occurrence after its mark, or with a
  snooze. **Past**: a one-time reminder that is not upcoming.

## Screens

### Upcoming

1. Top bar: "Upcoming".
2. While a reminder is upcoming and notifications cannot show, a line
   and a button at the top, as [Water's reminder line](../water/spec.md#today):

   | State | The line says | Button |
   |---|---|---|
   | `NotAsked` | "Reminders may not show notifications yet." | **Allow** |
   | `Denied` | "Notifications are off for Reminders. Your reminders are silent." | **Open settings** |
   | `ChannelOff` | "Reminders are turned off in Android's settings. Your reminders are silent." | **Open settings** |

3. One row per upcoming reminder, soonest first. At the same moment, the
   one created first. The title, then when it shows next and its repeat:
   "Today, 09:00 · Every day", "Wed 18 Nov, 18:30 · Mon, Wed, Fri". The
   year shows when it is not this year. When a snooze ends before the
   next occurrence: "Snoozed until 09:12". Due and not shown yet: "Now".
   A tap opens the form.
4. With none: "No reminders yet. Tap Add a reminder to make one."
5. A floating button, "Add a reminder", opens an empty form.

### Past

1. Top bar: "Past", with **Delete all** while the list is not empty.
2. One row per past reminder, newest first: the title, and "Mon 16 Nov,
   14:00". The year shows when it is not this year. A tap opens the
   form.
3. With none: "No past reminders. A one-time reminder moves here after
   it shows."
4. **Delete all** asks "Delete all past reminders?", "This deletes 12
   reminders.", with **Delete** and **Cancel**. Then a snackbar, "12
   reminders deleted", with **Undo**.

Both lists, by width: under 840dp one list, with the form as a bottom
sheet. From 840dp `ShkListDetailScaffold`: the list, 360dp wide, and the
form beside it, or "Choose a reminder."

### The reminder form

"New reminder" or "Edit reminder", from top to bottom:

1. **Title**: a one-line field, empty at the start, with the keyboard.
2. **Repeat**: a `ShkRadioGroup`: Once, Every day, Every week, Every
   month, Every year.
3. **Date**, for Once, Every month and Every year: "Mon 16 Nov 2026". A
   tap opens `ShkDatePicker`, from today to 31 Dec 2100.
4. **Days**, for Every week: seven `ShkFilterChip`s, "Mon" to "Sun",
   from the phone's first day of the week.
5. **Time**: "09:00". A tap opens `ShkTimePicker`.
6. A line with what the form gives: "Next: Wed 18 Nov, 18:30".
7. **Save** and **Cancel**, and **Delete** when editing.

A new reminder is Once, today, at the next full hour (at 23:10,
tomorrow at 00:00). Choosing Every week selects the day of the date.

1. The title has 1 to 200 characters, counted as Unicode code points,
   without spaces at either end:
   "Enter a title." or "A title has at most 200 characters."
2. For Once, the date and time must be later than the current minute.
   The picker refuses an earlier time with "That time has passed.", and
   so does Save if the time passed while the form was open. A change of the
   title alone keeps a past time.
3. For Every week, at least one day: "Choose at least one day."
4. At most 500 reminders that are not deleted: "Reminders keeps 500
   reminders. Delete one to add another." The form checks it when it
   adds one. A restore can bring more; the form then adds none until
   the count is under 500.
5. A wrong field shows its words under it, and Save does nothing. Save
   with no change writes nothing. Otherwise a snackbar: "Reminder set
   for Wed 18 Nov, 18:30."
6. Delete closes the form, with the snackbar "Reminder deleted" and
   **Undo**.

## Data

### Table `reminder`

| Column | SQL type | What it holds | Limits |
|---|---|---|---|
| `title` | `TEXT NOT NULL` | The title | 1 to 200 code points, one line, no space at either end |
| `day` | `INTEGER NOT NULL` | Once: the date. A repeat: the date it starts from. Days since 1970-01-01. | 0 to 2932896 (1970-01-01 to 9999-12-31) |
| `minuteOfDay` | `INTEGER NOT NULL` | The time, in minutes after midnight | 0 to 1439 |
| `repeat` | `INTEGER NOT NULL` | 0 once, 1 every day, 2 every week, 3 every month, 4 every year | 0 to 4 |
| `weekdays` | `INTEGER NOT NULL` | Every week: a bit per day, Monday 1, Tuesday 2, Wednesday 4, Thursday 8, Friday 16, Saturday 32, Sunday 64 | 1 to 127 for every week, else 0 |

Date and time are local, as the phone's clock shows them. For Every day
and Every week, `day` is the day the reminder was saved. A deleted
reminder keeps its title, as every record keeps its content.

### On this phone only

| What | Where |
|---|---|
| For each reminder, by its `id`: the mark (`mark.<id>`, minutes since 1970-01-01 00:00 local), the end of its snooze (`snooze.<id>`) and the time of its notification on screen (`showing.<id>`), both in milliseconds since 1970 UTC. A delete removes all three. | One preferences file, `app.shkriuss.reminders`, in Reminders' private storage. Ids and times only, never a title. |

## When a reminder shows

### Occurrences

1. **Once**: `day` at `minuteOfDay`.
2. **Every day**: each day from `day` on.
3. **Every week**: each day from `day` on whose weekday is chosen.
4. **Every month**: each month from that of `day`, on its day of the
   month, or on the last day of a shorter month.
5. **Every year**: each year from that of `day`, on its month and day.
   29 February falls on 28 February in a year without it.

The latest due occurrence and the first pending one are worked out with
date arithmetic from the mark and from now, never by stepping day by day
from `day`. A restored reminder that starts in 1970 or in 9999 costs the
same as one from today.

The moment is the date and time in the phone's time zone of this
moment, with `java.time`. So a reminder follows a new time zone and
summer time by itself. A time that does not exist, when the clock jumps
forward, moves later by the jump: 02:30 becomes 03:30. A time that
happens twice, when the clock goes back, is the first.

### The mark

1. Saving a new reminder, or a new date, time or repeat, sets the mark
   to the current minute. So a daily 09:00 saved at 09:30 starts
   tomorrow.
2. A reminder with no mark on this phone gets the current minute when
   Reminders first sees it: after a restore, after **Undo**.
3. **The mark never stays later than now.** When the `AlarmSource`
   finds the moment of the mark later than now, because the clock was
   set back or the phone moved to a zone further west, it writes the
   current minute in its place, and the reminder counts from now. The
   handler uses the mark capped the same way, and writes it only in its
   step 3. The moment of the mark is found as for an occurrence, so of a
   time that happens twice it is the first: in the hour that happens
   twice when the clocks go back, the mark stays. A time that showed can
   show again, as `core/notify` does for an alarm it marked as fired
   ([notifications.md](../../architecture/notifications.md#how-alarms-are-kept-right)).

### The rule

Each reminder has at most one alarm, with the reminder's `id` as its id.
Pending occurrences are those later than the mark.

1. **Due first.** If pending occurrences are due, the alarm is at the
   moment of the latest. It has passed, so it fires within seconds: the
   reminder shows late. The older ones are skipped.
2. **Then a snooze.** Otherwise, if a snooze is set, the alarm is at its
   end or at the first pending occurrence, whichever is earlier. Its end
   counts also when it has passed.
3. **Then the next.** Otherwise, at the first pending occurrence.
4. A one-time reminder with neither has no alarm. It is past.

A due alarm so stays named until its handler has written step 3 below, as
[notifications.md](../../architecture/notifications.md#rules-for-the-apps-alarmsource)
asks. Reminders needs no grace minute like
[Water's rule 7](../water/spec.md#when-the-next-reminder-comes).

When the alarm for time T reaches the handler:

1. It reads the reminder and the phone-only file, with the mark no
   later than now ([The mark](#the-mark), point 3). If the rule does not
   give T, it shows nothing, writes nothing more, and ends. That is the
   case when the reminder was deleted or changed in that moment, or a
   later occurrence is due.
2. It shows [the notification](#the-notification).
3. It writes: the mark is the later of the mark and T as a local
   minute, no snooze, and `showing` is T.

- If reading or showing fails with an error, step 3 is still written,
  and the error then goes on to `core/notify`, which shows its notice.
  So a failure never names T again.
- If Reminders is stopped before step 3, the rule still gives T at the
  next start, or a later occurrence if one is due by then, and the
  reminder shows then, late if more than a minute passed. If it is
  stopped between steps 2 and 3, it shows once more. A reminder is never
  lost this way.
- After step 3, a second run for T shows nothing: the mark is already at
  T.
- Nothing is written before the rule is checked.

| Change | What follows |
|---|---|
| A new reminder, or a new date, time or repeat | The mark is now. The snooze ends. Its notification goes. |
| A new title only | Nothing more. A notification on screen keeps the old title. |
| **Snooze 10 min** at t, a press that is current | In one write, `showing` goes and a snooze until t + 10 minutes is set. The notification goes. |
| **Done**, a press that is current | In one write, `showing` goes. The notification goes. Nothing more. |
| The same press a second time | Not current. It only removes its notification, never a newer one. |
| A swipe or a tap | The notification goes. Nothing more. |
| An occurrence comes due during a snooze | It shows. The snooze ends. |
| A delete | Its notification, snooze and entries go. **Undo** counts from now. |

### Examples

"Pills": every day at 09:00. "Call the bank": once, Mon 16 Nov 2026 at
14:00. "Rent": every month on the 31st at 10:00, from Sat 31 Oct 2026.
"Gym": every Mon, Wed and Fri at 18:30. In Tbilisi unless said.

| Case | What shows |
|---|---|
| "Pills" saved on Sun 15 Nov at 09:30 | First on Mon 16 Nov at 09:00 |
| "Gym" saved on Mon 16 Nov at 19:00 | Wed 18 Nov at 18:30 |
| "Rent" | Sat 31 Oct, Mon 30 Nov, Thu 31 Dec, Sun 31 Jan, Sun 28 Feb 2027, Wed 31 Mar 2027 |
| Every year from Tue 29 Feb 2028 | Tue 29 Feb 2028, Wed 28 Feb 2029, Thu 28 Feb 2030, ..., Sun 29 Feb 2032 |
| **Snooze 10 min** at 09:02 | 09:12, and after another snooze 09:22 |
| **Snooze 10 min** at 09:02 arrives twice | The snooze stays at 09:12 |
| **Done** at 09:05, a swipe, or no answer | Tomorrow at 09:00, which replaces an old one on screen |
| The alarm reaches the handler at 09:00:40 | On time. At 09:01:05 it says "Missed: 09:00". |
| The phone off from Mon 08:00 to Wed 11:00 | After the unlock: "Pills", "Missed: 09:00", for Wednesday. Monday and Tuesday are skipped. |
| A restart on Mon at 13:00, the unlock at 15:10 | Nothing before the unlock. Then "Call the bank", "Missed: 14:00". |
| **Force stop** on Mon at 08:00, opened at 12:00 | At 12:00: "Pills", "Missed: 09:00" |
| Reminders is stopped while "Call the bank" is being shown at 14:00 | It shows at the next start, as "Missed: 14:00" if more than a minute passed |
| Snoozed until 09:12, the phone off from 09:10 to 10:00 | After the unlock, the snoozed reminder |
| Monday's "Pills" is still on screen on Tuesday. **Snooze 10 min** at 08:55. | Tue at 09:00, on time. The snooze ends. |
| Private Space locked, or the profile stopped | As with the phone off, once it runs again |
| Notifications not allowed | Alarms fire and marks move on. Android drops the notification. None shows later. |
| Berlin, Sun 28 Mar 2027, every day at 02:30 | That day at 03:30. The next at 02:30. |
| Berlin, Sun 31 Oct 2027, every day at 02:30 | Once, at the first 02:30 |
| "Pills" showed on Mon at 09:00. At 13:00 the phone is in Berlin. | Tue at 09:00, Berlin time |
| "Pills" showed on Mon at 09:00. At 11:00 the phone is in Berlin (08:00 there). | Again on Mon at 09:00, Berlin time |
| The phone off from Mon 07:00 in Berlin, on in Tbilisi at 15:00 | At 15:00: "Pills", "Missed: 09:00" |
| "Call the bank", made in Tbilisi, the phone in Berlin on Monday | Mon at 14:00, Berlin time |
| After 09:00 showed, the clock is set back from 09:30 to 08:30 | Again at 09:00 |
| On Mon at 10:00 the clock is set forward to 15:00 | At once: "Call the bank", "Missed: 14:00" |
| A restore on Mon at 12:00 | Each reminder it took counts from 12:00: "Pills" on Tue. A one-time reminder whose time passed is past. |

### How Reminders uses `core/notify`

As [Water does](../water/spec.md#how-water-uses-corenotify), except:

1. One `Notify` with the channel `reminders`. One class of
   `feature/reminders` is its `AlarmSource`, `AlarmHandler` and
   `ButtonHandler`.
2. The `AlarmSource` names one alarm per upcoming reminder, at the time
   of [the rule](#the-rule), and writes the mark of a reminder it sees
   first.
3. `notify.sync()` follows every write: a save, a delete, an Undo,
   Delete all, a button, a restore. The handler, a press, and the work
   on the phone-only file after each write take turns on one lock, as
   in Water.
4. **`core/notify` lacks nothing this page needs.** A late reminder is
   an alarm in the past. Each reminder has its own notification, by its
   key. The rule for a clock set back is the one it already has.

## The notification

1. **Title**: the reminder's title.
2. **Text**: on time, the repeat, such as "Every day" or "Every Mon,
   Wed, Fri", and none for Once. Late: "Missed: 09:00", or "Missed: Mon
   16 Nov, 09:00" when not today. After a snooze: "Snoozed. It was due at
   09:00." Here 09:00 is the latest occurrence at or before the mark as
   it is before the handler's step 3. After a second snooze the mark is
   the first snooze's end, 09:12, and that never shows.
3. **Time**: the moment of its alarm.
4. **One per reminder**, with the reminder's `id` as its key. Several
   can show at once. The next occurrence replaces the old one.
5. **No end.** It stays until it is answered, swiped away or replaced,
   or its reminder gets a new time or is deleted.
6. **A tap** opens Reminders, after the app lock, with the form of that
   reminder open, on the list it is in. The tap carries the reminder's
   `id`: it is the notification's key, and `core/notify` puts the key on
   the tap as its identifier. No title travels. The notice of
   `core/notify` when the handler fails carries the same identifier, and
   a tap on it does the same. If that reminder is deleted by then, or no
   reminder has that id, the tap opens Upcoming.

**Done** (action `done`) removes the notification. **Snooze 10 min**
(action `snooze`, value 10) sets a snooze until 10 minutes after the
press and removes it. Both follow
[ADR 0034](../../adr/0034-notification-buttons.md) as
[Water's buttons](../water/spec.md#buttons-on-a-reminder) do: the unlock
first, none while the app lock hides the text, once and only while
current, no undo. A press carries the reminder's `id`, the action, the
notification's time and the value. It is current when its time is
`showing`.

A press that is current removes `showing` in the same write as its
change: **Done** removes it, **Snooze 10 min** removes it and sets the
snooze. A second arrival of the same press is then not current. It only
removes its notification, and never a newer one of the same reminder,
as ADR 0034, point 5, says and as Water does.

| Channel | Value |
|---|---|
| Id | `reminders`. It never changes. |
| Name | "Reminders" |
| Description | "Shows each reminder at its time." |
| Importance at the start | Urgent: with sound, and over the screen for a moment. The user can change it in Android's settings. |

Who sees the title:

1. The lock screen shows it only if the phone allows all notification
   content there (`VISIBILITY_PRIVATE`).
2. While the app lock hides the text, each reminder shows only
   "Reminders" and "The app lock hides this notification. Open the app
   to see it.", with no buttons
   ([notifications.md](../../architecture/notifications.md#while-the-app-lock-is-on)).
3. If the handler fails, the notice of `core/notify` takes its place,
   with the same key. The next notification replaces it.
4. The title is user content. It is in the database and, while shown,
   in the notification. Never in a log, an alarm, a press or the
   preferences file.

## The recovery key

As in Water and [ADR 0035](../../adr/0035-recovery-key-when-first-needed.md):
only a backup, a restore or the app lock needs it. Reminders is set up
on its own: the key is created in it, or the 24 words are entered in it.
With a key made in Water, tap **I already have one** and enter the same
words. Both apps then keep it
([crypto-design.md](../../security/crypto-design.md#keeper-apps-and-other-apps)).
The handover of keys between apps comes later.

The owner decided: wherever an app offers **Create a recovery key**
while it has no key, one more sentence follows the text: "If another
shkriuss app already has your recovery key, tap I already have one and
enter the same words." That is the dialog "Set up your recovery key
first", and the security screen. It is shared text of `core/security`,
so every app shows it. Water's dialog,
[Water's spec](../water/spec.md#what-you-see-at-that-moment),
[security-screens.md](../../architecture/security-screens.md#the-recovery-key-when-first-needed)
and the user guide [recovery-key.md](../../user/recovery-key.md) change
in the same pull request as the code that builds this part. This page
changes none of them.

## Backup contents

Reminders follows [backup-format.md](../../architecture/backup-format.md).
**It writes and reads data version 1**, and raises it as
[the format says](../../architecture/backup-format.md#the-data-version).

One type, `reminder`, from the table `reminder`. The record fields
travel in the container, and deleted records are in the backup too,
with their full content. The content is 12 + n bytes, big-endian:

| Offset | Size | Content |
|---|---|---|
| 0 | 1 | `repeat`, `00` to `04` |
| 1 | 1 | `weekdays`, `00`, or `01` to `7f` for every week |
| 2 | 4 | `day`, int32, days since 1970-01-01, 0 to 2932896 |
| 6 | 4 | `minuteOfDay`, int32, 0 to 1439 |
| 10 | 2 | n, the title's length in bytes, unsigned, 1 to 800: at most 4 bytes for each of 200 code points |
| 12 | n | The title, in UTF-8 |

"Call the bank", once, 2026-11-16 at 14:00, and "Gym", every Mon, Wed
and Fri at 18:30 from 2026-11-16:

```text
00 00 00005125 00000348 000d 43616c6c207468652062616e6b
02 15 00005125 00000456 0003 47796d
```

1. Writing and reading are as in [Water](../water/spec.md#writing): every
   record once, no files, and a restore in one transaction through
   `RecordWriter.takeFromBackup`.
2. The restore rolls back, as Water's does, at another type name, a
   length other than 12 + n, a title that is not UTF-8 or breaks the
   limits of [the table](#table-reminder), a `day` outside 0 to
   2932896, any other value outside its limits, days for a repeat other
   than every week, or a File entry.
3. After a restore, each reminder it took counts from that moment: its
   snooze ends and its notification goes. `notify.sync()` follows in the
   same step, as in [Water](../water/spec.md#after-a-restore).
4. A reminder with a 20-byte title takes 39 + 8 + 32 = 79 bytes in the
   body. 500 reminders take about 40 KB.

## TalkBack

As in Water, and:

1. A row is one item: "Pills, tomorrow at 09:00, every day", or "Pills,
   snoozed until 09:12". Its action is "Edit".
2. A day chip reads the whole day: "Monday, selected".
3. The errors of the form are announced. The line about notifications
   and its button come before the list.
4. The notification buttons have only their visible text.

## Out of scope for version 1

- Lists, due dates, checklists, marking a reminder done for good: they
  belong to Tasks. A note, place, colour or picture: only a title.
- Every N days, weeks or months, an end date, several times a day, "the
  last Friday", pausing, other snooze lengths, a time zone per reminder.
- Reminders before the first unlock after a restart
  ([ADR 0010](../../adr/0010-exact-alarms-and-reminder-storage.md),
  point 5). Alarm-style alerts that ring until stopped.
- Widgets, tiles, shortcuts, Wear OS, search, undo in the notification,
  sync, Georgian, and "restore as it was".

## Decided by the owner

The app: one-time and repeating reminders with a title, a small first
version, set up with the recovery key as Water is. Lists, due dates and
checklists belong to Tasks. And five answers:

1. A missed reminder shows late, once: the latest missed time.
2. Times are the phone's local time. No zone is stored.
3. The repeats of [Occurrences](#occurrences), with no end date and no
   "every N".
4. The buttons **Done** and **Snooze 10 min**, the snooze fixed.
5. A one-time reminder stays under Past until deleted or given a new
   time.

## Assumptions

Choices this page made without a decision by the owner on that point.

1. Three destinations: Upcoming, Past, Settings.
2. Titles of 1 to 200 code points. At most 500 reminders made in the
   form; a restore can bring more.
3. The channel starts at Urgent. Water's starts at Default.
4. Late means more than one minute after the moment.
5. A reminder counts from the minute it is saved.
6. After a clock set back, or a zone further west, a time can show
   twice.
7. Phone-only state in a preferences file
   ([ADR 0036](../../adr/0036-app-settings-as-records.md), point 3), not a
   table ([data.md](../../architecture/data.md#rules-for-daos), rule 5).
8. A new reminder: Once, today, at the next full hour. Every day and
   Every week start on the day they are saved.
9. A tap on a notification opens that reminder's form. A notification
   has no end.
10. **Delete all** in Past, with Undo.
11. The form is a sheet under 840dp, a pane from 840dp.
12. A new title alone leaves a notification and a snooze as they are.
13. The words of the notification, the form and the lines.
14. A fixed binary content. The type name is the table name.

## Open

1. **Knowing that another app keeps a key.** Whether the handover lets
   the dialog know that another app of the suite keeps a key
   ([PROMPTS.md](../../development/PROMPTS.md#30-handover)).
2. **"Local only" for a watch**, as
   [Water's open item 9](../water/spec.md#open).
3. **How TalkBack reads "Snooze 10 min"** on the button.
4. **Sync.** Every device would remind. Marks, snoozes and **Done**
   stay on one phone. The sync design decides.
5. **Titles of deleted reminders** stay in the database and backups as
   deletion markers until a purge exists
   ([data.md](../../architecture/data.md#rules-for-daos), rule 4).
6. **Many missed reminders at once.** Android caps how many
   notifications one app shows. Whether some are lost after a long time
   off is not checked.
