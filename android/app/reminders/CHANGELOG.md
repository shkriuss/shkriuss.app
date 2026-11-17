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
- No notification shows yet: a reminder whose time has come says "Now"
  on Upcoming and stays there, and does not move to Past. The
  notifications come next.
- Everything Reminders stores is on the phone: reminders, with their
  title, date, time, repeat and days of the week, in one database, and
  what this phone remembers of each one, in one small file.
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
- Permissions: the two of the app lock's screens
  ([permissions.md](../../../docs/security/permissions.md#reminders-appshkriussreminders)).
  Reminders does not ask for the three of reminders before it shows
  reminders.
- No other app can reach any part of Reminders but its screen.
