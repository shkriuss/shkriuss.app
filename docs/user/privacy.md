# Privacy

What the apps of the suite store, what leaves your phone, and what nobody
else sees. In plain words.

The same, file by file and checked against the code, is in the
[data inventory](../security/data-inventory.md). Every permission of
every app is in [Permissions](../security/permissions.md).

## In short

- **No account.** You never sign up and never sign in.
- **No tracking.** No analytics, no ads, no crash reports, no
  advertising ID, and no Google Play services. The apps do not count or
  report how you use them.
- **No network in the data apps.** Every app that holds your data has no
  permission to use the network. Android does not let such an app reach
  the internet, and the build of each app fails if it asks for that
  permission.
- **Your data stays on your phone**, in each app's own storage, which
  Android encrypts with your screen lock. It leaves the phone only when
  you make a backup, or, later, when you set up sync.

## What each app stores

### Catalog

Catalog is a gallery of the design components, for development. It
stores nothing.

### Water

Water is released ([Apps](apps.md)). On your phone, it stores:

- your drinks: the amount, the day and the time of each;
- your daily goal, and the day each goal counts from;
- your settings: the unit, the three quick amounts, and the reminders;
- the times of its reminders, for example when the last one showed;
- the settings of its app lock;
- its keys. Android's Keystore holds the main keys, in the phone's
  secure hardware where it has some, and they cannot be read out. The
  other keys are stored only locked by those.

It stores no name, no text you write, no location and no health data
from other apps. A deleted drink stays as a marked row until you clear
Water's storage.

### Reminders

Reminders is released ([Apps](apps.md)). On your phone, it stores:

- your reminders: the title, the date, the time, the repeat and the days
  of the week of each;
- for each reminder, times only: when it was last dealt with, the end of
  a snooze, and the times of its alarm and its notification;
- the settings of its app lock;
- its keys, kept as Water's are.

The titles are text you write. Reminders keeps them in its own storage,
on one line and without spaces at either end. A deleted reminder stays
as a marked row, with its title, until you clear Reminders' storage.
Backups you make after the deletion hold it too, marked as deleted.
Clearing the storage does not change backup files you already made:
delete those where you put them. Reminders stores no name, no location
and no data from other apps.

Your keyboard sees what you type into a title, as in any app. Reminders
asks it not to learn the words of a title, so that it does not keep them
or suggest them in other apps. A keyboard can ignore this.

### Tasks

On your phone, Tasks stores:

- your lists, with their names;
- your tasks: the title, the list, the due date, the repeat, the days of
  the week, the day the repeat counts from, the reminder time, and when
  each was done;
- for each task with a reminder, times and numbers only: when its
  reminder was last dealt with, the end of a snooze, and the times of
  its alarm and its notification;
- the settings of its app lock;
- its keys, kept as Water's are.

The titles and the names of lists are text you write. Tasks keeps them
in its own storage, on one line and without spaces at either end. A
deleted task stays as a marked row, with its title, and a deleted list
with its name, until you clear Tasks' storage. Backups you make after
the deletion hold them too, marked as deleted. Clearing the storage does
not change backup files you already made: delete those where you put
them. Tasks stores no name of yours, no location and no data from other
apps.

Your keyboard sees what you type into a title or the name of a list, as
in any app. Tasks asks it not to learn those words, so that it does not
keep them or suggest them in other apps. A keyboard can ignore this.

### Notes

On your phone, Notes stores:

- your notes: the title, the text with its marks, and whether it is
  pinned;
- your files: each one's name, type and size, and a copy of it,
  encrypted with a key of its own;
- the settings of its app lock;
- its keys, kept as Water's are.

The titles, the texts and the names of files are what you write or
pick. A deleted note or file is deleted for good once its **Undo** ends:
its title, text, name and key are cleared, and its file is removed.
What stays is a marked row with no content. A backup you made before
that still holds it: delete such a backup where you put it. Notes stores
no name of yours, no location and no data from other apps, and it never
reads what a file holds, such as where a photo was taken.

Your keyboard sees what you type into a title or a text, as in any app.
Notes asks it not to learn those words. A keyboard can ignore this.

### Later apps

Each app adds its part to this page before its first release.

## What leaves your phone

### Backups that you make

