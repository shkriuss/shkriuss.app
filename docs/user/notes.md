# Notes

Notes keeps what you write, with simple formatting and files you attach,
and finds it again with search. Everything stays on your phone, with no
account and no network, and every file is encrypted.

## Install it

1. Install it with Obtainium, as [Install with Obtainium](install.md)
   says. In **Filter release titles by regular expression**, type
   `^notes-v`.
2. Check it with AppVerifier, as [Verify with AppVerifier](verify.md)
   says. Its package name is `app.shkriuss.notes`.

Notes needs Android 15 or newer.

## The first start

1. Open Notes. It opens on **Notes**, which says "No notes yet". There
   is no setup and no welcome screen.
2. Tap **New note** to write your first one.

Notes asks for your recovery key only when something needs it: a
backup, a restore or the app lock ([Your recovery key](recovery-key.md)).
Files work without it.

Notes has two places, in a bar along the bottom of the screen: **Notes**
and **Settings**. On a tablet, or a phone on its side, the bar is a rail
along the side. **Back** from Settings goes to Notes.

## Notes

**Notes** lists your notes, the one changed last first.

- With a pinned note, the list has two sections, **Pinned** and **Other
  notes**. Pinned notes come first.
- Each row shows the title, two lines of the text without its marks,
  and when it was last changed, with the number of files: "09:30 · 2
  files" today, "Mon, Nov 16" on another day. A note with no title shows
  its first line as the title. A note with nothing in it shows "Empty
  note".
- Tap a row to open the note. On a phone it opens in place of the list,
  and **Back** goes back. On a tablet it opens beside the list, and its
  row is marked. With none open, that side says "Choose a note."
- Notes keeps 5,000 notes. At 5,000, **New note** says "Notes keeps
  5,000 notes. Delete some to add more."

## Search

1. Type in **Search notes** at the top. The list shows the notes whose
   title, text or file names hold what you typed, as you type.
2. Each row shows the line that matches, with the match in bold, or
   "File: ticket.jpg" for a match in a file's name.
3. Case does not count: "rent" finds "Rent". Nothing else is folded:
   "e" does not find "é".
4. **Back** clears the search. Nothing of a search is stored.

## A note

A note has a **Title** and a **Note**, its text. There is no Save
button: Notes saves by itself a second after you stop typing, at least
every 10 seconds while you type, and when the note closes.

- A new note opens with the keyboard in the text. It is stored only
  once it has a title, a text or a file. A note you leave empty is
  deleted when it closes.
- A title has at most 200 characters, and a text 100,000. Past that,
  the field keeps what it had and says so under it.
- The menu in the top bar has **Pin** or **Unpin**, and **Delete note**.
  **Delete note** closes the note and says "Note deleted", with
  **Undo**. Its files go with it.
- If a save fails, a line above the title says "Could not save the
  note. Notes tries again." If the note then closes, Notes asks "This
  note is not saved", with **Try again** and **Discard changes**.
  **Back** keeps the note open.

## Formatting

Formatting is made of plain marks in the text, which show as you type.
The marks stay visible, in a lighter colour.

| Type | What you get |
|---|---|
| `# ` at the start of a line | A heading |
| `- ` at the start of a line | A bullet |
| `1. ` at the start of a line | A numbered item |
| `- [ ] ` at the start of a line | A checklist item to do |
| `- [x] ` at the start of a line | A done checklist item, struck through |
| `**bold**` | Bold |
| `*italic*` | Italic |

While you type in the text, a bar above the keyboard has **Heading**,
**Bold**, **Italic**, **Bulleted list**, **Numbered list** and
**Checklist**. Each acts on every line of the selection, or on the line
of the cursor, and a second tap takes the marks away.

- **Enter** at the end of a list item starts the next one: the next
  number, or an empty box. **Enter** on an empty item ends the list.
- Tap the box of a checklist item, `[ ]` or `[x]`, to tick it or open it
  again.

## Files

Tap **Add a file** in the top bar of a note. Android's file picker
opens. Pick one file or several.

- Any kind of file can be added. Notes encrypts each one, with a key of
  its own, and keeps the copy in its own storage. The original stays
  where it was.
- A file has at most 25 MB, a note at most 20 files, and Notes at most
  1 GB of files. Notes tries at most 42 files of one pick. It says which
  files were not added, and why.
- While a file is added, its row says "Adding ticket.jpg", with a bar.
- Each file shows under the text, under **Files**: a small picture for
  an image, its name and its size. Its **More** button has **Save a
  copy** and **Remove**. **Remove** says "File removed", with **Undo**.
- Tap an image to open it. Pinch to zoom, up to 5 times, drag to move
  it, and double tap to zoom in or out.
- **Save a copy** opens Android's file picker. Pick a place: Notes
  writes the file there, decrypted, byte for byte as you added it. A
  copy is the only way a file leaves Notes. It holds everything the
  original held, such as where a photo was taken.

