# Reminders changelog

Reminders (`app.shkriuss.reminders`) shows a notification with your
title at the time you set: once, or again every day, week, month or
year. Its specification is
[docs/apps/reminders/spec.md](../../../docs/apps/reminders/spec.md).

## Unreleased

Not released yet.

- The app starts, and shows one line: "Reminders' screens are not built
  yet." The screens replace it.
- Everything Reminders stores is in place, behind the screens that come
  next: reminders, with their title, date, time, repeat and days of the
  week, in one database on the phone, and what this phone remembers of
  each one, in one small file.
- The rules of the specification work as plain code, with tests: when
  a reminder shows, for each repeat; the last day of a shorter month and
  29 February; a missed reminder shown late, once; a snooze; a new time
  zone, summer time, and a clock set back or forward; which reminders
  are upcoming and which are past; and the form: its defaults, the
  limits of the title, a time that has passed, Every week with no day,
  and at most 500 reminders.
- What a backup holds is in place: the reminders, with data version 1.
  The backup and restore screens come later.
- Every screen of Reminders is behind the app lock, and a test checks it
  for every screen, from now on.
- Permissions: the two of the app lock's screens
  ([permissions.md](../../../docs/security/permissions.md#reminders-appshkriussreminders)).
  Reminders does not ask for the three of reminders before it shows
  reminders.
- No other app can reach any part of Reminders but its screen.
