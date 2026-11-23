# Tasks: specification

What Tasks does, screen by screen, what it stores, when a task reminds,
what happens when something goes wrong, and what goes into its backup.
Where Water or Reminders already decided a part, this page links to
[Water's specification](../water/spec.md) or
[Reminders' specification](../reminders/spec.md) and says only what
differs. If this page is wrong or silent, the fix is a change to this
page first, agreed with the owner.

- Package `app.shkriuss.tasks`. App name in keys and backups: `tasks`.
  Modules `android/feature/tasks` and `android/app/tasks`.
- The page ends with what the owner [decided](#decided-by-the-owner),
  every [assumption](#assumptions) and what is still [open](#open).

## What Tasks is for

Tasks keeps the things you have to do, in lists, with a due date if you
want one, a repeat, and a reminder on the due day. It keeps everything
on your phone, with no account and no network.

## At a glance

| Part | Choice |
|---|---|
| Screens | Today, Lists with one list open, Settings, and the task form |
| Stored | Lists and tasks, in two record tables, `task_list` and `task` |
| Inbox | A fixed list for tasks in no list. Not a record. |
| Due dates | Optional. A local date. No time zone is stored. |
| Repeats | As Reminders: once, every day, every week on chosen days, every month, every year |
| Done on a repeating task | The same task moves to its next date after today |
| Reminders | Optional: a time on the due day. One per task. |
| Notification buttons | **Done** and **Snooze 10 min** |
| Missed reminders | Shown late, once |
| Backup | Data version 1. Two record types. No files. |
| Permissions | The five of Water. No network. |

## As in Water and Reminders

| Part | What differs in Tasks |
|---|---|
| [Navigation](../water/spec.md#navigation) | The activity is `TasksActivity`. The destinations are **Today** (the start), **Lists** and **Settings**. Back from an open list goes to Lists. |
| [Asking for notifications](../reminders/spec.md#as-in-water) | As Reminders, after a save that sets a reminder. The text: "Tasks reminds you of a task with a notification. Android asks next whether Tasks may show notifications." The task is saved either way. |
| [Settings screen](../water/spec.md#settings-screen) | Only Backup, Security and About, as in Reminders. Tasks has no settings of its own. |
| [Backup and restore screens](../water/spec.md#backup-and-restore-screens) | "Water" becomes "Tasks", "drinks" becomes "tasks": "It holds 42 tasks." The file: `tasks-2026-11-16.shkbackup`. |
| [Licences](../water/spec.md#licences), [Every screen](../water/spec.md#every-screen) | Nothing. Tasks keeps its own list and texts, as [Reminders' decision 12](../reminders/spec.md#decided-by-the-owner) says. |
| [The database](../water/spec.md#the-database) | `tasks.db`, version 1, the tables [`task_list`](#table-task_list), [`task`](#table-task) and `change_counter`. |
| [Files](../water/spec.md#files) | Nothing: no files. The pending file key move is finished at once, with the same warning. |
| [Permissions](../water/spec.md#permissions) | The same five and the same manifest rules. Exported: `TasksActivity`, and the handover screen and status provider of `core/security`, authority `app.shkriuss.tasks.keeper` ([ADR 0041](../../adr/0041-the-handover-between-apps.md)). |
| [Limits of Android](../../architecture/notifications.md#limits-of-android) | As for Reminders: a missed reminder shows late, once. |

## Words used on this page

- **Task.** One thing to do, with a title. **List.** A named group of
  tasks that you make. **Inbox.** The list of tasks that are in no list.
- **Open** and **done.** A task is open until it is ticked.
- **Due day.** The local date a task is due. **Overdue.** Open, with a
  due day before today. **Today.** The phone's date now.
- **Reminder moment.** The due day at the reminder time, in the phone's
  time zone now. **The mark** and **late**, as in
  [Reminders](../reminders/spec.md#words-used-on-this-page).

## Screens

### Today

1. Top bar: "Today".
2. The notification line of
   [Reminders' Upcoming](../reminders/spec.md#upcoming), while an open
   task has a reminder to come and notifications cannot show, with
   "Reminders" replaced by "Tasks".
3. Section **Overdue**: open tasks with a due day before today, oldest
   first. Section **Today**: open tasks due today. Within a day: tasks
   with a reminder first, by time, then the others, oldest first. Ties:
   `createdAt`, then `id`.
4. A row: a tick box, the title, and under it the list, the date if
   overdue, the reminder time and the repeat: "Home · 09:00 · Every
   day", "Inbox · Mon 16 Nov · Every week". A tap on the row opens the
   form.
5. A tick marks the task done, or moves a repeating task to its next
   date ([Repeats](#repeats), point 3). A snackbar, "Task done", or "Next: Wed 18
   Nov" for a repeating task, with **Undo**.
6. With none: "Nothing due today."
7. A floating button, "Add a task": the form, due today, in Inbox.

### Lists

1. Top bar: "Lists". The row **Inbox** first, then each list by name, in
   the phone's language order. Ties: `createdAt`, then `id`. Each row has
   its count of open tasks at the end: "4 open".
2. A floating button, "New list": a dialog with one field, **Name**, and
   **Save** and **Cancel**.
3. A tap opens the list. Under 840dp it opens in place, with Back. From
   840dp, `ShkListDetailScaffold`: the lists, 360dp wide, and the open
   list beside them, or "Choose a list."

### A list

1. Top bar: the list's name. A menu with **Rename** and **Delete list**,
   except on Inbox, and **Delete done tasks** while there are any.
2. The open tasks: those with a due day first, by due day, then by
   reminder time, those without one last; then those with no due day,
   oldest first. Ties: `createdAt`, then `id`. Rows as on Today.
3. Section **Done**: done tasks, the last one done first. The row says
   "Done Mon 16 Nov". Clearing its tick opens the task again, with no
   snackbar.
4. With none: "No tasks in this list. Tap Add a task to make one."
5. A floating button, "Add a task": the form, in this list, with no
   due day.
6. **Delete list** asks "Delete the list Home?", "This deletes 12
   tasks." (or "The list is empty."), with **Delete** and **Cancel**.
   The list closes. A snackbar, "List deleted", with **Undo**.
7. **Delete done tasks** asks "Delete 12 done tasks?", with **Delete**
   and **Cancel**. A snackbar, "12 tasks deleted", with **Undo**.

### The task form

A bottom sheet at every width. "New task" or "Edit task":

1. **Title**: as [Reminders' title](../reminders/spec.md#the-reminder-form),
   point 1: one line, the keyboard opens for a new task only, and it
   asks the keyboard not to learn what is typed.
2. **List**: the list's name. A tap opens a dialog with Inbox and every
   list as a `ShkRadioGroup`.
3. **Due date**: "No due date" and **Add a due date**, or "Mon 16 Nov
   2026" and **Remove**. A tap on the date opens `ShkDatePicker`, from
   today to 31 Dec 2100. An earlier due date stays until it is changed.
   **Remove** also removes the repeat and the reminder.
4. With a due date: **Repeat**, the five choices of Reminders, and for
   Every week the seven day chips. Choosing Every week selects the day
   of the date. For a repeat, a line: "Dates: Wed 18 Nov, Fri 20 Nov,
   Mon 23 Nov, ...".
5. With a due date: **Remind me**, a `ShkCheckbox`, and when it is on,
   **Time**, which opens `ShkTimePicker`. It starts at 09:00. When the
   due day is today and 09:00 has passed, it starts at the next full
   hour of today, or at 23:59 when no full hour is left. In the minute
   23:59 that time has passed too, and rule 3 says so.
6. For a done task, a line: "Done on Mon 16 Nov."
7. **Save** and **Cancel**, and **Delete** when editing.

Rules:

1. A title has 1 to 200 characters, counted as Unicode code points,
   without spaces at either end: "Enter a title." or "A title has at
   most 200 characters."
2. For Every week, at least one day: "Choose at least one day."
3. A reminder moment that is not later than the current minute is
   refused, by the time picker and at Save: "That time has passed." It
   is checked only when the due date, the repeat, the time or **Remind
   me** changed. A change of the title or the list alone keeps a
   reminder that passed.
4. At most 5,000 tasks that are not deleted: "Tasks keeps 5,000 tasks.
   Delete some to add more." A list name has 1 to 60 code points, as a
   title: "Enter a name." or "A name has at most 60 characters." At most
   100 lists: "Tasks keeps 100 lists. Delete one to add another." The
   form checks a count when it adds; a restore can bring more.
5. A wrong field shows its words under it, and Save does nothing. Save
   with no change writes nothing. A new task: the snackbar "Task added".
6. Delete closes the form, with the snackbar "Task deleted" and
   **Undo**.
7. If the task is deleted elsewhere while its form is open, the form
   closes.

## Data

### Table `task_list`

| Column | SQL type | What it holds | Limits |
|---|---|---|---|
| `name` | `TEXT NOT NULL` | The list's name | 1 to 60 code points, one line, no space at either end, as Reminders' title |

### Table `task`

| Column | SQL type | What it holds | Limits |
|---|---|---|---|
| `listId` | `TEXT NOT NULL` | The `id` of its list, or `""` for Inbox | `""`, or 36 characters, lower case, a version 4 UUID |
| `title` | `TEXT NOT NULL` | The title | 1 to 200 code points, one line, no space at either end, as Reminders' title |
| `dueDay` | `INTEGER` | The due day, in days since 1970-01-01, or null | Null, or 0 to 2932896 |
| `repeat` | `INTEGER NOT NULL` | 0 once, 1 every day, 2 every week, 3 every month, 4 every year | 0 to 4. 0 when `dueDay` is null. |
| `weekdays` | `INTEGER NOT NULL` | Every week: a bit per day, as [Reminders' `weekdays`](../reminders/spec.md#table-reminder) | 1 to 127 for every week, else 0 |
| `repeatFrom` | `INTEGER` | The day the repeat counts from | Null when `repeat` is 0. Otherwise 0 to `dueDay`, and `dueDay` is one of its [dates](#repeats). |
| `remindMinute` | `INTEGER` | The reminder time, in minutes after midnight, or null | Null, or 0 to 1439. Null when `dueDay` is null. |
| `doneAt` | `INTEGER` | When the task was done, in milliseconds since 1970 UTC, or null while open | Null, or 0 to 253,402,300,799,999, as the [record times](../../architecture/data.md#record-fields) |

1. Indexes on `listId` and on `dueDay`.
2. A task whose `listId` names a list that is deleted or not stored
   shows in Inbox, and its form shows Inbox. Its `listId` stays as it
   is, so the task goes back if the list comes back. Only a restore, or
   later sync, can make such a task: deleting a list deletes its tasks.
3. Deleted records keep their content, as every record does.

### On this phone only

| What | Where |
|---|---|
| For each task, by its `id`: the mark (`mark.<id>`, minutes since 1970-01-01 00:00 local, 0 to 4,223,371,679), the end of its snooze (`snooze.<id>`) and the time of its notification on screen (`showing.<id>`), both in milliseconds since 1970 UTC, 0 to 253,402,300,799,999 | One preferences file, `app.shkriuss.tasks`, in Tasks' private storage. Ids and times only, never a title. A value that cannot be read or is outside its limits counts as missing. |

## Repeats

1. The **dates** of a repeat are
   [Reminders' occurrences](../reminders/spec.md#occurrences), with
   `repeatFrom` in place of `day`: each day, each chosen weekday, the
   same day of each month (the last day of a shorter month), or the same
   day of each year (28 February for 29 February).
2. Saving a new due date, repeat or days on a repeating task sets
   `repeatFrom` to the date in the form, and `dueDay` to the first date
   of the repeat on or after it. On a task without a repeat, `dueDay` is
   the date in the form and `repeatFrom` is null.
3. **Done** on a repeating task sets `dueDay` to the first date of the
   repeat that is later than both the old `dueDay` and today. The task
   stays open, and `repeatFrom` stays. With no such date up to
   9999-12-31, the task is done instead. Done on any other task sets
   `doneAt` to now.
4. The dates are worked out with date arithmetic, never day by day, as
   in Reminders.

"Rent": every month from Sat 31 Oct 2026. "Pills": every day from Mon 16
Nov. "Gym": every Mon, Wed and Fri.

| Case | The new due day |
|---|---|
| "Rent", due Sat 31 Oct, done that day, and each time on its due day | Mon 30 Nov, Thu 31 Dec, Sun 31 Jan, Sun 28 Feb 2027, Wed 31 Mar 2027 |
| "Pills", due Mon 16 Nov, done on Thu 19 Nov | Fri 20 Nov. Monday to Thursday are skipped. |
| "Gym", due Wed 18 Nov, done early, on Tue 17 Nov | Fri 20 Nov |
| "Gym" saved with the date Sun 15 Nov | Due Mon 16 Nov |
| Every year from Tue 29 Feb 2028 | Wed 28 Feb 2029, ..., Sun 29 Feb 2032 |

## Reminders of a task

1. A task has a reminder when it is open and has a due day and a
   reminder time. Its moment is found as
   [Reminders' moment](../reminders/spec.md#occurrences): a time that
   does not exist moves later by the jump; a time that happens twice is
   the first.
2. The reminder follows Reminders' rules for a **one-time reminder**,
   with the moment as its one occurrence:
   [the mark](../reminders/spec.md#the-mark),
   [the rule](../reminders/spec.md#the-rule), the handler's three steps
   and its cases, and
   [how it uses `core/notify`](../reminders/spec.md#how-reminders-uses-corenotify),
   with the channel `tasks`. A missed reminder shows late, once.
3. A done or deleted task, or one with no reminder, has no alarm.

| Change | What follows |
|---|---|
| A new due day, time or repeat, **Remind me** turned on, a task opened again, or an Undo | The mark is now. The snooze ends. Its notification goes. |
| A new title or list only | Nothing more. A notification on screen keeps the old title. |
| **Remind me** turned off | No alarm. The snooze, the entries and the notification go. |
| Done on a task without a repeat | Done. The snooze, the entries and the notification go. |
| Done on a repeating task | The next due day. The mark is now, the snooze ends, the notification goes. It reminds on the new day at the same time. |
| **Snooze 10 min**, a press that is current | As in [Reminders](../reminders/spec.md#the-rule). |
| A delete: a task, a list, or the done tasks | Their notifications, snoozes and entries go. **Undo** counts from now. |

### The notification

As [Reminders' notification](../reminders/spec.md#the-notification):
the title, the words "Missed: 09:00" and "Snoozed. It was due at
09:00.", one per task with the task's `id` as its key, no end, and the
same rules for who sees the title. Differences:

1. On time, the text is "Due today", and the repeat after it: "Due
   today · Every day".
2. A tap opens Tasks, after the app lock, on the task's list with its
   form open. If the task is deleted or not stored, Today.
3. **Done** (action `done`) carries as its value the due day it is
   for, in days since 1970-01-01, times 8, plus the task's `repeat` at
   that moment: 20773 × 8 + 1 = 166185 for an every-day task due Mon 16
   Nov. **Snooze 10 min** (action `snooze`, value 10) is as in
   Reminders. Both follow
   [ADR 0034](../../adr/0034-notification-buttons.md): a button does
   what it did when it was shown.
4. A press is current when its time is `showing`. **Done** is current
   only when the task is also open, has a reminder, and has the due day
   and the repeat of its value.
5. The review at every start removes a notification when its task is
   deleted, not stored, done or has no reminder; when its time is not
   the task's `showing`; or when the value of its **Done** button, where
   it has one, does not give the task's due day and repeat. Except when
   the time is not `showing`, it also removes the task's `showing`. So
   a press that another app kept from that notification is not current.
6. The channel: id `tasks`, name "Task reminders", description "Shows a
   task's reminder at its time.", Urgent at the start, as Reminders.

## When things go wrong

### Every stored value has limits

Every column above, and every value of the phone-only file, has its
limits in its table, also the rules that join two columns. The form
never writes a value outside them. A restore refuses a record with any
value outside them and rolls back ([Backup contents](#backup-contents)).
A count is not a limit of a value: a restore can bring more than 100
lists or 5,000 tasks.

### Stopped between two writes

Tasks writes to two places: the database, one transaction per action,
and the phone-only file. The database comes first and is the truth.
Then its notification goes, then `notify.sync()`. At every start, the
review and the `AlarmSource` repair the rest from the database: they
remove a notification that does not fit, drop the entries of a task
that is done, deleted or not stored, and give a task with no mark the
current minute.

| Action | Writes, in order | If Tasks stops after the database write |
|---|---|---|
| Save a task | The task; then mark now, no snooze, no `showing` | The task is saved. An old notification can stay until the next start. Its **Done** counts only while the due day and the repeat are as it showed them, so it does what it did when it was shown. |
| A tick, or **Done** on the notification | The task, done or moved; then the entries go, or the mark is now | The next start sets no alarm for a done task, and the new one for a moved task. The review removes the notification. A second press is not current. |
| A delete: a task, a list with its tasks, the done tasks | One transaction marks them all deleted; then their entries go | They are deleted. The next start removes their notifications. **Undo** is gone with the snackbar. |
| **Undo** | The records back; then the mark is now | They are back. An old mark can stay, so a reminder that passed can show late, once. |
| A restore | One transaction; then for each task it took: mark now, no snooze, no `showing`, and its notification goes | A task the restore took keeps the mark it had on this phone, so its reminder can show late, once. A new task gets the current minute. |
| **Snooze 10 min** | One write of the phone-only file | Nothing is half done. |
| The alarm handler | As [Reminders' handler](../reminders/spec.md#the-rule) | As there: a reminder is never lost, and can show once more. |

### A write fails

| What fails | What follows |
|---|---|
| Saving the form | Nothing changes. The form stays open with what was typed. A snackbar: "Could not save the task. Try again." |
| Saving a list's name, in **New list** or **Rename** | Nothing changes. The dialog stays open with the name, and says under the field: "Could not save the list. Try again." |
| A tick, a delete, an Undo | Nothing changes. The row stays as it was. A snackbar: "Could not change your tasks. Try again." |
| The phone-only file, after the database | The database change stays. The next sync and start repair the entries from it. |
| A press on **Done** or **Snooze 10 min** | Nothing more changes. The notification stays with its buttons ([notifications.md](../../architecture/notifications.md#buttons-on-a-notification), point 8). |
| The alarm handler | The notice of `core/notify` takes its place. The next reminder still comes. |
| Reading the database for a screen | `ShkErrorState`: "Could not open your tasks." |
| A restore | It rolls back, as in [Water](../water/spec.md#reading-data-version-1). |

### A press twice or late

| Press | What follows |
|---|---|
| **Save** twice, in the form or in a list's name dialog | Each takes one save at a time and closes after it: one task, or one list. |
| A tick twice, before the row shows the change | A tick carries the due day and the repeat its row showed. It counts only while the task is open with both. A repeating task moves one date; a done task is done once. |
| A cleared tick twice | The task is open once. |
| A tick on a task deleted in that moment | Nothing. The row goes. |
| **Done** on a notification twice, or on an old one | Not current: it only removes its own notification, never a newer one. |
| **Done** after the task's reminder was turned off | Not current: the task has no reminder. |
| **Snooze 10 min** twice | As in Reminders: the snooze stays at its first end. |
| **Undo** after the records changed again | It acts only on the records of its own snackbar, and only on those still as the action left them: still deleted, still done at the same `doneAt`, or still open with the due day the tick gave. |
| A dialog's **Delete** twice | One delete. The dialog closes at the first. |
| A tap on the notification of a deleted task | Today opens. |

### The clock or the time zone changes

| Change | What follows |
|---|---|
| The phone moves to another time zone | Due days stay the same dates. Today is the date in the new zone, so a task can become overdue, or not yet. A 09:00 reminder comes at 09:00 there. One that showed can show again further west, as in [Reminders](../reminders/spec.md#examples). |
| Summer time starts or ends | As in Reminders: 02:30 becomes 03:30 on the day it does not exist; on the day it happens twice, the first. |
| The clock is set forward past a reminder | It shows at once, late: "Missed: 09:00". |
| The clock is set back | The mark is never later than now, so a reminder can show again. `updatedAt` still moves forward. A new `doneAt` can be earlier than an older one, and the order of Done can be wrong. |
| Midnight, or a change of time, date or zone, while a screen is open | The screens take the new date: a task due today moves to Overdue. |
| **Done** on a repeating task while the clock is wrong | The next date counts from the phone's today at the press. A clock far ahead skips dates. Changing the due date puts it right. |
| The form open across a change | The checks use the clock at Save: "That time has passed." The date picker starts at today when it opens. |

## The recovery key

As in [Reminders](../reminders/spec.md#the-recovery-key) and
[ADR 0035](../../adr/0035-recovery-key-when-first-needed.md): only a
backup, a restore or the app lock needs it. Tasks is set up on its own,
or with **I already have one**, or with **Get the keys from** an app
that keeps the key ([ADR 0041](../../adr/0041-the-handover-between-apps.md)).

## Backup contents

Tasks follows [backup-format.md](../../architecture/backup-format.md).
**It writes and reads data version 1**, and raises it as
[the format says](../../architecture/backup-format.md#the-data-version).
Two types, named after their tables. The record fields travel in the
container. Deleted records are in the backup too, with their content.
Numbers are big-endian.

`task_list`, 2 + n bytes:

| Offset | Size | Content |
|---|---|---|
| 0 | 2 | n, the name's length in bytes, unsigned, 1 to 240 |
| 2 | n | The name, in UTF-8 |

`task`, 40 + n bytes:

| Offset | Size | Content |
|---|---|---|
| 0 | 16 | `listId`: the 16 bytes of the list's ID, as the [container writes an ID](../../architecture/backup-format.md#record), or 16 zero bytes for Inbox |
| 16 | 1 | `repeat`, `00` to `04` |
| 17 | 1 | `weekdays`, `00`, or `01` to `7f` for every week |
| 18 | 4 | `dueDay`, int32, -1 for none |
| 22 | 4 | `repeatFrom`, int32, -1 for none |
| 26 | 4 | `remindMinute`, int32, -1 for none |
| 30 | 8 | `doneAt`, int64, -1 for none |
| 38 | 2 | n, the title's length in bytes, unsigned, 1 to 800 |
| 40 | n | The title, in UTF-8 |

"Home", and "Call the bank" in Inbox, due 2026-11-16, no reminder, done
at 14:05 in Tbilisi:

```text
0004 486f6d65
00000000000000000000000000000000 00 00 00005125 ffffffff ffffffff 000001a1e3d130e0 000d 43616c6c207468652062616e6b
```

1. Writing is as in [Water](../water/spec.md#writing): every record
   once, no files.
2. The restore takes the records in one transaction, through
   `RecordWriter.takeFromBackup`. It rolls back at: another type name; a
   length other than 2 + n or 40 + n; a name or title that is not UTF-8
   or breaks its limits; any value outside the limits of
   [the tables](#data), which include a repeat without a due day, days
   for a repeat other than every week, a `repeatFrom` missing or out of
   place, a due day that is not a date of its repeat, a reminder without
   a due day, and a `listId` that is neither zero nor a version 4 UUID;
   a record time outside its limits
   ([data.md](../../architecture/data.md#records-from-a-backup)); an ID
   that is there twice in one type; or a File entry.
3. After a restore, each task it took counts from that moment: its
   snooze ends and its notification goes. `notify.sync()` follows in the
   same step, as in [Water](../water/spec.md#after-a-restore).
4. A task with a 20-byte title takes 39 + 4 + 60 = 103 bytes in the
   body. 5,000 tasks take about 515 KB.

## TalkBack

As in Water and Reminders, and:

1. A task row is one item: "Pay rent, due today at 10:00, every month,
   Home, not done". Its actions: "Mark as done" (or "Mark as not done")
   and "Edit".
2. A list row is one item: "Home, 4 open tasks".
3. Overdue, Today and Done are headings.
4. The day chips, the form's errors and the notification line are as in
   [Reminders](../reminders/spec.md#talkback). The snackbars are read,
   with **Undo**.
5. The notification buttons have only their visible text.

## Changes to shared modules

| Module | Change |
|---|---|
| `core/design` | `ShkListItem` gets an optional tick box at its start (`checked`, `onCheckedChange`), a touch target of its own of at least 48dp, beside the row's tap. With none, every row stays as it is. A sample in Catalog, tests and screenshots. |

`core/notify` lacks nothing: a button carries a whole number, the
review sees each button's value, and an alarm in the past fires late.

## Out of scope for version 1

- Subtasks, checklists, a note on a task, priorities, tags, an order by
  hand, colours or icons for lists, archived lists, search, sharing.
- Every N days, an end date, a due time without a reminder, a reminder
  before the due day, several reminders, other snooze lengths.
- A history of the dates a repeating task was done.
- Reminders before the first unlock after a restart
  ([ADR 0010](../../adr/0010-exact-alarms-and-reminder-storage.md),
  point 5).
- Widgets, tiles, shortcuts, Wear OS, sync, Georgian, and "restore as it
  was".

## Decided by the owner

The app: lists, due dates, repeating tasks, and an optional reminder per
task. The owner asked this page to say, for every value and action,
what its limits are and what happens when Tasks stops between two
writes, when a write fails, when a press comes twice or late, and when
the clock or the time zone changes
([When things go wrong](#when-things-go-wrong)). And five answers:

1. Three destinations: Today, which opens first, Lists and Settings.
2. Done on a repeating task moves the same task to its next date after
   today. Dates that were missed are skipped.
3. A reminder is a time on the due day, and needs a due date.
4. Deleting a list deletes its tasks, after a question, with **Undo**.
   Inbox is fixed: it cannot be renamed or deleted.
5. The buttons **Done** and **Snooze 10 min**, as in Reminders.

## Assumptions

Choices this page made without a decision by the owner on that point.

1. Inbox is not a record, so two phones never make two of it.
2. Limits: a title 1 to 200 code points, a list name 1 to 60, at most
   100 lists and 5,000 tasks made in the form; a restore can bring more.
3. A missed reminder shows late, once, as in Reminders.
4. Lists are sorted by name. Two lists may have the same name.
5. The form is a bottom sheet at every width.
6. A new task from Today is due today, in Inbox; from a list, in that
   list with no due day. A reminder starts at 09:00, or at the next full
   hour today.
7. Done tasks stay under Done until deleted. Clearing a tick opens a
   task again.
8. A tick and **Done** carry the due day and the repeat they are for.
9. The channel starts at Urgent, as in Reminders.
10. The optional tick box of `ShkListItem`.
11. The words of every screen, dialog and notification.
12. A fixed binary content. The type names are the table names.

## Open

1. **Sync.** Marks, snoozes and `showing` stay on one phone, so every
   device would remind. A list deleted on one phone while a task is
   added to it on another leaves that task in Inbox. Done on two phones
   on different days keeps the later write. The sync design decides.
2. **Titles of deleted tasks and names of deleted lists** stay in the
   database and backups as deletion markers until a purge exists
   ([data.md](../../architecture/data.md#rules-for-daos), rule 4).
3. **"Local only" for a watch**, as
   [Water's open item 9](../water/spec.md#open).
4. **How TalkBack reads "Snooze 10 min"** on the button.
5. **Many missed reminders at once.** Android caps how many
   notifications one app shows, as
   [Reminders' open item 5](../reminders/spec.md#open) says.
