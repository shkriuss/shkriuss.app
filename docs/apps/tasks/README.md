# Tasks

Documents for Tasks (`app.shkriuss.tasks`): keep the things you have to
do in lists, with an optional due date, repeat and reminder.

Pages:

- [Specification](spec.md): every screen, the data and its limits,
  repeats, when a task reminds, what happens when something goes wrong,
  backup contents, permissions and TalkBack notes, and what is out of
  scope for version 1.

For users:

- The user guide: [tasks.md](../../user/tasks.md), with the known
  problems.
- What Tasks stores, and what leaves the phone:
  [data-inventory.md](../../security/data-inventory.md#tasks-appshkriusstasks).

Code:

- `android/feature/tasks`: the data and logic, backup and restore, and
  the screens, in the package `ui`: Today, Lists and an open list,
  Settings with the rows of the backup, the recovery key and the app
  lock, the form, the dialogs, and Licences.
- `android/app/tasks`: the app.
- What changed: [CHANGELOG.md](../../../android/app/tasks/CHANGELOG.md).
- How the modules fit together:
  [modules.md](../../architecture/modules.md).
