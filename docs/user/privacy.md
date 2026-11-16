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

Water is in development ([Apps](apps.md)). On your phone, it stores:

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

### Notifications

Water's reminders show on your phone, like every notification.

- On the lock screen, Android shows their text only if your phone's
  setting allows it.
- A reminder's text and buttons reach another app only if you gave that
  app notification access. Such an app can pass them on to a watch.
- Water does not mark its reminders "local only". That mark would not
  hide them from apps with notification access. It only asks apps that
  pass notifications to a watch not to pass them on. Whether Water marks
  them, or offers a setting, is decided after its first release.
- With the app lock on, a reminder shows only "Drink reminders" and "The
  app lock hides this notification. Open the app to see it.", without
  amounts and without buttons. Unless you turn on **Show the text in
  notifications** ([The app lock](app-lock.md)).

### Nothing else

- No app sends anything over the network.
- Android's own backup and device-to-device transfer are turned off in
  every app. Your data does not go to Google or to a phone maker's cloud
  that way.
- The apps share nothing with other apps and do not use the clipboard.
- The apps write no logs of what you enter.

## Sync, later

Sync is decided, but not built yet. This is what is decided:

1. Only the Sync app will use the network. The data apps will hand it
   their data already locked, and it cannot open it.
2. The server runs in your own Cloudflare account. Nobody else runs a
   server for you.
3. The server stores only locked data. Without your 24 words, it cannot
   read anything.
4. The server, and Cloudflare, which runs it, can still see:
   - when each of your devices connects, and from which network address;
   - how many items you sync, and how large each is;
   - which device sent what;
   - the short name of your recovery key, which ties all your synced
     data together.

How you delete your data from the server is still open.

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
