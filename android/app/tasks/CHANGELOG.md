# Tasks changelog

Tasks (`app.shkriuss.tasks`) keeps the things you have to do, in lists,
with a due date, a repeat and a reminder if you want them. Its
specification is
[docs/apps/tasks/spec.md](../../../docs/apps/tasks/spec.md).

## Unreleased

Not released yet.

- The app starts, and shows one line: "Tasks' screens are not built
  yet." The screens replace it.
- Everything Tasks stores is in place, behind the screens that come
  next: lists, with their names, and tasks, with their title, list, due
  date, repeat, days of the week, reminder time and when they were
  done, in one database on the phone; and what this phone remembers of
  the reminder of each task, in one small file.
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
- Every screen of Tasks is behind the app lock, and a test checks it
  for every screen, from now on.
- Permissions: the two of the app lock's screens
  ([permissions.md](../../../docs/security/permissions.md#tasks-appshkriusstasks)).
  Tasks does not ask for the three of reminders before it shows
  reminders.
- No other app can reach any part of Tasks but its screen and the two
  parts of the handover between apps, which give nothing: Tasks keeps
  no recovery key.
