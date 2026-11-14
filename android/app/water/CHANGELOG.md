# Water changelog

Water (`app.shkriuss.water`) helps you drink enough during the day: log
each drink with one tap, see how close you are to your daily goal, and
get reminders during the hours you choose. Its specification is
[docs/apps/water/spec.md](../../../docs/apps/water/spec.md).

## Unreleased

Not released yet. Version 1.0.0 is prepared in step 2.6.

Step 2.3, the screens:

- Water opens on **Today**. The navigation has three destinations:
  Today, History and Settings, in a bar along the bottom of a phone and
  a rail on a tablet or a phone on its side. Each destination keeps its
  place when you switch. Back from History or Settings goes to Today.
- **Today**: the total of today, how much of the goal it is, a progress
  bar, and "Goal reached" with a check once the goal is met. Three
  buttons add a quick amount, such as "+250 ml", and "Other amount"
  opens the sheet "Add a drink". The drinks of today are listed, newest
  first. After each new drink, "Added 250 ml" offers Undo. At midnight
  Today moves to the new day by itself. On a tablet the drinks are in a
  pane of their own.
- **Add a drink** and **Edit drink**: the amount, with the unit after
  it, and the time. An amount outside the limits, or a time later than
  now on today, is named and not saved. A drink can be deleted, and Undo
  brings it back.
- **History**: one row per day since the first drink, with the total,
  the goal that day had, and "Goal reached". A tap opens the day, where
  drinks can be added and changed. On a tablet the day opens beside the
  list.
- **Settings**: the daily goal, the unit (millilitres or US fluid
  ounces), the three quick amounts, and the reminder hours: "Every",
  "From" and "Until". A value outside its limits is named in the dialog,
  which stays open. "Until" must be at least 30 minutes after "From". A
  line says when no reminder fits between them. Under About: the
  version.
- Not there yet: the switch "Remind me to drink" and the line about
  notifications, which come with the reminders in step 2.4; Backup,
  Security and Licences, which come in step 2.5. Until step 2.4 no
  reminder comes, whatever the reminder hours say.
- TalkBack reads amounts with the unit in words, such as "250
  millilitres", reads the summary as one item, and reads each drink and
  each day of History as one item.
- Every screen, sheet and dialog is behind the app lock, and a test
  checks each sheet and dialog too.

Step 2.2, the data and the logic:

- The app started with one line in place of the screens. Step 2.3
  replaced it, and deleted the line and its screenshots.
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
