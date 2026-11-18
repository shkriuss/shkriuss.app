# Back up and restore

A backup is one file that holds everything one app has stored. You choose
where the file goes. You can restore it later, on the same phone or on
another one.

Water and Reminders make backups.

Where the buttons are: open the app's **Settings**. Under **Backup** are
**Make a backup** and **Restore a backup**. Later apps have the same two
buttons in their settings.

## What you need

- The app, set up with your recovery key. The recovery key is the 24
  words you wrote down. A backup is locked with a key made from them.
  If the app has no recovery key yet, it asks you to set it up when you
  make your first backup ([Recovery key](recovery-key.md)).
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

Which settings of each app are in its backup: each app's own guide says
so. For Water, see [Back up and restore](water.md#back-up-and-restore) in
its guide. For Reminders, see
[Back up and restore](reminders-app.md#back-up-and-restore) in its
guide.

What the file shows to anyone who has it, without the words:

- Which app it is from.
- A short name of your recovery key. It is not secret and opens nothing.
- How large it is.

## Make a backup

1. Open the app's settings and tap **Make a backup**.
2. If the app has no recovery key yet, it says "Set up your recovery key
   first". Tap **Create a recovery key**, or **I already have one** if
   you have the 24 words of another app of the suite. When that is done,
   the app goes on by itself.
3. Android's file picker opens. Choose a folder.
4. The app suggests a name, for example `water-2026-11-12.shkbackup`.
   You may change it.
5. Tap **Save**.
6. Wait. The app says "Writing the backup" and then "Checking the
   backup".
7. The app says **Backup written**, and how many records the backup
   holds. In Water: "The backup is written and checked. It holds 42
   drinks." If some files are not on this phone, an app with files says
   how many are not in this backup.

**The app checks every backup by itself.** Right after it has written
the file, it reads the file again and checks it, from the first byte to
the last. A backup that cannot be restored is then found on the day you
make it. You do not have to ask for the check.

| The app says | What it means | What to do |
|---|---|---|
| Backup written | The file is written and passed the check. | Nothing. |
| This backup cannot be used | The file was written, but the app could not read it back as a whole backup. | Make the backup again, in another place. Delete the file that cannot be used. |
| Backup written, not checked | The file is written. The storage app did not let the app read it again. | To check it: tap **Restore a backup**, pick the file, and tap **Cancel** when the app asks. |
| The backup could not be written | Writing failed, for example because the storage is full. | Make room, or choose another place, and try again. If an unfinished file stays, delete it. It is never taken for a backup. |
| No backup was made | The app cannot use its keys now. | Open **Recovery key** in the app's settings, then try again. |

To check an older backup file: tap **Restore a backup**, pick the file,
and read what the app says. If it asks "Restore this backup?", the file
is good. Tap **Cancel**, and nothing changes.

## Restore a backup

1. Install the app.
2. Open the app's settings and tap **Restore a backup**.
3. If the app has no recovery key yet, it says "Enter your recovery key
   first". Tap **Enter the words** and type the 24 words the backup was
   made with. A new recovery key cannot open an old backup. When that is
   done, the app goes on by itself.
4. Android's file picker opens. Choose the backup file.
5. The app reads and checks the whole file first: "Checking the
   backup". Until the whole file has passed, nothing in the app changes.
6. The app asks **Restore this backup?** It says when the backup was
   made and how many records it holds, in Water for example "Made on 13
   November 2026, 14:05. It holds 42 drinks." **Cancel** changes
   nothing.
7. Tap **Restore**. The app takes the records and files, and says
   **Backup restored**.

A restore needs free room on the phone for about the size of the backup.

After a restore, Water's reminders follow the restored settings at once.
If reminders are on in the backup and this phone does not allow Water's
notifications yet, the reminder line on **Today** says so and offers
**Allow**.

After a restore in Reminders, each reminder the restore took counts from
that moment: a time that passed before the restore does not show late.
Its snooze ends, and its notification goes. If this phone does not
allow Reminders' notifications yet, **Upcoming** says so and offers
**Allow**.

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

Three more, when something goes wrong on the phone. Nothing in the app
has changed after these either:

| The app says | What it means | What to do |
|---|---|---|
| The file could not be read | Reading the file failed, for example because the storage was taken out. | Try again. |
| Not enough room on the phone | The app could not put the backup aside before the restore. | Free room for about the size of the backup, then try again. |
| The app cannot read this backup | The file is a whole backup, but holds something this version of the app cannot read. | Update the app, then try again. |

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
