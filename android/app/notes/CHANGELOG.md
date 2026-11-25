# Notes changelog

Notes (`app.shkriuss.notes`) keeps what you write, with simple
formatting and files you attach, encrypted on your phone, and finds it
again with search. Its specification is
[docs/apps/notes/spec.md](../../../docs/apps/notes/spec.md).

## Unreleased

Not released yet.

- The screens: Notes, with search and one note open, the image view,
  and Settings, in a navigation bar on a phone and a rail on a tablet.
  On a phone a note opens in place of the list, with Back; from 840 dp
  it opens beside the list, with its card marked, or "Choose a note."
  shows there. Turning the phone keeps the open note and the **Undo** of
  a snackbar.
- The list: pinned notes first, under **Pinned** and **Other notes**,
  newest first. Each row shows the title, or the first line of the text,
  two lines of the text without its marks, and the last change with the
  number of files: "09:30 · 2 files", or "Mon, Nov 16" before today.
  TalkBack reads a row as one item. **New note** opens a note with the
  keyboard in the text.
- Search, as you type: the title, the text and the names of files, case
  ignored. A row shows the line that matches, or "File: ticket.jpg",
  with the match in bold. "No notes match “rent”." is announced. Back
  clears the search.
- A note: the title and the text, formatted as you type, with the
  formatting bar above the keyboard: heading, bold, italic, bulleted
  list, numbered list and checklist. A tap on the box of a checklist
  item ticks it; TalkBack offers "Tick" or "Open again". The menu has
  **Pin** or **Unpin** and **Delete note**, with **Undo**. A save that
  fails says so above the title, and closing then asks first.
- Files: **Add a file** opens Android's file picker, several files at
  once. Each file shows under the text, with a small picture for an
  image, its size, or why it cannot be opened, and **Save a copy** and
  **Remove**, with **Undo**. While a file is added, its row says so,
  with a progress bar. An image opens in the image view, which zooms
  from 1× to 5×. **Save a copy** writes the file where you choose, under
  "Saving a copy" with a progress bar.
- Settings: **Files**, how many files Notes keeps and how much of 1 GB
  they take, and **About**, with the version. Backup, the recovery key
  and the app lock come next.
- Everything Notes stores is in place: notes, with their title, text
  and pin, and the records of their files, in one database on the
  phone; and each file in a file of its own, encrypted with its own
  key.
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
- Every screen, dialog and menu of Notes is behind the app lock, and a
  test checks it for each, from now on.
- Permissions: the two of the app lock's screens
  ([permissions.md](../../../docs/security/permissions.md#notes-appshkriussnotes)).
  No notifications, no network, no storage.
- No other app can reach any part of Notes but its screen and the two
  parts of the handover between apps, which give nothing: Notes keeps
  no recovery key.
