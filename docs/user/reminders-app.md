# Reminders

Reminders shows a notification with your title at the time you set:
once, or again every day, week, month or year. Everything stays on your
phone, with no account and no network.

What happens to reminders of every app after a restart, in Private
Space and in another profile is in
[Reminders and notifications](reminders.md). This page is the guide to
the Reminders app.

## Install it

Reminders has no release yet ([Apps](apps.md)). Once it has one:

1. Install it with Obtainium, as [Install with Obtainium](install.md)
   says. In **Filter release titles by regular expression**, type
   `^reminders-v`.
2. Check it with AppVerifier, as [Verify with AppVerifier](verify.md)
   says. Its package name is `app.shkriuss.reminders`.

Reminders needs Android 15 or newer.

## The first start

1. Open Reminders. It opens on **Upcoming**, which says "No reminders
   yet." There is no setup and no welcome screen.
2. Tap **Add a reminder** to make your first one.

Reminders asks for your recovery key only when something needs it: a
backup, a restore or the app lock ([Your recovery key](recovery-key.md)).

Reminders has three places, in a bar along the bottom of the screen:
**Upcoming**, **Past** and **Settings**. On a tablet, or a phone on its
side, the bar is a rail along the side. Each place keeps where you were
when you switch. **Back** from Past or Settings goes to Upcoming.

## Upcoming

**Upcoming** lists the reminders still to come, soonest first. Each row
shows the title, and under it when the reminder shows next and its
repeat:

- "Today, 09:00 · Every day" or "Tomorrow, 09:00 · Every day".
- "Wed 18 Nov, 18:30 · Mon, Wed, Fri". The year shows when it is not
  this year.
- "Snoozed until 09:12": you snoozed it, and the snooze ends before its
  next time.
- "Now": it is due and has not shown yet.

While a reminder is upcoming and Reminders cannot show notifications, a
line at the top says so, with a button:

| The line says | Button |
|---|---|
| "Reminders may not show notifications yet." | **Allow** |
| "Notifications are off for Reminders. Your reminders are silent." | **Open settings** |
| "Reminders are turned off in Android's settings. Your reminders are silent." | **Open settings** |

Tap a row to change the reminder. On a phone the form slides up from the
bottom. On a tablet held sideways it opens beside the list.

## Add a reminder

1. On **Upcoming**, tap **Add a reminder**. The form **New reminder**
   opens, with the keyboard on **Title**.
2. Type the title.
3. Choose the **Repeat**: **Once**, **Every day**, **Every week**,
   **Every month** or **Every year**.
4. For Once, Every month and Every year, tap **Date** to choose the day.
   For Every week, tap the days under **Days**.
5. Tap **Time** to choose the time.
6. The line under it says when the reminder comes next, such as "Next:
   Wed 18 Nov, 18:30".
7. Tap **Save**. A message says "Reminder set for Wed 18 Nov, 18:30."

After a save, while Android has not asked yet whether Reminders may show
notifications, Reminders explains in a dialog, "Allow notifications".
Tap **Continue**. Android then asks. Tap **Allow**. If you tap **Not
now**, the dialog comes again after your next save. The reminder is
saved either way.

Good to know:

- A new reminder starts as Once, today, at the next full hour.
- A title has 1 to 200 characters: "Enter a title." or "A title has at
  most 200 characters."
- A one-time reminder must be later than now: "That time has passed."
- Every week needs at least one day: "Choose at least one day."
- Reminders keeps up to 500 reminders: "Reminders keeps 500 reminders.
  Delete one to add another."
- A reminder counts from the minute you save it. A daily 09:00 saved at
  09:30 comes first tomorrow.
- Every month on the 31st comes on the last day of a shorter month.
  Every year on 29 February comes on 28 February in a year without it.

## Change or delete a reminder

1. Tap the reminder in **Upcoming** or **Past**. The form **Edit
   reminder** opens.
2. Change it, and tap **Save**. A new date, time or repeat counts from
   now: a snooze ends, and its notification goes. A new title alone
   leaves its notification as it is.
3. Or tap **Delete**. A message says "Reminder deleted". Tap **Undo** to
   bring it back.

## Past

**Past** lists the one-time reminders that have shown, newest first,
such as "Mon 16 Nov, 14:00". A one-time reminder stays here until you
delete it or give it a new time.

1. Tap one to change it. A new time later than now moves it back to
   Upcoming.
2. To empty the list, tap the bin at the top, **Delete all**. Reminders
   asks "Delete all past reminders?" and says how many it deletes. Tap
   **Delete**.
3. A message says, for example, "12 reminders deleted". Tap **Undo** to
   bring them back.

## Settings

Reminders has no settings of its own. The snooze is always 10 minutes.