A backup is one file. You choose where it goes, for example a USB stick
or a cloud storage app. It is locked with your recovery key: nobody can
open it without your 24 words.

Without the words, whoever has the file can still see:

- which app it is from;
- the short name of your recovery key, which is the same in all your
  backups;
- roughly how much it holds, from its size;
- the date, from the name the app suggests, unless you change it.

[Back up and restore](backup.md) has the details.

### Copies of files that you save

In Notes, **Save a copy** writes a file you attached to the place you
pick, as it was before Notes encrypted it. The copy is not locked. It
holds everything the original held, such as where a photo was taken.

### Notifications

The reminders of Water, Reminders and Tasks show on your phone, like
every notification. A reminder of Reminders or of Tasks shows your
title.

- On the lock screen, Android shows their text only if your phone's
  setting allows it.
- A reminder's text and buttons reach another app only if you gave that
  app notification access. Such an app can pass them on to a watch.
- Water, Reminders and Tasks do not mark their reminders "local only".
  That mark would not hide them from apps with notification access. It
  only asks apps that pass notifications to a watch not to pass them
  on. Whether the apps mark them, or offer a setting, is not decided
  yet.
- With the app lock on, a reminder shows only "Drink reminders" in
  Water, "Reminders" in Reminders or "Task reminders" in Tasks, and "The
  app lock hides this notification. Open the app to see it.", without
  amounts or titles and without buttons. Unless you turn on **Show the
  text in notifications** ([The app lock](app-lock.md)).
- If you turned on Android's notification history, Android keeps the
  notifications of the last 24 hours there, with their text: in
  Reminders and Tasks, the title. It keeps them also after you deleted
  the reminder or the task.

### Nothing else

- No app sends anything over the network.
- Android's own backup and device-to-device transfer are turned off in
  every app. Your data does not go to Google or to a phone maker's cloud
  that way.
- The apps put nothing on the clipboard themselves. A text field, such
  as a reminder's title, offers the usual copy and paste: what you copy
  goes to the clipboard.
- The apps share nothing with other apps, with one exception. An app of
  the suite that keeps your recovery key can give another app of the
  suite on the same phone that app's own keys, after you tap **Allow**
  and answer the system prompt. It never gives the 24 words. It also
  tells such an app whether it keeps a recovery key, and that key's
  short name. It answers only apps of the suite signed exactly like
  itself, and gives any other app nothing
  ([Get the keys from another app](recovery-key.md#get-the-keys-from-another-app)).
- The apps write no logs of what you enter.

## Sync, later

The sync server is built. The Sync app is not, so nothing syncs yet.
This is what is decided:

1. Only the Sync app will use the network. The data apps will hand it
   their data already locked, and it cannot open it.
2. The server runs in your own Cloudflare account. Nobody else runs a
   server for you.
3. The server stores only locked data. Without your 24 words, it cannot
   read anything.
4. The server, and Cloudflare, which runs it, can still see:
   - when each of your devices connects, and from which network address;
   - when each device was added;
   - which of the apps you sync;
   - how many items you sync, how large each is, and how often each
     changes;
   - which items are files, and how large each file is;
   - most of the time, that an item was deleted;
   - which device sent what;
   - the short name of your recovery key, which ties all your synced
     data together.

   It cannot see what is in an item or a file, the name of a file, or
   the names you give your devices.
5. A new device will need your 24 words and a one-time code. The code
   comes from a device that already syncs, or from your own Cloudflare
   account. The words alone will not add a device.
6. To delete your data from the server, you will close the server
   from the Sync app, and then delete the server and its storage in
   your Cloudflare account. Nothing on your phones is deleted by
   this.

## The website and the downloads

- This website has no cookies, no JavaScript, no analytics and no fonts
  from other sites. Cloudflare serves it, and sees each visitor's
  network address and the time, as any web server does.
- The apps come from GitHub, through Obtainium. GitHub sees what any web
  server sees when you download them ([Install with Obtainium](install.md)).

## Delete your data

1. In Android's Settings, open **Apps**, then the app, then **Storage**.
2. Tap **Clear storage**. Everything the app stored goes, its keys too.
   Uninstalling the app does the same.
3. Backup files stay where you put them. Delete them there.

## Questions

Found a problem with privacy or security? Please report it privately, as
the [security policy](../../SECURITY.md) explains.
