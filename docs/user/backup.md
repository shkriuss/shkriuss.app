# Back up and restore

A backup is one file that holds everything one app has stored. You choose
where the file goes. You can restore it later, on the same phone or on
another one.

No released app can make a backup yet. The first one will be Water. This
page says what is already fixed. It was written on 2026-11-12, with the
code that reads and writes backup files.

Open: the names of the buttons and where they are in an app. They are
set when the first app gets its backup screen. This page is updated then.

## What you need

- The app, set up with your recovery key. The recovery key is the 24
  words you wrote down. A backup is locked with a key made from them.
- A place for the file. It can be the phone's storage, a USB stick, or
  any storage app that shows up in Android's file picker.
- For a restore: the same app, and the same 24 words.

The apps ask for no storage permission. They can only reach the one file
you pick.

## What a backup is

1. One file per app. Each app makes its own backup.
2. The file is locked on your phone before it leaves the app. Only your
   recovery key opens it.
3. **Nobody can open a backup without the recovery words.** Not the
   people who make the apps, and not the place where the file is stored.
   If you lose the words, the backup is lost too.
4. Inside are the app's records and its files. Records you deleted are
   inside too, marked as deleted, so that a restore does not bring them
   back by mistake.

What is not in a backup:

- Your recovery key. It is never written into any file.
- The app lock.
- Files that are not on this phone. If the app knows of files that it
  has not fetched to this phone, it cannot put them in. It tells you how
  many files are not in the backup.

Open: which settings of each app are in its backup. Each app's own guide
says so.

What the file shows to anyone who has it, without the words:

- Which app it is from.
- A short name of your recovery key. It is not secret and opens nothing.
- How large it is.

## Make a backup

1. Open the app's settings and choose to back up.
2. Android's file picker opens. Choose a folder.
3. The app suggests a name, for example `water-2026-11-12.shkbackup`.
   You may change it.
4. Tap **Save**.
5. Wait until the app says the backup is written. If some files are not
   on this phone, it says how many are not in this backup.

The app can read the file again and check it, from the first byte to the
last. A backup that cannot be restored is then found on the day you make
it. Open: whether the app does this by itself after every backup, or
when you ask.

If writing fails, for example because the storage is full, the app tries
to remove the unfinished file. If a file stays, delete it. An unfinished
file is never taken for a backup.

## Restore a backup

1. Install the app and set it up with the same recovery words.
2. Open the app's settings and choose to restore.
3. Android's file picker opens. Choose the backup file.
4. The app reads and checks the whole file first. Until the whole file
   has passed, nothing in the app changes.
5. Then the app takes the records and files.

A restore needs free room on the phone for about the size of the backup.

## What a restore does

For every record, the newest edit wins.

- A record that is in the backup and not in the app is added.
- A record that is in both: the one that was changed last stays.
- A record that is in the app and not in the backup stays as it is.
- Restoring the same backup twice changes nothing the second time.

**A restore cannot undo a deletion or an edit that you made after the
backup.** The later change is the newer edit, so it stays. If you deleted
something by mistake after your last backup, restoring that backup into
the same app does not bring it back.

Into an app with no data, for example on a new phone, a restore gives
you exactly what the backup holds.

## If the app does not take a file

| The app says | What it means | What to do |
|---|---|---|
| Not a backup | The file is something else, for example a photo. | Pick the backup file. |
| Made by a newer version of the app | The backup comes from a newer version than the one on this phone. | Update the app, then restore. |
| Backup of another app | For example a backup of Notes picked in Water. | Open the app the backup is from. |
| Needs another recovery key | The backup was made with other recovery words than this app has. The app shows the short name of the key the backup needs. | Restore it in an app that is set up with those words. |
| No keys | The app is not set up with a recovery key yet, or the phone was locked. | Set up the recovery key, unlock the phone, and try again. |
| Damaged or changed | The file is cut short or was changed. | Use another copy of the backup. |

In every one of these cases, nothing in the app has changed.

## Keep your backups safe

1. Keep more than one backup, and keep one somewhere else than on the
   phone.
2. Keep the paper with your 24 words safe, and not in the same place as
   your only backup.
3. An older backup stays a good backup. The app cannot tell you whether
   a newer one exists.
4. You may rename a backup file. The app does not look at the name.
5. Android's own backup is turned off for these apps. A backup file
   that you make yourself is the only backup.
