# Tasks

Tasks keeps the things you have to do, in lists, with a due date if you
want one, a repeat, and a reminder on the due day. Everything stays on
your phone, with no account and no network.

How a task's reminder shows, and what happens to reminders after a
restart, in Private Space and in another profile, is in
[Reminders and notifications](reminders.md#what-tasks-does). This page
is the guide to the Tasks app.

## Install it

1. Install it with Obtainium, as [Install with Obtainium](install.md)
   says. In **Filter release titles by regular expression**, type
   `^tasks-v`.
2. Check it with AppVerifier, as [Verify with AppVerifier](verify.md)
   says. Its package name is `app.shkriuss.tasks`.

Tasks needs Android 15 or newer.

## The first start

1. Open Tasks. It opens on **Today**, which says "Nothing due today."
   There is no setup and no welcome screen.
2. Tap **Add a task** to make your first one.

Tasks asks for your recovery key only when something needs it: a
backup, a restore or the app lock ([Your recovery key](recovery-key.md)).

Tasks has three places, in a bar along the bottom of the screen:
**Today**, **Lists** and **Settings**. On a tablet, or a phone on its
side, the bar is a rail along the side. Each place keeps where you were
when you switch. **Back** from Lists or Settings goes to Today. Back
from an open list goes to Lists.

## Today

**Today** shows what you have to do now, in two sections:

- **Overdue**: tasks that are not done and were due before today,
  oldest first.
- **Today**: tasks due today. Those with a reminder come first, by
  time.

A section with no task is left out. With neither, Today says "Nothing
due today."

Each row has a tick box and the title. Under the title are the list,
the date if the task is overdue, the reminder time and the repeat:
"Home · 09:00 · Every day", or "Inbox · Mon 16 Nov · Every week". The
year shows when it is not this year.

While a task has a reminder still to come and Tasks cannot show
notifications, a line at the top says so, with a button:

| The line says | Button |
|---|---|
| "Tasks may not show notifications yet." | **Allow** |
| "Notifications are off for Tasks. Your reminders are silent." | **Open settings** |
| "Task reminders are turned off in Android's settings. Your reminders are silent." | **Open settings** |

**Add a task** on Today makes a task due today, in Inbox.

## Lists

**Lists** shows **Inbox** first, then your lists by name. Each row says
how many of its tasks are not done: "4 open". Inbox holds the tasks that
are in no list. It cannot be renamed or deleted.

1. To make a list, tap **New list**, type a **Name**, and tap **Save**.
2. Tap a list to open it. On a phone it opens in place of Lists. On a
   tablet held sideways it opens beside Lists.

## A list

An open list shows its tasks that are not done first: those with a due
day, soonest first, then those without one. Under the title of each row
are the due day, "Today" or its date, the reminder time and the repeat:
"Today · 09:00 · Every day". Below them, under **Done**, are the tasks
you ticked, the last one first: "Done Mon 16 Nov".

With no task, the list says "No tasks in this list. Tap Add a task to
make one." **Add a task** in a list makes a task in that list, with no
due date.

The menu at the top of a list, **More options**:

- **Rename**: give the list a new name.
- **Delete list**: Tasks asks "Delete the list Home?" and says how many
  tasks it deletes with it, or "The list is empty." Tap **Delete**. A
  message says "List deleted". Tap **Undo** to bring the list and its
  tasks back.
- **Delete done tasks**, while the list has any: Tasks asks, for
  example, "Delete 12 done tasks?" Tap **Delete**. A message says "12
  tasks deleted". Tap **Undo** to bring them back.

In Inbox, the menu has only **Delete done tasks**, while Inbox has done
tasks.

## Add a task

1. Tap **Add a task**. The form **New task** slides up, with the
   keyboard on **Title**.
2. Type the title.
3. **List** shows the list the task goes in. Tap it to choose another.
4. **Due date**: tap **Add a due date**, or tap the date to change it.
   **Remove** removes the due date, with its repeat and its reminder.
5. With a due date, choose the **Repeat**: **Once**, **Every day**,
   **Every week**, **Every month** or **Every year**. For Every week,
   tap the days under **Days**. A line shows the next dates, such as
   "Dates: Wed 18 Nov, Fri 20 Nov, Mon 23 Nov, …".
6. With a due date, tick **Remind me** for a reminder on the due day,
   and tap **Time** to choose its time.
7. Tap **Save**. A message says "Task added".

After a save that sets a reminder, while Android has not asked yet
whether Tasks may show notifications, Tasks explains in a dialog,
"Allow notifications". Tap **Continue**. Android then asks. Tap
**Allow**. If you tap **Not now**, the dialog comes again after your
next save with a reminder. The task is saved either way.

Good to know:

- A title has 1 to 200 characters: "Enter a title." or "A title has at
  most 200 characters." A list's name has 1 to 60: "Enter a name." or
  "A name has at most 60 characters."
- Tasks asks your keyboard not to learn the words of a title or a name.
  The keyboard still suggests words.
- The due date can be from today to 31 December 2100.
- A reminder starts at 09:00. When the task is due today and 09:00 has
  passed, it starts at the next full hour. A reminder whose time has
  passed is refused: "That time has passed."
- Every week needs at least one day: "Choose at least one day."
- A repeat counts from the date you choose. For Every week, the task is
  due on the first chosen day from that date on.
- Every month on the 31st comes on the last day of a shorter month.
  Every year on 29 February comes on 28 February in a year without it.
- A reminder counts from the minute you save it.
- Tasks keeps up to 5,000 tasks and 100 lists: "Tasks keeps 5,000 tasks.
  Delete some to add more." and "Tasks keeps 100 lists. Delete one to
  add another."
- If a save fails, the form stays open with what you typed, and says
  "Could not save the task. Try again."

## Tick a task

Tap the tick box of a task when you have done it.

1. A task with no repeat is done. It moves under **Done** in its list. A
   message says "Task done".
2. A task that repeats moves to its next date after today, or after its
   due date if you tick it early, and stays not done. A message says
   when, for example "Next: Wed 18 Nov". Dates you missed are skipped.
3. Tap **Undo** in the message to put the task back as it was.
4. To open a done task again, clear its tick under **Done**.

## Change or delete a task

1. Tap a task. The form **Edit task** opens. For a done task, it says
   when, for example "Done on Mon 16 Nov."
2. Change it, and tap **Save**. A new due date, repeat or time counts
   from now: a snooze ends, and its notification goes. A new title or
   list alone leaves its notification as it is.
3. Or tap **Delete**. A message says "Task deleted". Tap **Undo** to
   bring it back.

## Settings

Tasks has no settings of its own. The snooze is always 10 minutes.

**Backup**: **Make a backup** and **Restore a backup**
([Back up and restore](#back-up-and-restore)).

**Security**: **Recovery key** and **App lock**
([The recovery key and the app lock](#the-recovery-key-and-the-app-lock)).

**About**: the version, and **Licences**, which lists everything made by
others that is inside Tasks, with its licence.

## Notifications

A task with a due date and a reminder time reminds you on its due day,
at that time, also while the screen is off. The notification has the
task's title, the text "Due today" with the repeat after it, and two
buttons, **Done** and **Snooze 10 min**. A done task has no reminder.

1. **Done** does what a tick does: the task is done, or a task that
   repeats moves to its next date, and reminds you there at the same
   time.
2. **Snooze 10 min**: it shows again 10 minutes later, with "Snoozed. It
   was due at 09:00."
3. A swipe, or no answer, leaves the task as it is.
4. On the lock screen, a button first asks you to unlock the phone.
5. A button works once, and only on the newest notification of its
   task.

A tap on the notification opens Tasks, after the app lock, on the task's
list with the task open. If you deleted the task, Tasks opens on
**Today**.

A missed reminder shows late, once: "Missed: 09:00", or "Missed: Mon 16
Nov, 09:00" when it was another day. The details, and the times when it
happens, are in
[Reminders and notifications](reminders.md#what-tasks-does).

Times are the phone's local time. A due date stays the same date in
another time zone, and a 09:00 reminder comes at 09:00 there.

Who else can see a reminder:

- On the lock screen, Android shows its title only if your phone's
  setting allows it.
- A task's title and buttons reach another app only if you gave that
  app notification access. Such an app can pass them on to a watch. It
  can also press the buttons, without the phone's unlock.
- With the app lock on, a reminder shows only "Task reminders" and "The
  app lock hides this notification. Open the app to see it.", without
  its title and without buttons. Unless you turn on **Show the text in
  notifications** on the app lock screen.
- If you turned on Android's notification history, Android keeps the
  notifications of the last 24 hours there, with their titles, also
  after you deleted the task.

## Back up and restore

A backup is one file that holds your lists and tasks. You choose where
it goes. How backups work for every app is in
[Back up and restore](backup.md).

Make a backup:

1. In **Settings**, tap **Make a backup**.
2. The first time, Tasks asks you to set up your recovery key. If Water,
   or another app of the suite, keeps your recovery key on this phone,
   tap **Get the keys from Water**. You type no words
   ([Get the keys from another app](recovery-key.md#get-the-keys-from-another-app)).
   If it has your key but does not keep it, tap **I already have one**
   and enter the same 24 words. Otherwise tap **Create a recovery key**.
3. Android's file picker opens, with a name such as
   `tasks-2026-11-16.shkbackup`. Pick a place and tap **Save**.
4. Tasks writes the file, reads it again and checks it. It says "Backup
   written" and how many tasks the backup holds.

Restore a backup:

1. In **Settings**, tap **Restore a backup**, and pick the file.
2. Tasks checks the whole file first. It asks "Restore this backup?",
   with when it was made and how many tasks it holds.
3. Tap **Restore**, or **Cancel** to change nothing.

For every list and task, the newest edit stays. A restore cannot undo a
deletion or an edit you made after the backup.

After a restore, each task the restore took counts from that moment. A
reminder time that passed before the restore does not show late. Its
snooze ends, and its notification goes. A task whose list is deleted
shows in Inbox. It goes back to its list if the list comes back.

Restore on a new phone:

1. Install Tasks, open **Settings** and tap **Restore a backup**. Tasks
   says "Enter your recovery key first".
2. Tap **Enter the words**, and type your 24 words. The file picker then
   opens by itself.
3. Pick the file, and tap **Restore** at the question. Your lists and
   tasks are back.
4. If a task has a reminder to come, Today says "Tasks may not show
   notifications yet." Tap **Allow**, then **Continue**, then **Allow**
   in Android's question.

In Tasks' backup: every list, with its name, and every task, with its
title, list, due date, repeat, days of the week, reminder time and when
it was done, and the deleted ones, marked as deleted. Not in it: the app
lock and its settings, what this phone remembers of each reminder, such
as a snooze, and your recovery key.

## The recovery key and the app lock

- **Recovery key** opens the security screen. Create your 24 words
  there, enter them, get the keys from another app that keeps them, or
  see them again
  ([Your recovery key](recovery-key.md)). If another app of the suite
  already has your recovery key, tap **I have a recovery key** there and
  enter the same words. Use the same words in every app
  ([One key for every app](recovery-key.md#one-key-for-every-app)).
- **App lock** makes Tasks ask for your fingerprint, or your phone's
  PIN, pattern or password, before it shows anything
  ([The app lock](app-lock.md)). It needs the recovery key. Tasks still
  shows your reminders at their time while it is locked.

## TalkBack

- Each task row is one item, such as "Pay rent, due today at 10:00,
  every month, Home, not done". In a list it leaves out the list's name.
  A done task: "Water the plants, done on Monday 16 November". Its
  actions are "Mark as done", or "Mark as not done", and "Edit".
- Each row of Lists is one item, such as "Home, 4 open tasks".
- **Overdue**, **Today** and **Done** are headings, so you can jump
  between them. So are the section headers of Settings.
- A day of the week in the form reads the whole day: "Monday,
  selected".
- The errors of the form are read out.
- The line about notifications and its button come before the tasks.
- The messages after a tick, a save or a deletion are read out, with
  **Undo** where they have one.
- The buttons of a notification have only their visible text.

## Permissions

Tasks asks Android for five permissions, and no other:

| Permission | What it is for | Who decides |
|---|---|---|
| Notifications | To show a task's reminder | You. Tasks explains after a save that sets a reminder, then Android asks. |
| Alarms at an exact time | To show a reminder at its minute | Android, at install |
| Run at start-up | To set the reminders again after a restart | Android, at install |
| Use biometric hardware | To show Android's own prompt for the app lock and your recovery key | Android, at install |
| Hide other apps' windows | To hide other apps' windows over the recovery key screens and the lock screen | Android, at install |

Tasks has no network permission and no storage permission. It reaches
only the one file you pick. The details are in
[permissions.md](../security/permissions.md#tasks-appshkriusstasks).

## Your data

Everything Tasks stores stays on your phone, in Tasks' own storage. It
sends nothing over the network, has no account and tracks nothing. What
it stores, file by file, and what can leave the phone, is in the
[data inventory](../security/data-inventory.md#tasks-appshkriusstasks).

A deleted task stays as a marked row, with its title, and a deleted
list with its name, until you clear Tasks' storage. Backups you make
after the deletion hold them too, marked as deleted.

To delete everything: in Android's Settings, open **Apps**, then
**Tasks**, **Storage**, and tap **Clear storage**. That also deletes
Tasks' keys. A backup then opens only with your 24 words.

## Known problems

Tasks is not released yet. Its first version has these known problems
and limits.

Not known yet:

1. How TalkBack reads "Snooze 10 min" on the button of a notification.
2. Whether reminders are lost when many were missed at once. Android
   limits how many notifications one app shows.
3. Whether TalkBack goes back to the item that opened a sheet or a
   dialog, when it closes. Tasks does nothing of its own for it.

Limits of reminders:

4. No reminder comes after a restart until you unlock the phone once.
   Tasks cannot run before that. Then a missed reminder shows late.
5. No reminder comes while Tasks' profile or Private Space is stopped,
   or after **Force stop**, until Tasks runs again. Then a missed
   reminder shows late, once.
6. After you set the clock back, or move to a time zone further west, a
   reminder that showed can show again.
7. On the night the clocks go back, a task you restore, bring back with
   **Undo** or open again between 02:00 and 03:00 can remind at once as
   "Missed", if its time in that hour already went by once.
8. A task's title and buttons reach apps you gave notification access.
   Such an app can pass them on to a watch, and can press the buttons
   without the phone's unlock. Tasks does not mark its reminders "local
   only". Whether it should is not decided yet.
9. With the app lock off, the lock screen shows a task's title if your
   phone's setting allows it.
10. With Android's notification history on, a task's title stays there
    for 24 hours, also after you delete the task. Turn the history off in
    Android's notification settings if you do not want that.
11. A keyboard can ignore the request not to learn the words of a title
    or a name.

Limits of the clock:

12. A tick on a task that repeats counts from the phone's date. If the
    phone's clock is far ahead, dates are skipped. Change the due date
    to put it right.
13. After you set the clock back, the order under **Done** can be wrong.

Limits of the recovery key:

14. Tasks sees only the apps of the suite that keep your recovery key
    and are signed like it. If another app has your key but does not
    keep it on this phone, tap **I already have one** yourself, and enter
    the same words. If it keeps it, Tasks offers **Get the keys from**
    that app ([Get the keys from another app](recovery-key.md#get-the-keys-from-another-app)).

Limits of the app lock:

15. If you choose a time in **Lock the app** and turn the screen off
    from another app, Tasks may stay unlocked until that time has passed
    ([The app lock](app-lock.md#when-the-app-locks)).
16. The app lock hides your tasks. It does not encrypt them. Android's
    own encryption protects them, with your screen lock.

Limits of backups:

17. A restore keeps the newest edit of each list and task. It cannot
    bring back exactly how Tasks was on the day of the backup.
18. Some storage apps do not let Tasks read a file again right away, or
    hand back an older copy. Tasks then says "Backup written, not
    checked". Check such a file with **Restore a backup**, and tap
    **Cancel** at the question.
19. A deleted task stays in Tasks' storage, with its title, and a
    deleted list with its name, marked as deleted, until you clear
    Tasks' storage. Backups you make after the deletion hold them too.
    Clearing the storage does not change backup files you already made:
    delete those where you put them. Tasks cannot yet remove deleted
    tasks and lists for good.

Other:

20. When the phone's storage is completely full, a save can fail, and a
    save, a tick or a delete can close Tasks. What was saved before
    stays. A snooze or a change in the app lock's settings can be lost
    when Tasks stops. Free some room on the phone.
21. Never type your real recovery words into a preview build of a pull
    request. Use test words.
22. No accessibility checks run on an emulator for Tasks. A TalkBack
    pass on a phone stands in for them.
23. Two dialogs have no screenshot test, because a test cannot reach
    them: "No backup was made" and the answer "No keys" of a restore.
    Their words were not checked at a large font size.

Not in the first version:

- Subtasks, checklists, a note on a task, priorities, tags, an order you
  choose by hand, colours or icons for lists, archived lists, search and
  sharing.
- Every N days, an end date, a due time without a reminder, a reminder
  before the due day, several reminders, and other snooze lengths.
- A history of the dates a repeating task was done.
- Widgets, tiles, shortcuts, a watch app, and sync.
- Other languages than English.
