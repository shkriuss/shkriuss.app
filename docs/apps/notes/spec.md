# Notes: specification

What Notes does, screen by screen, what it stores, how it keeps files,
what happens when something goes wrong, and what goes into its backup.
Where Water or Tasks already decided a part, this page links to
[Water's specification](../water/spec.md) or
[Tasks' specification](../tasks/spec.md) and says only what differs. If
this page is wrong or silent, the fix is a change to this page first,
agreed with the owner.

- Package `app.shkriuss.notes`. App name in keys and backups: `notes`.
  Modules `android/feature/notes` and `android/app/notes`.
- Notes is the first app that stores files. It answers what
  [crypto-design.md](../../security/crypto-design.md#open-questions)
  (question 13) and
  [backup-format.md](../../architecture/backup-format.md#open-questions)
  (questions 3 and 4) leave to that app.
- One decision record comes from this page:
  [0042](../../adr/0042-wiping-the-content-of-deleted-records.md), the
  wipe of a deleted record's content.
- The page ends with what the owner [decided](#decided-by-the-owner),
  every [assumption](#assumptions) and what is still [open](#open).

## What Notes is for

Notes keeps what you write, with simple formatting and files you attach,
and finds it again with search. It keeps everything on your phone, with
no account and no network, and encrypts every file.

## At a glance

| Part | Choice |
|---|---|
| Screens | Notes, with search and one note open; the image view; Settings |
| Stored | Notes and the records of their files, in two tables, `note` and `attachment`. Each file in a file of its own, encrypted with its own key. |
| Formatting | Marks in the text: headings, bold, italic, bullets, numbers, checklists. Shown styled as you type. |
| Files | Any kind, through the system picker. At most 25 MB each, 20 per note, 1 GB in all. |
| Leaving Notes | Images show inside Notes. Any file can be saved out with **Save a copy**. Nothing else. |
| Search | Titles, text and file names, as you type |
| Saving | Automatic: a second after you stop typing, and when the note closes |
| Deleting | With **Undo**. Then the text and the files are wiped. |
| Reminders | None |
| Backup | Data version 1. Two record types and the files. A progress bar, and the screen stays on. |
| Permissions | The two of `core/security`. No notifications, no network, no storage. |

## As in Water and Tasks

| Part | What differs in Notes |
|---|---|
| [Navigation](../water/spec.md#navigation) | The activity is `NotesActivity`. Two destinations: **Notes** (the start) and **Settings**. Back from an open note goes to Notes; from the image view, to its note. |
| [Settings screen](../water/spec.md#settings-screen) | Backup, Security and About, as in Tasks, and the section [Files](#settings). |
| [Backup and restore screens](../water/spec.md#backup-and-restore-screens) | "Water" becomes "Notes": "It holds 42 notes and 12 files." The file: `notes-2026-11-24.shkbackup`. A progress bar in place of the circle ([Writing](#writing)). |
| [Licences](../water/spec.md#licences), [Every screen](../water/spec.md#every-screen) | Nothing. Notes keeps its own list and texts, as Tasks does. |
| [The database](../water/spec.md#the-database) | `notes.db`, version 1, the tables [`note`](#table-note), [`attachment`](#table-attachment) and `change_counter`. |
| [Files](../water/spec.md#files) | Replaced by [Files](#files). Notes stores files, so it never finishes a pending file key move at once. |
| [Asking for notifications](../water/spec.md#asking-for-notifications) | Nothing: Notes shows no notifications. |
| [Permissions](../water/spec.md#permissions) | See [Permissions](#permissions). |

## Words used on this page

- **Note.** A title and a text, and the files attached to it. A **shown**
  note is one that is not deleted.
- **File.** One attached file: its `attachment` record, and its
  **stream**, the encrypted bytes on the phone (blob kind 2 of
  [crypto-design.md](../../security/crypto-design.md#kind-2-file-stream)).
  A shown file is not deleted, and its note is shown.
- **Marks.** The characters in the text that give it its formatting,
  such as `**` for bold.
- **Last change.** The latest `updatedAt` of a note and of its files,
  deleted files too.
- **Wipe.** Clearing the content of a deleted record, and removing its
  stream ([ADR 0042](../../adr/0042-wiping-the-content-of-deleted-records.md)).
- **Characters** are Unicode code points.

## Screens

### Notes

1. Top bar: "Notes". Under it a field, **Search notes** ([Search](#search)).
2. The shown notes, by last change, newest first. Ties: `createdAt`, then
   `id`. With a pinned note, two sections, **Pinned** and **Other
   notes**; without one, no heading.
3. A row is a `ShkCard`: the title; up to two lines of the text, marks
   removed and line breaks as spaces, cut with "…"; then the last change
   and the number of files: "14:05 · 2 files". A date shows as in Tasks,
   "Mon 16 Nov", with its year when it is not this year. With no title,
   the first line of the text is the title; with neither, "Empty note".
4. A tap opens the note: in place under 840dp, with Back. From 840dp,
   `ShkListDetailScaffold`: the list, 360dp wide, and the open note
   beside it, or "Choose a note."
5. With no note: `ShkEmptyState`, "No notes yet", "Tap New note to write
   one."
6. A floating button, **New note**. At 5,000 shown notes it shows the
   snackbar "Notes keeps 5,000 notes. Delete some to add more."

### Search

1. What you type filters the list, 300 ms after you stop. A note matches
   when its title, its text or the name of one of its shown files holds
   what you typed. Case is ignored: both sides are lower-cased by
   Unicode's rules. Nothing else is folded: "e" does not match "é".
   Marks are text.
2. The rows keep their order and sections. Under the title they show the
   first line of the text that matches, as it is stored, with the match
   in bold, or "File: ticket.jpg" for a match in a file name only.
3. With no match: "No notes match “rent”.", announced by TalkBack.
4. Back with text in the field clears it. The field asks the keyboard
   not to learn. Nothing of a search is stored.

### A note

1. Top bar: Back, under 840dp; **Add a file**, an icon button; a menu
   with **Pin** or **Unpin**, and **Delete note**.
2. **Title**: one line, in the title style, with the hint "Title". Enter
   moves to the text.
3. **Text**: as many lines as it needs, with the hint "Note", formatted
   as you type. While it has the focus, the formatting bar sits above
   the keyboard ([Formatting](#formatting)).
4. **Files**: under the text, the heading "Files" and one row per shown
   file, oldest first (`createdAt`, then `id`): a small image for an
   image that can be shown, a file icon otherwise; the name; under it
   the size, "2.4 MB", or why it [cannot be opened](#files-that-cannot-be-opened);
   at the end a **More** button with **Save a copy** and **Remove**. A
   tap on an image opens the [image view](#the-image-view); on another
   file, the same menu. While a file is added, its row says "Adding
   ticket.jpg", with a `ShkProgressBar`.
5. A new note opens with the keyboard in the text. A note that exists
   opens at its top, with no keyboard. Both fields ask the keyboard not
   to learn what is typed, as the titles of Reminders and Tasks do.
6. A change that would pass a [limit](#limits-and-defaults) is refused,
   and the field keeps what it had, with the words under it until the
   next change: "A title has at most 200 characters." or "A note has at
   most 100,000 characters."
7. Line breaks are stored as `\n`; `\r\n` and `\r` become `\n`, and in the
   title a space. Tabs stay in the text. Other control characters are
   removed from what is typed or pasted. Spaces at both ends of the
   title are removed when it is saved.
8. **Delete note** closes the note, with the snackbar "Note deleted" and
   **Undo**. Its files go with it. **Pin** and **Unpin** move the note
   between the sections at once.
9. If a restore deletes the note while it is open, it closes.

### Saving

1. There is no Save button. Notes saves a note one second after the last
   change, and when the note closes, another note opens, or Notes leaves
   the screen or locks. Each save is one transaction. A save with no
   change writes nothing.
2. A new note writes nothing until it has a title, a text or a file.
3. A note that is empty when it closes, with no title, text or file, is
   deleted and wiped, with no snackbar: nothing is lost.

### The image view

1. It takes the place of the note, in the same pane. Top bar: Back, the
   file's name, and a menu with **Save a copy** and **Remove**.
   **Remove** goes back to the note, with the snackbar "File removed"
   and **Undo**.
2. The image fits the pane. Pinch to zoom from 1× to 5×, drag to move it
   while zoomed, double tap to switch between 1× and 2.5×.
3. While it is decoded: `ShkLoadingState`. When it cannot be shown:
   "Notes cannot show this image.", with the button **Save a copy**.

### Settings

As in Tasks, with one more section, **Files**, above Backup: one line
that is not a button, "12 files, 120 MB of 1 GB", or "No files". It
counts the files that are not deleted, as the limit does.

## Formatting

Marks are plain characters of the text, as in Markdown. Notes knows
these, and nothing else:

| Mark | Where | Meaning |
|---|---|---|
| `# ` | At the start of a line | The line is a heading |
| `- ` | At the start of a line | A bullet |
| A number from 1 to 99,999, `.`, a space | At the start of a line | A numbered item. A text of 100,000 characters never needs a higher one. |
| `- [ ] ` | At the start of a line | An open checklist item |
| `- [x] ` or `- [X] ` | At the start of a line | A done checklist item |
| `**text**` | Inside one line | Bold |
| `*text*` | Inside one line | Italic |

1. A line mark counts only at the very start of the line. A checklist
   mark is read before a bullet.
2. An inline mark counts when the opening mark is followed by a
   character that is not a space, the closing one follows such a
   character, and both are on one line. The nearest closing mark counts.
   `**` is read before `*`. Marks inside a heading count.
3. As you type, the marks show in the secondary text colour, a heading
   line in the heading style, bold and italic as such, and the text of a
   done item in the secondary colour, struck through. Showing never
   changes the text.
4. The formatting bar: one row of 48dp icon buttons that scrolls sideways
   when it does not fit. They act on each line that the cursor or the
   selection touches:
   - **Heading**, **Bulleted list**: add the mark, or remove it when every
     such line has it. A line mark replaces another one.
   - **Numbered list**: numbers the lines 1, 2, 3, or removes the marks.
   - **Checklist**: a line that is not an item becomes an open item; an
     open item is ticked; a done item is opened again.
   - **Bold**, **Italic**: put the marks around the selection, or take
     them away when they are exactly around it. With no selection, both
     marks go in at the cursor, and the cursor between them.
5. Enter at the end of a bullet, a numbered item or a checklist item
   starts the next line with the same mark: the next number, an open
   box. Enter on an item with no text after its mark removes the mark.
6. A tap on the box of a checklist item, `[ ]` or `[x]`, ticks it or
   opens it again. The cursor does not move.

## Data

### Table `note`

| Column | SQL type | What it holds | Limits |
|---|---|---|---|
| `title` | `TEXT NOT NULL` | The title | 0 to 200 characters, one line, no space at either end, no control character |
| `body` | `TEXT NOT NULL` | The text, with its marks | 0 to 100,000 characters. No control character but `\n` and tab. |
| `pinned` | `INTEGER NOT NULL` | 1 if pinned, 0 if not | 0 or 1 |

Index on `updatedAt`, for the order of the list.

### Table `attachment`

| Column | SQL type | What it holds | Limits |
|---|---|---|---|
| `noteId` | `TEXT NOT NULL` | The `id` of its note | 36 characters, lower case, a version 4 UUID |
| `name` | `TEXT NOT NULL` | The file's name, as the picker gave it | 1 to 255 characters, one line, no space at either end, no control character |
| `mimeType` | `TEXT NOT NULL` | Its type, as the picker gave it, such as `image/jpeg` | 3 to 127 characters, type `/` subtype, of lower-case ASCII letters, digits and `!#$&^_.+-` |
| `size` | `INTEGER NOT NULL` | Its length in bytes, before encryption | 0 to 25,000,000 |
| `wrappedKey` | `BLOB NOT NULL` | Its file key, wrapped (blob kind 4 of [crypto-design.md](../../security/crypto-design.md#kind-4-wrapped-file-key)) | 50 to 1,024 bytes, starting with `53 48 4B 01 04` |

1. Index on `noteId`.
2. A file is added or removed, never edited. So its key and its stream
   never change.
3. Deleting a note marks its shown files deleted in the same
   transaction. **Undo** brings both back.

### The wiped form

A deleted record keeps its content only until it is
[wiped](#removing-a-file-and-the-wipe). Then its content is:

| Table | Wiped content |
|---|---|
| `note` | `title` `""`, `body` `""`, `pinned` 0 |
| `attachment` | `noteId` kept, `name` `""`, `mimeType` `""`, `size` 0, `wrappedKey` empty |

1. The wiped form of a note is within the limits of `note`: an empty
   note that is not deleted is a good record. The wiped form of a file
   is not within the limits of `attachment`, so a file that is not
   deleted is never in it.
2. A deleted record keeps content within the limits above, or is exactly
   in the wiped form. A deleted file that is partly wiped is refused.
3. The wipe keeps the four record fields, `updatedAt` too, and gives a
   new change number.

### On this phone only

| What | Where |
|---|---|
| The stream of each file, named by the file's `id`, and `<id>.part` while one is written | The folder `attachments/` in Notes' no-backup files folder |

Notes has no preferences file of its own. The files of `core/security`
and `core/crypto` are as in Water.

## Limits and defaults

| What | Limit or default |
|---|---|
| Notes | At most 5,000 shown notes made in Notes |
| Title | 0 to 200 characters |
| Text | 0 to 100,000 characters |
| Files per note | At most 20 |
| One file | At most 25 MB: 25,000,000 bytes |
| All files | At most 1 GB: 1,000,000,000 bytes, of files that are not deleted |
| File name | 1 to 255 characters. A longer one keeps its first 255. |
| Pinned | Off for a new note |
| Saving | One second after the last change |

A count is not a limit of a value: a restore can bring more notes, more
files in a note, or more than 1 GB. The counts stop only **New note** and
**Add a file**. **Undo** always brings back what its action deleted,
also when a count then passes its limit.

Units: sizes are stored in bytes and shown as Android shows sizes, in
steps of 1,000: "2.4 MB". Times are the record times, shown in the
phone's time zone and format.

## Files

### Adding a file

1. **Add a file** opens Android's "open document" screen for any type,
   several files allowed. Notes keeps no lasting permission.
2. Adds run one at a time in all of Notes, in the order the files were
   picked, also across notes. Each add checks the counts when it starts:
   "A note holds at most 20 files. 3 files were not added." or "Notes
   keeps 1 GB of files. Remove some to add more." So two adds never pass
   a count together.
3. It reads the name and the type from the picker. In this order: line
   breaks and control characters become spaces, the name keeps its first
   255 characters, spaces at both ends go, and a name that is then empty
   becomes "File". A type outside the limits becomes
   `application/octet-stream`.
4. It reserves the file's `id`, makes and wraps a new file key for that
   `id`, and encrypts the picked bytes into `<id>.part`, counting them.
   The count is the truth, not the size the picker reports. At 25,000,001
   bytes it stops and deletes the part: "ticket.jpg is larger than 25
   MB." When the count takes all files past 1 GB, it stops the same way,
   with the words of point 2.
5. It closes the stream, flushes the file, renames it to `<id>` and
   flushes the folder. Then one transaction writes the record, and the
   note too if it was a new one with nothing in it yet. That transaction
   first checks that the note is still shown. If it was deleted while
   the file was copied, nothing is written, the stream is deleted at
   once, and Notes says "The note was deleted. The file was not added."
   So no file of a deleted or wiped note is ever written. The key is made
   before the copy starts, so a lock or a screen that turns off does not
   stop it ([crypto-design.md](../../security/crypto-design.md#keys-in-memory)).
   Adding goes on when the note closes.
6. With the app lock on, the picker locks Notes. The picked files wait in
   the view model until the gate is open again
   ([security-screens.md](../../architecture/security-screens.md#pickers-and-the-share-sheet)).
   If Android stopped Notes meanwhile, the read can fail: "Could not read
   ticket.jpg. Pick it again."

### Showing an image, and saving a copy

1. A file is an image when its type starts with `image/` and Android's
   `ImageDecoder` reads it. It is decoded from the stream in memory, at
   the size it shows at, when its row or the image view shows. Decoded
   images are dropped when their note closes and when Notes locks.
   Nothing Notes decodes is written anywhere.
2. **Save a copy** opens Android's "create document" screen with the
   file's name and type. Notes writes the file there, decrypted, byte
   for byte as it was picked, in the mode that cuts off old content,
   under the dialog "Saving a copy" with a progress bar. Then the
   snackbar "Copy saved".
3. A copy is the one way a file leaves Notes. It holds all the picked
   file held, such as where a photo was taken. Notes never reads or
   changes that.

### Files that cannot be opened

| State | The row says | It offers |
|---|---|---|
| The stream is not on this phone | "Not on this phone" | **Remove** |
| The keys cannot be used now: the app lock was reset, or a keyset file is damaged | "Notes cannot open its files now. Open Recovery key in Settings." | **Remove** |
| The key was given up ([crypto-design.md](../../security/crypto-design.md#a-damaged-keyset-file)), or needs another recovery key | "This file can no longer be opened" | **Remove** |
| The wrapped key or the stream is damaged, cut, or of the wrong length | "This file is damaged" | **Remove** |

1. Notes finds the state when it shows the row, from the stream on the
   phone and from what `FileCrypto` answers. A stream is checked segment
   by segment as it is read, and is whole only when it has ended without
   an error. A copy that meets damage stops, and Notes tries to delete
   the document: "This file is damaged. No copy was saved." If the
   document cannot be deleted: "This file is damaged. Part of it may be
   in the place you chose. Delete it there."
2. Such a file counts in the limits until it is removed.

### Removing a file, and the wipe

1. **Remove** marks the file deleted, in one transaction, with the
   snackbar "File removed" and **Undo**.
2. The **Undo** of a removed file or a deleted note ends when its
   snackbar goes: its time runs out, another snackbar takes its place,
   Notes leaves the screen, the destination changes, or Notes stops.
   Then Notes wipes the records of that action that are still deleted,
   in one transaction, and after it removes their streams.
3. At every start, before a backup lists its records, and after a
   restore, Notes, in this order: marks deleted each file that is not
   deleted and whose note is; wipes every deleted record that is not
   wiped yet; and removes every stream that no unwiped file names. So a
   stop between any two of these steps is mended at the next start. At
   start it
   also deletes every `.part` file. No stream is removed while a backup
   is written.
4. Notes opens `notes.db` with SQLite's `secure_delete` on. After a wipe,
   and at every start whether or not anything was wiped, it checkpoints
   the write-ahead file and cuts it to zero. So the cleared bytes are
   written over in both files, also after a stop between the wipe and
   the checkpoint. A checkpoint that cannot finish, because a read is
   open, is done at the next wipe or start.
5. A backup made before the wipe still holds the text and the files. The
   flash storage may keep old blocks, under Android's file-based
   encryption. A wiped file's key is gone with its wrapped key, so such
   blocks of its stream can never be opened.

### Before the recovery key: the file key move

1. Files work from the first start. Until Notes has a recovery key, its
   `file-key` is a random key that exists only on this phone
   ([crypto-design.md](../../security/crypto-design.md#the-file-key-keyset-without-a-recovery-key)).
2. When Notes has its keys from a recovery key and a move is pending
   (`fileKeyMoveIsPending()`), it moves the keys: at every start, when it
   comes back from a screen of `core/security`, when an **Undo** ends,
   pressed or not, and before it goes on after the first-need dialog.
3. For each file whose wrapped key is not sealed by the current key,
   deleted ones that are not wiped too, it seals the key again
   (`FileCrypto.sealAgain`) through the `RecordWriter` function for
   that, one record per transaction, with `updatedAt` as it was. It
   leaves alone the records of an **Undo** that is still open: a new
   change number would stop that **Undo**, and the file would be wiped.
4. Only when every such key is sealed again, and no file is being added,
   does Notes call `finishFileKeyMove()`. A file being added holds a key
   wrapped before its record exists, so the move waits for every add to
   end, and no add starts while the move finishes. A stop in the middle
   goes on at the next start. Until then `core/crypto` refuses a backup
   and the app lock ("file keys still moving").
5. A key that cannot be sealed again keeps the move pending. Notes never
   ends it by itself:
   - A damaged `file-key-old` counts as absent, so none of the keys it
     sealed open. The security screen offers **Give up the files**, with
     its warning
     ([crypto-design.md](../../security/crypto-design.md#a-damaged-keyset-file)).
     After that, those files show "This file can no longer be opened".
   - A damaged wrapped key, while both keysets open: its file shows
     "This file is damaged". Once the user removes it and it is wiped,
     its key is gone and the move goes on.
   - The words for a refused backup: "Notes cannot move some files to
     your recovery key yet. Remove the files marked damaged, or open
     Recovery key in Settings."
6. Water's call that finishes a move at once is not in Notes. The code
   says why next to `finishFileKeyMove()`.

## When things go wrong

### Every stored value has limits

Every column above has its limits in its table, and the wiped form joins
them. Notes never writes a value outside them. A restore refuses a record
with a value outside them and rolls back
([Reading data version 1](#reading-data-version-1)).

### Stopped between two writes

Notes writes to the database and to the folder `attachments/`. The
database is the truth. A stream is written before its record and removed
after its record is wiped, so a stop leaves at most a stream that no
record needs, and the next start removes it.

| Action | Writes, in order | If Notes stops in between |
|---|---|---|
| Typing | One transaction per save | What was typed since the last save is lost: about a second at most, because Notes saves when it leaves the screen. |
| Add a file | The part; the rename; the record | Before the record, the next start removes the part or the stream. The file is not added. |
| Delete a note, remove a file | One transaction | Done. The next start wipes them: **Undo** is gone with the snackbar. |
| The wipe | One transaction; then the streams; then the checkpoint | The next start removes the streams and checkpoints the write-ahead file. |
| **Undo**, **Pin** | One transaction | Nothing half done. |
| The file key move | One transaction per file | The next start goes on. |
| Save a copy | The document only | A copy cut short stays where you chose. Notes cannot tell; save it again. |
| A restore | One transaction; the streams move in; the wipe | A file whose stream has not moved yet shows "Not on this phone". Restoring the same backup again brings it ([backup-format.md](../../architecture/backup-format.md#the-restore-rule), point 5). |

### A write fails

| What fails | What follows |
|---|---|
| Saving a note | Nothing changes in the database. The text stays on the screen, with a line above the title: "Could not save the note. Notes tries again." It tries again at the next change. Closing the note then asks "This note is not saved", with **Try again** and **Discard changes**. |
| Adding a file | The part, or the stream if it was already renamed, is deleted at once, and the file is not added: "Could not add ticket.jpg. The phone may be full." |
| Delete, remove, **Undo**, **Pin** | Nothing changes. A snackbar: "Could not change your notes. Try again." |
| The wipe, removing a stream, or the checkpoint | Tried again at the next start. Nothing shows. |
| Reading a stream | The row's [state](#files-that-cannot-be-opened). |
| Writing a copy | Notes tries to delete the document: "Could not save the copy." If it cannot: "Could not save the copy. Part of it may be in the place you chose. Delete it there." |
| Reading the database for a screen | `ShkErrorState`: "Could not open your notes." |
| A backup or a restore | As in [Water](../water/spec.md#backup-and-restore-screens). A restore rolls back. |

### A press twice or late

| Press | What follows |
|---|---|
| **New note** twice | One note opens. |
| **Add a file**, **Save a copy** twice | One picker. One copy at a time. |
| **Delete note**, **Remove** twice | One delete. The note or the image view closes at the first. |
| **Pin** twice | A press carries the state it showed: **Pin** on a pinned note does nothing. |
| **Undo** twice | Once. |
| **Undo** after the records changed again | As in [Tasks](../tasks/spec.md#a-press-twice-or-late): only on the records of its own snackbar whose change number is still the one its action gave them. A note or a file made meanwhile does not stop it, also when a count then passes its [limit](#limits-and-defaults). |
| Back while a save runs | The note closes after the save. |
| A picked file that arrives after its note was deleted | It is not added: "The note was deleted. The file was not added." |

### The clock or the time zone changes

| Change | What follows |
|---|---|
| Another time zone | The last change shows in the new zone. |
| Midnight, or a change of time, date or zone, while a screen is open | "14:05" becomes "Mon 16 Nov" as the day changes. |
| The clock is set back | A write moves a record's `updatedAt` past its own last value only, not past other records ([data.md](../../architecture/data.md#writing-records), point 8). So a note edited then can sort below notes changed earlier under the right clock. A last change can show a time later than now. |
| An edit made under a clock far behind | A restore keeps the newest edit by `updatedAt`, so it can lose to an older one, as in every app. |

Notes has no times of its own: no due day, no reminder, no timer but the
second before a save.

## The recovery key

As in [Tasks](../tasks/spec.md#the-recovery-key): only a backup, a
restore or the app lock needs it. Files do not: they use the random key
until then, and [the file key move](#before-the-recovery-key-the-file-key-move)
follows the setup, also after a handover or a start over.

## Backup contents

Notes follows [backup-format.md](../../architecture/backup-format.md).
**It writes and reads data version 1**, and raises it as
[the format says](../../architecture/backup-format.md#the-data-version).
Two types, named after their tables. The record fields travel in the
container. Numbers are big-endian. Each stream is a File entry under its
file's `id`, the stored stream byte for byte; its key is only in the
record, wrapped.

`note`, 7 + n + m bytes:

| Offset | Size | Content |
|---|---|---|
| 0 | 1 | `pinned`, `00` or `01` |
| 1 | 2 | n, the title's length in bytes, unsigned, 0 to 800 |
| 3 | n | The title, in UTF-8 |
| 3 + n | 4 | m, the text's length in bytes, 0 to 400,000 |
| 7 + n | m | The text, in UTF-8 |

`attachment`, 29 + t + n + k bytes:

| Offset | Size | Content |
|---|---|---|
| 0 | 16 | `noteId`, the 16 bytes of the ID, as the [container writes an ID](../../architecture/backup-format.md#record) |
| 16 | 8 | `size`, int64 |
| 24 | 1 | t, the type's length, 0 to 127 |
| 25 | t | `mimeType`, in ASCII |
| 25 + t | 2 | n, the name's length in bytes, 0 to 1,020 |
| 27 + t | n | `name`, in UTF-8 |
| 27 + t + n | 2 | k, the wrapped key's length, 0 to 1,024 |
| 29 + t + n | k | `wrappedKey`, exactly as in the row |

A pinned note "Trip" with the text "- [ ] Passport", a line break and
"- [x] \*\*Tickets\*\*", and its file `ticket.jpg` of 2,400,000 bytes
(the wrapped key, 173 bytes, cut short here):

```text
01 0004 54726970 00000020 2d205b205d2050617373706f72740a2d205b785d202a2a5469636b6574732a2a
7c9e6679742540de944be07fc1f90ae7 0000000000249f00 0a 696d6167652f6a706567 000a 7469636b65742e6a7067 00ad 53484b010401…
```

The same two records, wiped: `00 0000 00000000`, and
`7c9e6679742540de944be07fc1f90ae7 0000000000000000 00 0000 0000`.

### Writing

1. `BackupContent.dataVersion` is 1. First comes the wipe of every
   deleted record that is not wiped. No **Undo** is open while Settings
   shows.
2. One read of the database gives every record of both tables, deleted
   ones too, and the list of files. A change made while the backup runs
   is not in it. After the records come the streams of the files in that
   read that are not deleted and are on the phone. A file never changes,
   and no stream is removed while the backup is written. This is the one
   snapshot that
   [backup-format.md](../../architecture/backup-format.md#open-questions)
   asks for (question 4).
3. A file that is not deleted is left out and counted when it has no
   stream on the phone, or when its stream is not 45 + `size` + 16 for
   each segment long. Its record still goes in. So one damaged file
   never makes the whole backup one that the restore refuses. The result
   says: "2 files are not on this phone or are damaged, and are not in
   this backup."
4. The dialogs show a progress bar and the percent: "Writing the backup
   · 40%", then "Checking the backup · 40%". Without a known total, the
   circle. The screen stays on while a backup, its check or a restore
   runs.
5. The work goes on when Notes leaves the screen. If Android stops Notes,
   no backup was made: the unfinished file has no End and is never taken
   for a backup. This is Notes' answer to question 3 of the format: no
   service, and no permission for one.

### Reading data version 1

Notes' `restore` takes the records in one transaction, through
`RecordWriter.takeFromBackup`. It rolls back at: another type name; a
length other than the one its fields give; a title, text or name that is
not UTF-8 or breaks its limits; any value outside the limits of
[the tables](#data), with [the wiped form](#the-wiped-form): a file in
the wiped form that is not deleted, or a deleted file that is partly
wiped; a
record time outside its limits
([data.md](../../architecture/data.md#records-from-a-backup)); an ID that
is there twice in one type; an `attachment` whose `noteId` is not the ID
of a `note` in the backup, deleted or not, since a note is never purged;
or a File entry whose ID is not an
`attachment` of the backup, belongs to a wiped one, comes a second time,
or whose length is not that of a stream of its `size`: 45 + `size` + 16
for each segment.

### After a restore

1. Each staged stream moves in, by a rename, when its file is not deleted
   after the transaction, has no stream on the phone, and its record was
   taken or the same
   ([backup-format.md](../../architecture/backup-format.md#the-restore-rule),
   point 5). A stream on the phone that is not 45 + `size` + 16 for each
   segment long counts as no stream: the staged one replaces it.
2. Then Notes marks deleted each file that is not deleted and whose note
   is, and wipes, as at every start
   ([Removing a file, and the wipe](#removing-a-file-and-the-wipe),
   point 3). A stop before that is mended at the next start.
3. The open screens show the restored notes at once.

### Size

A note with a title of 20 bytes and a text of 1,000 takes 39 + 4 + 7 +
1,020 = 1,070 bytes in the body. A file's record takes about 270 bytes,
and its File entry 25 bytes and the stream: the file, 45 bytes, and 16
for each MiB. 1 GB of files makes a backup of about 1 GB.

## Reminders

None. Notes uses no alarm and shows no notification.

## Permissions

| Permission | From | Why |
|---|---|---|
| `android.permission.USE_BIOMETRIC` | `core/security` | The system prompt ([ADR 0031](../../adr/0031-use-biometric-for-the-system-prompt.md)) |
| `android.permission.HIDE_OVERLAY_WINDOWS` | `core/security` | The security screens ([ADR 0033](../../adr/0033-hide-overlay-windows-for-the-security-screens.md)) |

1. No other permission: no notifications, no alarms, no network (hard
   rule 4), no storage, no camera. Files come and go through the system
   pickers only.
2. The manifest rules of Water: `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`
   and the receiver of `androidx.profileinstaller` removed, Android's own
   backup and device transfer off.
3. Exported: `NotesActivity`, and the handover screen and status provider
   of `core/security`, authority `app.shkriuss.notes.keeper`
   ([ADR 0041](../../adr/0041-the-handover-between-apps.md)). No content
   provider of Notes' own, and no intent filter but the launcher's. One
   receiver: the screen-off receiver of the app lock, registered at
   runtime.

## TalkBack

As in Water and Tasks, and:

1. A note row is one item: "Trip, pinned, changed Monday 16 November, 2
   files, Passport, Tickets". Pinned, Other notes and Files are headings.
2. The bar's buttons have their names, "Heading", "Bold", "Italic",
   "Bulleted list", "Numbered list", "Checklist", and say whether they
   are on for the line where the cursor is.
3. TalkBack reads the text as it is stored, marks too. While the cursor
   is on a checklist item, the text field has the action "Tick" or "Open
   again".
4. A file row is one item: "ticket.jpg, image, 2.4 megabytes", or with
   its state. Its actions: "Open" for an image, "Save a copy", "Remove".
   The small image has no label of its own.
5. The image view reads the file's name, with the actions "Zoom in" and
   "Zoom out".
6. The progress dialogs read their percent. Errors under a field, the
   line of a failed save, the snackbars and "No notes match" are
   announced.

## Changes to shared modules

| Module | Change |
|---|---|
| `core/data` | Three `RecordWriter` functions, with tests and [data.md](../../architecture/data.md): `wipe`, for a deleted record only, which keeps the record fields ([ADR 0042](../../adr/0042-wiping-the-content-of-deleted-records.md)); sealing a file key again, which changes only the wrapped key and keeps `updatedAt`, also for a deleted record ([crypto-design.md](../../security/crypto-design.md#the-file-key-keyset-without-a-recovery-key), point 6); and an ID reserved from the writer's own `IdSource` before a create, for a record whose stream must be written first. A create takes only an ID that this writer reserved and that is not stored. |
| `core/backup` | Progress: bytes done and the total, when known, while it writes, checks and restores. The file format does not change. |
| `core/design` | `ShkTextEditor`: a text area with no frame for long text, with a hint, styles for ranges of its text given by the app, taps on a range, an accessibility action from the app, and `keyboardLearns`. `ShkProgressDialog` gets an optional fraction, shown as a `ShkProgressBar` and a percent. `ShkListItem` gets an optional small image at its start, not tinted. Each with a sample in Catalog, tests and screenshots; their defaults change nothing that exists. |
| `core/security` | The app lock screen leaves out "Show the text in notifications" in an app that shows no notifications. |
| The APK rules check | Notes' allow list of the two permissions. |

## Out of scope for version 1

- Folders, tags, colours, a choice of order, an order by hand, a grid.
- Links, tables, code, quotes, nested lists, more heading levels, images
  inside the text, hiding the marks.
- An undo of typing beyond the keyboard's own, versions of a note.
- **Open with** another app, sharing a note or a file, taking shares from
  other apps, export of notes as text files, printing.
- Taking a photo in Notes, sound, drawing, renaming a file.
- A trash, a lock for one note, reminders, stored thumbnails.
- Widgets, tiles, shortcuts, Wear OS, sync, Georgian, and "restore as it
  was".

## Decided by the owner

The app: plain text with simple formatting, attachments as encrypted
files through the system picker, search. The owner asked this page to
give every value its limits, and to say what happens when Notes stops
between two writes, when a write fails, when a press comes twice or
late, and when the clock or the time zone changes
([When things go wrong](#when-things-go-wrong)). And four answers:

1. **Formatting** is marks in the plain text, shown styled as you type,
   with the marks visible: headings, bold, italic, bullets, numbers and
   checklists ([Formatting](#formatting)).
2. **Files leave Notes** only as **Save a copy**, through the system
   picker. Images show inside Notes, decoded in memory only. No "Open
   with" ([Showing an image, and saving a copy](#showing-an-image-and-saving-a-copy)).
3. **Limits**: 25 MB a file, 20 files a note, 1 GB in all. A backup shows
   a progress bar and keeps the screen on, with no service and no new
   permission ([Writing](#writing)).
4. **A deleted note** has **Undo**. When it ends, its title, its text and
   its files are wiped, with a new `RecordWriter` write for every app
   and [ADR 0042](../../adr/0042-wiping-the-content-of-deleted-records.md)
   ([Removing a file, and the wipe](#removing-a-file-and-the-wipe)).

## Assumptions

Choices this page made without a decision by the owner on that point.

1. One list of notes, pinned ones first, by last change. No folders. Two
   destinations, and the image view in the note's pane.
2. A title and a text, as two fields. With no title, the list shows the
   first line of the text.
3. Saving is automatic, one second after the last change. An empty note
   is deleted when it closes.
4. Limits: 5,000 notes, a title of 200 characters, a text of 100,000, a
   file name of 255.
5. Both fields ask the keyboard not to learn, as Reminders and Tasks do.
   This also turns off learned suggestions while typing a long text.
6. Search is a plain match of lower-cased text, with no index and
   nothing stored.
7. A done checklist item is struck through, and a tap on its box ticks
   it.
8. Files are in a section under the text, not inside it. Images are
   decoded each time they show; no thumbnail is stored.
9. A file's name and type come from the picker, cut to their limits.
10. Files whose key was given up, that are damaged, or that are not on
    this phone stay as rows with their state and **Remove**
    ([crypto-design.md](../../security/crypto-design.md#open-questions),
    question 13).
11. **Undo** ends when its snackbar goes, and the wipe follows at once.
    A removed file counts no more towards 1 GB, also while its **Undo**
    is open.
12. The wiped form keeps a file's `noteId`, a random ID and no content.
    After a restore, a file that is not deleted, of a note that is, is
    marked deleted and wiped.
13. A fixed binary content. The type names are the table names.
14. The words of every screen, dialog and snackbar.

## Open

1. **Sync.** A note is one record, so the last writer wins for the whole
   text: an edit made on another phone at the same time is lost. A wiped
   and an unwiped deletion marker with the same `updatedAt` must end
   wiped on every device. A file that sync has listed and not fetched
   shows "Not on this phone". A text can make a sealed record of about
   400 KB, which the server's limits must take
   ([crypto-design.md](../../security/crypto-design.md#open-questions),
   question 8). The sync design decides.
2. **Backups made before a wipe** still hold the deleted text and files.
   The user guide says so.
3. **A backup that Android stops** because Notes was left in the
   background too long shows no result. Drive and Photos decide again
   for large files.
4. **How TalkBack reads the marks** in the text, such as "- [ ]". No
   check on a phone has noted it yet.
5. **The keyboard that does not learn** ([assumption 5](#assumptions)),
   if it makes long texts too hard to type.
6. **Search at the limits.** With no index, a search reads every title,
   text and file name. 5,000 notes of 100,000 characters each would make
   it slow. The build measures it; an index or a lower limit would be a
   change to this page.
7. **A damaged stream of the right length** stays damaged after a restore
   that holds a good copy: only a wrong length is seen without reading
   the whole stream.
