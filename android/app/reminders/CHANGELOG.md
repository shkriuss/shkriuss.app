# Reminders changelog

Reminders (`app.shkriuss.reminders`) shows a notification with your
title at the time you set: once, or again every day, week, month or
year. Its specification is
[docs/apps/reminders/spec.md](../../../docs/apps/reminders/spec.md).

## Unreleased

Added:

- **Get the keys from another app.** When another app of the suite on
  this phone keeps your recovery key, Reminders can get its own keys from
  it, with no words to type: on the security screen, and in the dialog
  when a backup, a restore or the app lock first needs the key. That
  app asks you to allow it, then shows the system prompt. Reminders never
  gets the words ([Your recovery key](../../../docs/user/recovery-key.md#get-the-keys-from-another-app)).
- Reminders can give another app of the suite its own keys the same way,
  when it keeps the recovery key. It shows which app asks, and the short
  name of the key, and waits for **Allow** and the system prompt.
- When it does not keep the recovery key, the security screen names the
  app that does: "The recovery key is kept in Water", with **Open
  Water**.
- Entering the words while another app keeps the same key first asks
  **Keep it here too?** After **Not now**, it says which app keeps the
  key.
- Turning on the app lock in an app that does not keep the key can let
  an app that keeps it check four of your words, instead of all 24.
- Two parts of Reminders are open to other apps: the screen that gives
  another app its keys, and a small check that says whether Reminders
  keeps a recovery key, and its short name. Both answer only apps of the
  suite signed exactly like Reminders. Any other app gets nothing.
  Reminders asks for no new permission
  ([permissions](../../../docs/security/permissions.md#the-handover-between-apps)).

## 1.0.0 (2026-11-20)

Released as `reminders-v1.0.0`.

The first release of Reminders. How to use it:
[Reminders](../../../docs/user/reminders-app.md).

- Three screens, Upcoming, Past and Settings, in a bar along the bottom
  of a phone and a rail along the side of a tablet.
- Upcoming lists the reminders still to come, soonest first: "Today,
  09:00 · Every day". **Add a reminder** opens the form.
- The form: a title, the repeat (once, every day, every week on the days
  you choose, every month, every year), the date or the days, and the
  time, with a line that says when the reminder comes next. A time that
  has passed, a missing title and a week with no day are refused, with
  words that say why. Delete has Undo.
- Past lists the one-time reminders that have shown, newest first, with
  **Delete all**, which asks first and has Undo.
- On a phone the form slides up from the bottom. On a tablet held
  sideways it opens beside the list.
- Settings has the sections Backup, Security and About, as in Water.
  About shows the version and **Licences**, which lists everything made
  by others that is inside Reminders, with its notice and its licence.
- Each reminder shows as a notification at its minute, with its title
  and its repeat, such as "Every day", and the buttons **Done** and
  **Snooze 10 min**. Each reminder has its own notification, and the
  next time of a reminder replaces the old one.
- A reminder missed while the phone was off or locked, after **Force
  stop**, or in a stopped profile shows late, once: "Missed: 09:00", or
  "Missed: Mon 16 Nov, 09:00" on another day. Older missed times of the
  same reminder are skipped.
- **Snooze 10 min** shows the reminder again 10 minutes later: "Snoozed.
  It was due at 09:00." **Done**, a swipe or no answer: it shows next at
  its next time. A button works once, and only on the newest
  notification of its reminder.
- A tap on a notification opens Reminders, after the app lock, with the
  form of that reminder, on Upcoming or on Past.
- A new date, time or repeat, and a delete, take a reminder's
  notification away. A new title alone leaves it as it is.
- Reminders follow a new time zone and summer time. After the clock is
  set back, a reminder that showed can show again.
- While the app lock hides the text of notifications, a reminder shows
  only "Reminders" and no buttons.
- After every save, while Android has not asked yet, a dialog explains
  that Reminders shows notifications, then Android asks. While a
  reminder is upcoming and notifications cannot show, Upcoming says so,
  with **Allow** or **Open settings**.
- When a reminder could not be shown, a notice takes its place: "A
  reminder could not be shown. Open the app to see it." A tap on it
  starts Reminders anew, with the form of that reminder.
- Everything Reminders stores is on the phone: reminders, with their
  title, date, time, repeat and days of the week, in one database, what
  this phone remembers of each one and of its alarm, in two small files,
  the settings of the app lock, and the keys
  ([data-inventory.md](../../../docs/security/data-inventory.md#reminders-appshkriussreminders)).
  A backup file leaves the phone only when you make one, to the place
  you pick.
- The rules of the specification work as plain code, with tests: when
  a reminder shows, for each repeat; the last day of a shorter month and
  29 February; a missed reminder shown late, once; a snooze; a new time
  zone, summer time, and a clock set back or forward; which reminders
  are upcoming and which are past; and the form: its defaults, the
  limits of the title, a time that has passed, Every week with no day,
  and at most 500 reminders.
- **Make a backup** and **Restore a backup**, as in Water: the file
  picker, a name such as `reminders-2026-11-16.shkbackup`, a check of
  every backup right after it is written, "It holds 42 reminders", the
  question before a restore, and every answer for a file Reminders does
  not take. A backup holds the reminders, deleted ones too, with data
  version 1.
- After a restore, each reminder the restore took counts from that
  moment: a time that passed does not show late, its snooze ends and its
  notification goes. Then the notifications follow.
- **Recovery key** opens the security screen, and **App lock** the app
  lock screen. A backup, a restore and the app lock ask for the recovery
  key when they first need it. The dialog and the security screen say
  how to use a recovery key that Water, or another app of the suite,
  already has: tap **I already have one**, or **I have a recovery key**,
  and enter the same words.
- With the app lock on, Reminders asks for your fingerprint, or your
  phone's PIN, pattern or password, before it shows anything. Its
  notifications go on, in their hidden form.
- Every screen, sheet and dialog of Reminders is behind the app lock,
  and a test checks each one.
- Permissions: the three of reminders, for notifications, exact alarms
  and setting them again after a restart, and the two of the screens of
  the recovery key and the app lock
  ([permissions.md](../../../docs/security/permissions.md#reminders-appshkriussreminders)).
  Reminders asks you for one only: notifications.
- No other app can reach any part of Reminders but its screen.
- A new title alone keeps the reminder's time as it is stored, also a
  time changed meanwhile from the form on the other list. A new time
  alone keeps the title in the same way.
- **Delete all** deletes the reminders that are still past when you tap
  **Delete**. One snoozed from its notification meanwhile stays, and so
  does what you typed in its open form.
- The line "Next:" of the form says when the reminder really shows: a
  snooze, and in the hour that does not exist when the clocks go
  forward, the time it rings, such as 03:30.
- The question for notifications follows every **Save**, also one with
  no change, while Android has not asked.
- **Make a backup** over an old backup file keeps the old file if the
  place cannot be opened for writing. A restore asks again if the file
  changed after the question. A storage app that takes back its access
  ends in "could not be read" or "could not be written", not in a closed
  app.
- "Backup written" comes only if the file read back is the backup just
  written. If a storage app hands back an older copy, Reminders says
  "Backup written, not checked". A backup that holds one reminder twice
  is not taken.
- If the clock is set back in the very moment a reminder is due, it
  shows at its time, not early.
- Turning the app lock on and leaving Reminders in that moment keeps
  it locked, also right after you answer its last prompt. A notification
  already shown is hidden at the next start if the app lock hides the
  text. A long press in the field of a recovery word no longer hands
  the word to Android's text classifier.
- When the text of notifications is hidden, Reminders posts the shown
  ones again a quarter of a second apart, and removes any that Android
  left with its title. Reminders that are due meanwhile still come on
  time. The text is also hidden while Android cannot say whether the key
  file of the app lock is there.
- If Reminders stops right after a reminder is deleted, before its
  notification goes, the next start removes the notification.
- After a restore, the temporary copy of the records is emptied before
  it is deleted, so none is left to read if the delete fails.
- If the screen stops just as Reminders reads your kept recovery key to
  turn the app lock on, the key is not kept, and the prompt asks again
  when you come back.
- If Android says that the key of the app lock can no longer be used,
  Reminders says that the app lock was reset and leads to your 24
  words, instead of offering **Unlock** again and again.
