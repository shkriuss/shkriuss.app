# Reminders changelog

Reminders (`app.shkriuss.reminders`) shows a notification with your
title at the time you set: once, or again every day, week, month or
year. Its specification is
[docs/apps/reminders/spec.md](../../../docs/apps/reminders/spec.md).

## Unreleased

Not released yet.

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
- Settings shows the version.
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
  title, date, time, repeat and days of the week, in one database, and
  what this phone remembers of each one and of its alarm, in two small
  files.
- The rules of the specification work as plain code, with tests: when
  a reminder shows, for each repeat; the last day of a shorter month and
  29 February; a missed reminder shown late, once; a snooze; a new time
  zone, summer time, and a clock set back or forward; which reminders
  are upcoming and which are past; and the form: its defaults, the
  limits of the title, a time that has passed, Every week with no day,
  and at most 500 reminders.
- What a backup holds is in place: the reminders, with data version 1.
  The backup and restore screens come later.
- Every screen, sheet and dialog of Reminders is behind the app lock,
  and a test checks each one.
- Permissions: the three of reminders, for notifications, exact alarms
  and setting them again after a restart, and the two of the app lock's
  screens
  ([permissions.md](../../../docs/security/permissions.md#reminders-appshkriussreminders)).
  Reminders asks you for one only: notifications.
- No other app can reach any part of Reminders but its screen.
