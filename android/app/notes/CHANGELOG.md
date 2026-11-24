# Notes changelog

Notes (`app.shkriuss.notes`) keeps what you write, with simple
formatting and files you attach, encrypted on your phone, and finds it
again with search. Its specification is
[docs/apps/notes/spec.md](../../../docs/apps/notes/spec.md).

## Unreleased

Not released yet.

- The app starts, and shows one line: "Notes' screens are not built
  yet." The screens replace it.
- Everything Notes stores is in place, behind the screens that come
  next: notes, with their title, text and pin, and the records of their
  files, in one database on the phone; and each file in a file of its
  own, encrypted with its own key.
- The rules of the specification work as plain code, with tests: the
  limits of every value; how a title, a text, a file name and a type
  are kept from what is typed or picked; the marks of the text, the
  formatting bar, Enter at the end of an item and a tap on a box;
  search, which ignores case and nothing else; and the order of the
  list, pinned notes first.
- Saving: a second after the last change, at least every 10 seconds
  while typing goes on, and when the note closes. A new note writes
  nothing until it has a title, a text or a file, and an empty note is
  deleted when it closes. A save that fails changes nothing, and closing
  then asks first.
- Files: added one at a time, also across notes, and only while Notes
  is on the screen and open; at most 25 MB each, 20 per note and 1 GB in
  all. A file whose note was deleted while it was copied is not added.
  Each file shows whether it can be opened, and **Save a copy** writes
  it out byte for byte, or tries to delete a copy that met damage.
- Deleting a note or removing a file offers **Undo**. When the Undo
  ends, the text, the file names and the keys are wiped and the files
  are removed. At every start Notes wipes what a stop left.
- The keys of files added before the recovery key move to it, without
  changing which edit wins in a restore.
- Every screen of Notes is behind the app lock, and a test checks it
  for every screen, from now on.
- Permissions: the two of the app lock's screens
  ([permissions.md](../../../docs/security/permissions.md#notes-appshkriussnotes)).
  No notifications, no network, no storage.
- No other app can reach any part of Notes but its screen and the two
  parts of the handover between apps, which give nothing: Notes keeps
  no recovery key.
