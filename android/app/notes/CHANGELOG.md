# Notes changelog

Notes (`app.shkriuss.notes`) keeps what you write, with simple
formatting and files you attach, encrypted on your phone, and finds it
again with search. Its specification is
[docs/apps/notes/spec.md](../../../docs/apps/notes/spec.md).

## Unreleased

- Ready for the Sync app, which is not released yet: when Sync asks,
  Notes can sign that this phone may join your sync server. Notes shows
  the server and asks you to allow it. If Notes keeps your recovery key,
  you confirm with your fingerprint or screen lock; if not, you enter
  the 24 words of its own key. Sync gets no keys of Notes and never the
  words.

## 1.0.0 (2026-11-26)

Released as `notes-v1.0.0`.

The first release of Notes. How to use it:
[Notes](../../../docs/user/notes.md).

- An **Undo** that cannot be written, for example on a full phone,
  keeps its **Undo**: "Could not change your notes. Try again." shows
  with the button, so you can press it again. Nothing is deleted for
  good until that message goes.
- With no pinned note, the list has no headings, and its first note
  keeps a gap from the search field.
- A row of the list keeps the first 1,000 characters of its note's
  text, and Notes reads notes and file records a few at a time: in the
  list, a search, a backup and the move of the file keys. So very many
  very long notes, or tens of thousands of files, do not use up its
  memory. TalkBack reads a row with those 1,000 characters at most.
- The list and a search are much faster with long notes. A row is made
  from the start of its note's text, not from the whole of it, and a
  search lower-cases each text once. What they show is the same.
- A message about a file that is still being added, such as "The note
  was deleted. The file was not added.", waits while a message with
  **Undo** shows, and shows after it. So it never ends an **Undo**.

- Settings has the sections Files, Backup, Security and About, as in
  Tasks. About shows the version and **Licences**, which lists
  everything made by others that is inside Notes, with its notice and
  its licence.
- **Make a backup** and **Restore a backup**, as in Tasks: the file
  picker, a name such as `notes-2026-11-24.shkbackup`, a check of every
  backup right after it is written, "It holds 42 notes and 12 files",
  the question before a restore, and every answer for a file Notes does
  not take. A backup holds the notes and the records of their files,
  deleted ones too, and the encrypted bytes of each file that is on the
  phone, with data version 1. A restore refuses a record with any value
  outside its limits, and then changes nothing.
- Before a backup, Notes wipes what is still deleted, so a backup never
  holds a deleted note. If it cannot: "Notes could not finish deleting
  some notes first. Try again." A file that is not on the phone or is
  damaged is left out, and the backup says how many: "2 files are not
  on this phone or are damaged, and are not in this backup."
- While a backup, its check or a restore runs, its dialog shows a
  progress bar and the percent, and the screen stays on. The work goes
  on when Notes leaves the screen.
- After a restore, the files move in, and a file of a note that is
  deleted is deleted and wiped. A note this phone deleted comes back
  only with a later edit from another copy of Notes.
- **Recovery key** opens the security screen, and **App lock** the app
  lock screen. A backup, a restore and the app lock ask for the
  recovery key when they first need it, and offer the keys of another
  app of the suite that keeps them. The keys of files added before the
  recovery key move to it then. A key that cannot move stops a backup:
  "Notes cannot move some files to your recovery key yet. Remove the
  files marked damaged, or open Recovery key in Settings."
- With the app lock on, Notes asks for your fingerprint, or your
  phone's PIN, pattern or password, before it shows anything. Its app
  lock screen has no choice about the text of notifications: Notes
  shows none.
- The user guide, [notes.md](../../../docs/user/notes.md).
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
  with the match in bold. A long line whose match is far from its start
  shows from a word a little before the match, after "…", so the match
  stays in sight. "No notes match “rent”." is announced. Back clears
  the search.
- A note: the title and the text, formatted as you type, with the
  formatting bar above the keyboard: heading, bold, italic, bulleted
  list, numbered list and checklist. Bold and italic on a selection
  over several lines mark each line. A tap on the box of a checklist
  item ticks it; TalkBack offers "Tick" or "Open again". The menu has
  **Pin** or **Unpin**, which a new note offers once it has a title, a
  text or a file, and **Delete note**, with **Undo**. A save that
  fails says so above the title, and closing then asks first.
- Files: **Add a file** opens Android's file picker, several files at
  once, and tries at most 42 of one pick. Notes takes from the picker, and writes a copy to, only a
  document of another app, never a path to its own files. Each file
  shows under the text, under the heading **Files**, with a small
  picture for an
  image, its size, or why it cannot be opened, and **Save a copy** and
  **Remove**, with **Undo**. While a file is added, its row says so,
  with a progress bar once its size is known. An image opens in the image view, which zooms
  from 1× to 5×. **Save a copy** writes the file where you choose, under
  "Saving a copy" with a progress bar.
- Settings: **Files**, how many files Notes keeps and how much of 1 GB
  they take, or "Could not open your notes." when they cannot be
  counted.
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
  parts of the handover between apps, which give keys only when you
  allow it, as in Water.
