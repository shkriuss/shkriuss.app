# Tasks

Your to-do list, with dates, lists and reminders. Lives at
<https://tasks.shkriuss.app>.

- `src/lib/tasks.ts`: the rules as plain functions, with unit tests next to
  them (`tasks.test.ts`). A task has a title, plus optional notes, steps
  (smaller things to do in it, each with its own tick; the form adds up to
  50, and steps added on two devices at once are all kept), a date
  and time, a repeat (every day, weekday, week, month or year, or every so
  many: "every 2 weeks", up to 99), a reminder, a list and an "important"
  star. Saved on the device under `shkriuss:tasks` (data version 3; older
  versions, without steps or "every", are read by `migrateTasks`). Tasks
  still to do are grouped by when they're due (overdue, today, tomorrow,
  later, no date), or shown in your own order ("My order": the order of the
  saved tasks, so sync keeps it too; `moveTask`). Ticking off a repeating
  task moves it to its next date after today, with its steps unticked, and
  keeps a done copy. With no next date by 9999-12-31, the last date there
  is, it's simply done; so is one whose "every" is bigger than the form
  allows (from a backup or another device) and goes past it (`nextDate`).
- `src/lib/lists.ts`: your lists ("Work", "Home"…), with tests
  (`lists.test.ts`). There are none to begin with. Saved under
  `shkriuss:task-lists`. Deleting a list keeps its tasks (without a list),
  moves them to another list, or deletes them, as you choose. "Delete them
  too" and "Delete done tasks" delete only the tasks their dialog counted
  when it opened: one added to the list, or ticked off, on another device
  meanwhile stays (a task added to the deleted list stays without a list,
  and the page says so; `removeListTasks`, audit 7 F1-3).
- `src/scripts/tasks.ts`: connects the page to those rules and saves with
  `@shkriuss/storage`. "Add" puts a task in what's shown (a list, or
  Important). Search finds tasks in what's shown by every word typed, in
  their titles, notes and steps (`matchesSearch`; capitals and accents don't
  matter). In the list, a task's steps fold out under it and can be ticked
  there straight away. Whether the list is by date or in your order is a
  setting for this device only (`shkriuss:task-view`, not synced). The
  rest has files of their own next to it:
  - `views.ts`: what's shown, chosen with the chips (All, Important, or a
    list);
  - `task-form.ts`: the form that opens from a task's title, where steps
    are added, renamed, ticked and removed (`step-edits.ts`; kept only on
    "Save", which adds a step still typed in "New step" too);
  - `order.ts`: "My order", where a task is moved by dragging its handle
    (pointer events, so it works with a finger, a mouse or a pen), by
    tapping the handle for "Move up" and "Move down", or with the arrow
    keys on the handle;
  - `list-editor.ts`: adding, renaming and deleting lists.

  The task form and the list editor load after the page itself
  (`later.ts`, with `import()` once the page has nothing else to do, as
  Repairs' forms do), so opening the page loads less and stays within its
  size budget.

- `src/scripts/reminders.ts`: reminders while Tasks is open, and, if "Also
  remind me when Tasks is closed" is on, through the shared notification
  service ([ADR 0009](../../docs/adr/0009-push-notifications.md)). Without a
  time, a task is reminded about at 9:00. A reminder is part of its task, so
  it syncs too; each device then uploads it to its own notification service,
  the next time Tasks opens there (`e2e/sync.spec.ts` checks this). Until
  then, a task ticked off or changed elsewhere is still reminded there at
  its old time (the page says so).
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for a group, a task, a step (in the list and
  in the form) and a list button; the forms are dialogs.
- `src/worker.ts`: runs the shared notification and sync servers. With
  sync on ([ADR 0010](../../docs/adr/0010-account-and-sync.md)), the newest
  change to each task and list wins. A task's form that's open while a sync
  (or another tab) changes the task saves only what was changed in the form
  (`editedTask`), so the other change stays: a task ticked off elsewhere
  stays on its next date, and its steps are merged one by one, so a step
  ticked elsewhere stays ticked while another step is renamed here. Save
  with nothing changed changes nothing, not even the time the task last
  changed, so it can't win over a change another device hasn't synced yet
  (also for the done copy of a monthly or yearly task, audit 7 F1-2). Text
  the form didn't change is saved as it is, never cut: browsers don't all
  count characters the same way (Hindi "क्ष" is one in newer ones, two or
  three in older ones), so text another device let in can count as too long
  here (`cutChanged`, audit 7 F1-1). List names too.
  A task deleted meanwhile: the form says so, and
  saving a change brings it back; Save with nothing changed, or Delete,
  leaves it deleted. The same goes for a list deleted while "Edit list" is
  open.
- `e2e/`: browser tests (`helpers.ts` is shared by them). The shared
  accessibility, security and offline checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