A file that cannot be opened says why in its row:

| The row says | What it means | What you can do |
|---|---|---|
| Not on this phone | The file is not here, for example after a restore that could not bring it | Restore the backup again, or **Remove** it |
| Notes cannot open its files now. Open Recovery key in Settings. | The app lock was reset, or a key file is damaged | Open **Recovery key** in Settings |
| This file can no longer be opened | Its key was given up, or it needs another recovery key | **Remove** it |
| This file is damaged | Its stored copy is cut or changed | **Remove** it, and add it again from the original |

## Undo, and deleting for good

When the **Undo** of a deleted note or a removed file ends, because its
message went, another message came, you switched place or Notes left
the screen, Notes deletes it for good: it clears the title, the text,
the file names and keys, and removes the files. What is left is a
marker that something was deleted, with no content.

## Settings

**Files**: how many files Notes keeps and how much of 1 GB they take,
such as "12 files, 120 MB of 1 GB".

**Backup**: **Make a backup** and **Restore a backup**
([Back up and restore](#back-up-and-restore)).

**Security**: **Recovery key** and **App lock**
([The recovery key and the app lock](#the-recovery-key-and-the-app-lock)).

**About**: the version, and **Licences**, which lists everything made by
others that is inside Notes, with its licence.

## Back up and restore

A backup is one file that holds your notes and their files. You choose
where it goes. How backups work for every app is in
[Back up and restore](backup.md).

Make a backup:

1. In **Settings**, tap **Make a backup**.
2. The first time, Notes asks you to set up your recovery key. If Water,
   or another app of the suite, keeps your recovery key on this phone,
   tap **Get the keys from Water**. You type no words
   ([Get the keys from another app](recovery-key.md#get-the-keys-from-another-app)).
   If it has your key but does not keep it, tap **I already have one**
   and enter the same 24 words. Otherwise tap **Create a recovery key**.
3. Android's file picker opens, with a name such as
   `notes-2026-11-24.shkbackup`. Pick a place and tap **Save**.
4. Notes writes the file, reads it again and checks it, with a bar and
   the percent. The screen stays on meanwhile. It says "Backup written",
   and how many notes and files the backup holds.

- Before a backup, Notes deletes for good what is still deleted, so a
  backup never holds a deleted note. If it cannot, no backup is made:
  "Notes could not finish deleting some notes first. Try again."
- A file that is not on this phone or is damaged is left out of the
  backup. The note keeps it, and the dialog says how many files are not
  in the backup.
- A backup holds all your files, so it is about as large as they are:
  1 GB of files makes a backup of about 1 GB. Writing and checking it
  takes a while. Keep Notes open until it is done. If Android stops
  Notes meanwhile, no backup was made: make it again.

Restore a backup:

1. In **Settings**, tap **Restore a backup**, and pick the file.
2. Notes checks the whole file first. It asks "Restore this backup?",
   with when it was made and how many notes and files it holds.
3. Tap **Restore**, or **Cancel** to change nothing.

For every note and every file, the newest edit stays. A restore cannot
undo a deletion or an edit you made after the backup. A note you
deleted comes back only if the backup holds a later edit of it, made
in Notes on another phone, and then only with the files that phone
added later.

Restore on a new phone:

1. Install Notes, open **Settings** and tap **Restore a backup**. Notes
   says "Enter your recovery key first".
2. Tap **Enter the words**, and type your 24 words. The file picker then
   opens by itself.
3. Pick the file, and tap **Restore** at the question. Your notes and
   their files are back.

In Notes' backup: every note, with its title, text and pin, every file,
with its name, type, size and key, and the encrypted copy of each file,
and the deleted ones, marked as deleted, with no content. Not in it: the
app lock and its settings, and your recovery key.

## The recovery key and the app lock

- **Recovery key** opens the security screen. Create your 24 words
  there, enter them, get the keys from another app that keeps them, or
  see them again
  ([Your recovery key](recovery-key.md)). If another app of the suite
  already has your recovery key, tap **I have a recovery key** there and
  enter the same words. Use the same words in every app
  ([One key for every app](recovery-key.md#one-key-for-every-app)).
- Files added before the recovery key are encrypted with a key that
  exists only on this phone. Once Notes has your recovery key, it moves
  their keys to it by itself. Until that is done, Notes makes no backup
  and cannot turn on the app lock. If a file is damaged, the move waits:
  remove the files marked "This file is damaged".
- **App lock** makes Notes ask for your fingerprint, or your phone's
  PIN, pattern or password, before it shows anything
  ([The app lock](app-lock.md)). It needs the recovery key. Notes shows
  no notifications, so its app lock screen has no choice about them.

## TalkBack

- Each note row is one item, such as "Trip, pinned, changed Monday 16
  November, 2 files, Passport, Tickets". **Pinned**, **Other notes**
  and **Files** are headings, and so are the section headers of
  Settings.
- The buttons of the formatting bar have their names, and say whether
  they are on for the line of the cursor. On a checklist item, the text
  has the action "Tick" or "Open again".
- TalkBack reads the text as it is stored, marks too, such as "- [ ]".
- Each file row is one item, such as "ticket.jpg, image, 2.4
  megabytes", with the actions "Open" for an image, "Save a copy" and
  "Remove". The image view has "Zoom in" and "Zoom out".
- The progress of a backup reads its percent. Errors, the line of a
  failed save, the messages and "No notes match" are read out.

## Permissions

Notes asks Android for two permissions, and no other:

| Permission | What it is for | Who decides |
|---|---|---|
| Use biometric hardware | To show Android's own prompt for the app lock and your recovery key | Android, at install |
| Hide other apps' windows | To hide other apps' windows over the recovery key screens and the lock screen | Android, at install |

Notes has no network permission, no storage permission and no camera
permission, and shows no notifications. It reaches only the files you
pick. The details are in
[permissions.md](../security/permissions.md#notes-appshkriussnotes).

## Your data

Everything Notes stores stays on your phone, in Notes' own storage. It
sends nothing over the network, has no account and tracks nothing. What
it stores, file by file, and what can leave the phone, is in the
[data inventory](../security/data-inventory.md#notes-appshkriussnotes).

A deleted note or file is deleted for good when its **Undo** ends: its
content is cleared and its file removed. A backup you made before that
still holds it. Delete such a backup where you put it.

To delete everything: in Android's Settings, open **Apps**, then
**Notes**, **Storage**, and tap **Clear storage**. That also deletes
Notes' keys. A backup then opens only with your 24 words.

## Known problems

Notes is not released yet. These are its known problems and limits.

Not known yet:

1. How TalkBack reads the marks in the text, such as "- [ ]".
2. Whether the keyboard, which is asked not to learn what you type,
   makes long texts too hard to type.
3. How fast search is with many long notes. It reads every title, text
   and file name.
4. Whether TalkBack goes back to the item that opened a dialog or a
   menu, when it closes. Notes does nothing of its own for it.

Limits of files:

5. A file that a restore could not bring shows "Not on this phone".
   Restoring the same backup again brings it.
6. A copy you save holds everything the original held, such as where a
   photo was taken. Notes never reads or changes that.
7. A copy that was cut short, for example because the phone stopped,
   stays where you saved it. Notes cannot tell. Save it again.

Limits of the app lock:

8. If you choose a time in **Lock the app** and turn the screen off
   from another app, Notes may stay unlocked until that time has passed
   ([The app lock](app-lock.md#when-the-app-locks)).
9. The app lock hides your notes. It does not encrypt their text.
   Android's own encryption protects them, with your screen lock. The
   files are encrypted by Notes as well.

Limits of backups:

10. A restore keeps the newest edit of each note and file. It cannot
    bring back exactly how Notes was on the day of the backup.
11. Some storage apps do not let Notes read a file again right away, or
    hand back an older copy. Notes then says "Backup written, not
    checked". Check such a file with **Restore a backup**, and tap
    **Cancel** at the question.
12. A backup made before you deleted a note still holds that note and
    its files.
13. If Android stops Notes while it writes a large backup in the
    background, no backup was made, and Notes shows nothing about it.
    Make it again, with Notes on the screen.
14. A file that is damaged but has the right length stays damaged after
    a restore of a good copy of it: a restore brings no stored copy for
    a file whose stored copy has the right length. Remove it, and add it
    again from the original. Removing it and restoring again does not
    bring it back, because the removal is the newer edit.

Limits of deleting:

15. What a deletion clears can stay in blocks the phone's storage
    keeps, under Android's encryption, out of reach of apps.

Other:

16. When the phone's storage is completely full, a save or an added
    file can fail. What was saved before stays. Free some room on the
    phone.
17. Never type your real recovery words into a preview build of a pull
    request. Use test words.
18. Of the dialogs of a backup and a restore, these have screenshot
    tests: "Writing the backup", "Restoring the backup", "Backup
    written", the question, "Backup restored" and "Not a backup". The
    words of the others were not checked at a large font size.

Not in version 1:

- Folders, tags, colours, an order you choose, and a grid.
- Links, tables, code, quotes, nested lists, more heading levels,
  images inside the text, and hiding the marks.
- An undo of typing beyond the keyboard's own, and versions of a note.
- **Open with** another app, sharing a note or a file, taking shares
  from other apps, exporting notes as text files, and printing.
- Taking a photo in Notes, sound, drawing, and renaming a file.
- A trash, a lock for one note, reminders, widgets, tiles, shortcuts, a
  watch app, and sync.
- Other languages than English.
