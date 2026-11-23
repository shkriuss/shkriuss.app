# Tasks changelog

Tasks (`app.shkriuss.tasks`) keeps the things you have to do, in lists,
with a due date, a repeat and a reminder if you want them. Its
specification is
[docs/apps/tasks/spec.md](../../../docs/apps/tasks/spec.md).

## Unreleased

Not released yet.

- The reminders. A task with a due date and a time reminds you on its
  due day at that time, with its title, "Due today" and its repeat, and
  the buttons **Done** and **Snooze 10 min**. **Done** does what a tick
  does: the task is done, or a task that repeats moves to its next date
  and reminds you there. A reminder missed while the phone was off or
  locked shows late, once: "Missed: 09:00". A new due date, repeat or
  time, a tick or a delete takes the reminder off the screen; a new
  title or list alone does not. A tap opens the task's list with the
  task open, or Today if the task is gone. With the app lock on, a
  reminder shows only "Task reminders", without its title or buttons.
- After a save that sets a reminder, while Android has not asked, a
  dialog explains why Tasks shows notifications, and then Android asks.
  While a reminder is to come and notifications cannot show, Today says
  so at the top, with **Allow** or **Open settings**.
- The screens. **Today**, where Tasks opens: what is overdue, then what
  is due today, each section only while it has a task, or "Nothing due
  today.". **Lists**: Inbox, then your lists by name, each with its
  count of open tasks; **New list**; and one list open, with its open
  tasks by due day, its done tasks under **Done**, and a menu with
  **Rename**, **Delete list** and **Delete done tasks**. On a tablet the
  open list is beside Lists. **Settings**, with the version.
- A tick box on each task: a tick marks it done, or moves a repeating
  task to its next date, with **Undo**. Clearing a tick under Done opens
  the task again.
- The task form, a sheet that slides up at every width: the title, the
  list, the due date, the repeat and its days, the dates it gives, and a
  reminder time. Every limit and error of the specification shows under
  its field. A save that fails says so in the form, above its buttons.
- The keyboard is asked not to learn the titles of tasks and the names
  of lists. It still suggests and corrects.
- A row of a list says its due day, "Today" or its date, and not the
  list's name. A date has its year only when it is not this year.
- TalkBack reads each task as one item, with "Mark as done" and "Edit".
- Not there yet: backup and restore, the recovery key and the app lock
  in Settings.
- Everything Tasks stores is in place: lists, with their names, and
  tasks, with their title, list, due date, repeat, days of the week,
  reminder time and when they were done, in one database on the phone;
  and what this phone remembers of the reminder of each task, in one
  small file.
- The rules of the specification work as plain code, with tests: the
  dates of each repeat, with the last day of a shorter month and 29
  February; the next due date when a repeating task is done; the limits
  of every value; which tasks are overdue and due today, and the order
  of Today, Lists and each list; a task whose list is gone shows in
  Inbox; ticks, deletes and Undo, which acts only on what did not
  change since; a tick or a press that comes twice; a write that fails,
  which changes nothing; and the form: its defaults, the limits of a
  title and a name, a reminder time that has passed, Every week with no
  day, at most 5,000 tasks and 100 lists.
- Every screen of Tasks is behind the app lock, with every sheet,
  dialog and menu, and a test checks each of them.
- Permissions: the five of Water, the three of reminders and the two of
  the app lock's screens
  ([permissions.md](../../../docs/security/permissions.md#tasks-appshkriusstasks)).
  Tasks asks only for notifications, and only after a save that sets a
  reminder.
- No other app can reach any part of Tasks but its screen and the two
  parts of the handover between apps, which give nothing: Tasks keeps
  no recovery key. The three receivers of reminders are not exported.
