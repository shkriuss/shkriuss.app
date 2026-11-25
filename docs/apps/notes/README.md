# Notes

Documents for Notes (`app.shkriuss.notes`): write notes with simple
formatting, attach files, encrypted on the phone, and find them again
with search.

Pages:

- [Specification](spec.md): every screen, the formatting, the data and
  its limits, how files are added, shown, saved and wiped, what happens
  when something goes wrong, backup contents, permissions and TalkBack
  notes, and what is out of scope for version 1.

For users:

- The user guide: [notes.md](../../user/notes.md), with the known
  problems.
- What Notes stores, and what leaves the phone:
  [data-inventory.md](../../security/data-inventory.md#notes-appshkriussnotes).

Decision record from this specification:

- [0042](../../adr/0042-wiping-the-content-of-deleted-records.md): the
  wipe of a deleted record's content.

Code:

- `android/feature/notes`: the data and logic, the files, backup and
  restore, and the screens, in the package `ui`: Notes with its search,
  an open note and its image view, Settings with the rows of the backup,
  the recovery key and the app lock, the dialogs, and Licences.
- `android/app/notes`: the app.
- What changed: [CHANGELOG.md](../../../android/app/notes/CHANGELOG.md).
- How the modules fit together:
  [modules.md](../../architecture/modules.md).