**Backup**: **Make a backup** and **Restore a backup**
([Back up and restore](#back-up-and-restore)).

**Security**: **Recovery key** and **App lock**
([The recovery key and the app lock](#the-recovery-key-and-the-app-lock)).

**About**: the version, and **Licences**, which lists everything made by
others that is inside Reminders, with its licence.

## Notifications

Each reminder shows at its minute, also while the screen is off. The
notification has the reminder's title and two buttons, **Done** and
**Snooze 10 min**. Its text is the repeat, such as "Every day" or "Every
Mon, Wed, Fri". A one-time reminder has none.

- Each reminder has its own notification. Several can show at once.
- The next time of a reminder replaces its old notification.
- A notification stays until you answer it, swipe it away, or it is
  replaced.

The two buttons:

1. **Done**: the reminder shows next at its next time.
2. **Snooze 10 min**: it shows again 10 minutes later, with "Snoozed. It
   was due at 09:00."
3. A swipe, or no answer: it shows next at its next time, as after
   **Done**.
4. On the lock screen, a button first asks you to unlock the phone.
   Before the unlock it does nothing.
5. A button works once, and only on the newest notification of its
   reminder.

A tap on the notification opens Reminders, after the app lock, with the
form of that reminder, on **Upcoming** or **Past**. If you deleted the
reminder, Reminders opens on **Upcoming**.

A missed reminder shows late, once: "Missed: 09:00", or "Missed: Mon 16
Nov, 09:00" when it was another day. If several times of one reminder
were missed, only the latest shows. This happens after the phone was
off, after a restart before you unlocked it, after **Force stop**, and
while Private Space or the profile was stopped
([Reminders and notifications](reminders.md#what-reminders-does)).

Times are the phone's local time:

- After a change of time zone, 09:00 stays 09:00 on the phone's clock.
- When the clock jumps forward for summer time, a time that does not
  exist that day comes later by the jump: 02:30 comes at 03:30. When the
  clock goes back, a time that happens twice comes once.
- After you set the clock back, a reminder that showed can show again.

If notifications are not allowed, or **Reminders** is turned off in
Android's settings, Reminders still keeps time: a reminder that repeats
moves on to its next time, and none shows later. Upcoming says that your
reminders are silent, and its button opens the right page of Android's
settings.

If a reminder cannot be shown, a notice comes in its place: "A reminder
could not be shown. Open the app to see it." A tap on it opens the form
of that reminder.

Who else can see a reminder:

- On the lock screen, Android shows its title only if your phone's
  setting allows it.
- A reminder's title and buttons reach another app only if you gave that
  app notification access. Such an app can pass them on to a watch. It
  can also press the buttons, without the phone's unlock.
- With the app lock on, a reminder shows only "Reminders" and "The app
  lock hides this notification. Open the app to see it.", without its
  title and without buttons. Unless you turn on **Show the text in
  notifications** on the app lock screen.

## Back up and restore

A backup is one file that holds your reminders. You choose where it
goes. How backups work for every app is in
[Back up and restore](backup.md).

Make a backup:

1. In **Settings**, tap **Make a backup**.
2. The first time, Reminders asks you to set up your recovery key. If
   Water, or another app of the suite, already has your recovery key,
   tap **I already have one** and enter the same 24 words. Otherwise tap
   **Create a recovery key**.
3. Android's file picker opens, with a name such as
   `reminders-2026-11-16.shkbackup`. Pick a place and tap **Save**.
4. Reminders writes the file, reads it again and checks it. It says
   "Backup written" and how many reminders the backup holds.

Restore a backup:

1. In **Settings**, tap **Restore a backup**, and pick the file.
2. Reminders checks the whole file first. It asks "Restore this
   backup?", with when it was made and how many reminders it holds.
3. Tap **Restore**, or **Cancel** to change nothing.

For every reminder, the newest edit stays. A restore cannot undo a
deletion or an edit you made after the backup.

After a restore, each reminder the restore took counts from that moment.
A time that passed before the restore does not show late, and a
one-time reminder whose time passed is under Past. Its snooze ends, and
its notification goes.

Restore on a new phone:

1. Install Reminders, and tap **Restore a backup**. Reminders says
   "Enter your recovery key first".
2. Tap **Enter the words**, and type your 24 words. The file picker then
   opens by itself.
3. Pick the file, and tap **Restore** at the question. Your reminders
   are back.
4. Upcoming says "Reminders may not show notifications yet." Tap
   **Allow**, then **Continue**, then **Allow** in Android's question.

In Reminders' backup: every reminder, with its title, date, time, repeat
and days of the week, and the deleted ones, marked as deleted. Not in
it: the app lock and its settings, what this phone remembers of each
reminder, such as a snooze, and your recovery key.

## The recovery key and the app lock

- **Recovery key** opens the security screen. Create your 24 words
  there, enter them, or see them again
  ([Your recovery key](recovery-key.md)). If another app of the suite
  already has your recovery key, tap **I have a recovery key** there and
  enter the same words. Use the same words in every app
  ([One key for every app](recovery-key.md#one-key-for-every-app)).
- **App lock** makes Reminders ask for your fingerprint, or your phone's
  PIN, pattern or password, before it shows anything
  ([The app lock](app-lock.md)). It needs the recovery key. Reminders
  still shows your reminders at their time while it is locked.

## TalkBack

- Each row of Upcoming and Past is one item, such as "Pills, tomorrow at
  09:00, every day", or "Pills, snoozed until 09:12". Its action is
  "Edit".
- A day of the week in the form reads the whole day: "Monday, selected".
- The errors of the form are read out.
- The line about notifications and its button come before the list.
- The buttons of a notification have only their visible text.
- The messages after a save or a deletion are read out. The one after a
  deletion has its **Undo**.
- Section headers of Settings are headings, so you can jump between
  them.

## Permissions

Reminders asks Android for five permissions, and no other:

| Permission | What it is for | Who decides |
|---|---|---|
| Notifications | To show each reminder | You. Reminders explains after your first save, then Android asks. |
| Alarms at an exact time | To show a reminder at its minute | Android, at install |
| Run at start-up | To set the reminders again after a restart | Android, at install |
| Use biometric hardware | To show Android's own prompt for the app lock and your recovery key | Android, at install |
| Hide other apps' windows | To hide other apps' windows over the recovery key screens and the lock screen | Android, at install |

Reminders has no network permission and no storage permission. It
reaches only the one file you pick. The details are in
[permissions.md](../security/permissions.md#reminders-appshkriussreminders).

## Your data

Everything Reminders stores stays on your phone, in Reminders' own
storage. It sends nothing over the network, has no account and tracks
nothing. What it stores, file by file, and what can leave the phone, is
in the
[data inventory](../security/data-inventory.md#reminders-appshkriussreminders).

A deleted reminder stays as a marked row, with its title, until you
clear Reminders' storage. Backups you make after the deletion hold it
too, marked as deleted.

To delete everything: in Android's Settings, open **Apps**, then
**Reminders**, **Storage**, and tap **Clear storage**. That also deletes
Reminders' keys. A backup then opens only with your 24 words.

## Known problems

Reminders has no release yet. These are its known problems and limits.

Not known yet:

1. How TalkBack reads "Snooze 10 min" on the button of a notification.
2. Whether reminders are lost when many were missed at once. Android
   limits how many notifications one app shows.

Limits of reminders:

3. No reminder comes after a restart until you unlock the phone once.
   Reminders cannot run before that. Then a missed reminder shows late.
4. No reminder comes while Reminders' profile or Private Space is
   stopped, or after **Force stop**, until Reminders runs again. Then a
   missed reminder shows late, once.
5. After you set the clock back, or move to a time zone further west, a
   reminder that showed can show again.
6. A reminder's title and buttons reach apps you gave notification
   access. Such an app can pass them on to a watch, and can press the
   buttons without the phone's unlock. Reminders does not mark its
   reminders "local only". Whether it should is not decided yet.
7. With the app lock off, the lock screen shows a reminder's title if
   your phone's setting allows it.

Limits of the recovery key:

8. Reminders cannot tell whether another app of the suite already has
   your recovery key. If one has, tap **I already have one** yourself,
   and enter the same words.

Limits of the app lock:

9. If you choose a time in **Lock the app** and turn the screen off
   from another app, Reminders may stay unlocked until that time has
   passed ([The app lock](app-lock.md#when-the-app-locks)).
10. The app lock hides your reminders. It does not encrypt them.
    Android's own encryption protects them, with your screen lock.

Limits of backups:

11. A restore keeps the newest edit of each reminder. It cannot bring
    back exactly how Reminders was on the day of the backup.
12. Some storage apps do not let Reminders read a file again right away.
    Reminders then says "Backup written, not checked". Check such a file
    with **Restore a backup**, and tap **Cancel** at the question.
13. A deleted reminder stays in Reminders' storage, with its title,
    marked as deleted, until you clear Reminders' storage. Backups you
    make after the deletion hold it too. Clearing the storage does not
    change backup files you already made: delete those where you put
    them. Reminders cannot yet remove deleted reminders for good.

Other:

14. Never type your real recovery words into a preview build of a pull
    request. Use test words.

Not in version 1:

- Lists, due dates and checklists: they belong to Tasks. A note, a
  place, a colour or a picture: a reminder has only a title.
- Every N days, weeks or months, an end date, several times a day, "the
  last Friday", pausing, other snooze lengths, and a time zone for each
  reminder.
- Alarms that ring until you stop them.
- Widgets, tiles, shortcuts, a watch app, search, and sync.
- Other languages than English.
