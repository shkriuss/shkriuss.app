# Reminders

Documents for Reminders (`app.shkriuss.reminders`), the second app: set
one-time and repeating reminders with a title, and see each one as a
notification at its time.

Pages:

- [Specification](spec.md): every screen, the data, when a reminder
  shows, the notification, backup contents, permissions and TalkBack
  notes, and what is out of scope for version 1.

For users:

- The user guide: [reminders-app.md](../../user/reminders-app.md), with
  the known problems of 1.0.0.
- What Reminders stores, and what leaves the phone:
  [data-inventory.md](../../security/data-inventory.md#reminders-appshkriussreminders).

Code:

- `android/feature/reminders`: the data and logic, backup and restore,
  and the screens, in the package `ui`: Upcoming, Past, Settings with
  the rows of the backup, the recovery key and the app lock, the form,
  the dialogs, and Licences.
- `android/app/reminders`: the app.
- What changed: [CHANGELOG.md](../../../android/app/reminders/CHANGELOG.md).
- How the modules fit together:
  [modules.md](../../architecture/modules.md).
