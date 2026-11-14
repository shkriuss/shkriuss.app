# Water changelog

Water (`app.shkriuss.water`) helps you drink enough during the day: log
each drink with one tap, see how close you are to your daily goal, and
get reminders during the hours you choose. Its specification is
[docs/apps/water/spec.md](../../../docs/apps/water/spec.md).

## Unreleased

Not released yet. Version 1.0.0 is prepared in step 2.6.

Step 2.2, the data and the logic:

- The app starts, and shows one line: "Water's screens come in the next
  step." Step 2.3 replaces it with Today, History and Settings, and
  deletes the line and its screenshots.
- Everything Water stores is in place, behind the screens that come
  next: drinks, the daily goal of each day, and the settings, in one
  database on the phone.
- The rules of the specification work as plain code, with tests: the
  goal of a day, the settings in use, millilitres and US fluid ounces,
  and when the next reminder comes. Reminders themselves come in step
  2.4.
- What a backup holds is in place: drinks, goals and settings, with data
  version 1. The backup and restore screens come in step 2.5.
- Every screen of Water is behind the app lock, and a test checks it for
  every screen, from now on.
- Permissions: none. Water does not ask for the two permissions of the
  app lock's screens before step 2.5, nor for those of reminders before
  step 2.4 ([permissions.md](../../../docs/security/permissions.md#water-appshkriusswater)).
- No other app can reach any part of Water but its screen. Water removes
  a receiver that a library adds for developer tools
  (`androidx.profileinstaller`). The start-up profile is still installed
  when the app starts.
