# Notes

Documents for Notes (`app.shkriuss.notes`): write notes with simple
formatting, attach files, encrypted on the phone, and find them again
with search.

Pages:

- [Specification](spec.md): every screen, the formatting, the data and
  its limits, how files are added, shown, saved and wiped, what happens
  when something goes wrong, backup contents, permissions and TalkBack
  notes, and what is out of scope for version 1.

Decision record from this specification:

- [0042](../../adr/0042-wiping-the-content-of-deleted-records.md): the
  wipe of a deleted record's content.

Code:

- `android/feature/notes`: the data and logic. The screens are not
  built yet. They go there too.
- `android/app/notes`: the app. Until the screens come, it shows one
  line in their place.
- What changed: [CHANGELOG.md](../../../android/app/notes/CHANGELOG.md).
- How the modules fit together:
  [modules.md](../../architecture/modules.md).
