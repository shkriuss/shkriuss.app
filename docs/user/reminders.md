# Reminders and notifications

Some apps of the suite remind you at a time you set: Water, Reminders,
Tasks and Calendar. This page says when a reminder shows, and when it
cannot.

No released app has reminders yet. The first one will be Water. This
page says what is already fixed. It was written on 2026-11-13, with the
code that sets the alarms.

Open: the names of the buttons and where they are in an app. They are
set when the first app gets its reminder screen. This page is updated
then.

## The short version

1. A reminder shows at its minute, also when the screen is off.
2. You must allow notifications once. Without that, reminders are
   silent.
3. **After a restart of the phone, no reminder shows until you unlock
   the phone once.**
4. **An app in a locked Private Space shows no reminders.**
5. **An app in another user profile reminds you only while that profile
   is running.**
6. The apps use no network and no Google service for reminders.
   Everything happens on the phone.

## Allow notifications

Android shows a notification only if you allowed it.

1. When you turn on reminders in an app for the first time, the app
   explains what they are for.
2. Then Android asks: "Allow the app to send you notifications?" Tap
   **Allow**.

If you tapped **Don't allow**:

1. The app does not ask again. It shows a message that reminders will
   not appear, with a button to Android's settings.
2. Tap the button. Android's notification page for the app opens.
3. Turn on the switch at the top.

You can also get there yourself: press and hold the app's icon, tap
**App info**, then **Notifications**.

Good to know:

- The app still keeps time while notifications are off. A reminder that
  repeats moves on to its next time. You just do not see it.
- Android lets you turn off one kind of notification and keep the
  others. If you turned off the reminders this way, the app tells you,
  and its button opens that switch.
- On a locked screen, Android decides how much of a notification it
  shows. Set it in Android's settings: search for **Notifications on
  lock screen**.

## After a restart of the phone

When the phone restarts, your data stays locked until you unlock the
phone once, with your PIN, pattern or password. A fingerprint is not
enough for this first unlock. Until then, no app of the suite can read
its reminders, so:

1. **Between the restart and the first unlock, no reminder shows.** It
   makes no sound and does not light the screen.
2. When you unlock the phone, the app sets its reminders again. You do
   not need to open the app.
3. A reminder whose time passed while the phone was off or locked shows
   then, late. Each app decides whether a late reminder is still
   useful. Its own guide says so.

What to do: if the phone restarts, for example after a system update at
night, unlock it once.

This is a choice for your privacy. To remind you before the first
unlock, an app would have to keep its reminders where they can be read
while the phone is still locked. The apps do not do that.

## In Private Space

Private Space is a separate, locked part of the phone. Android has it
from version 15.

1. **While the Private Space is locked, Android stops every app in it.**
   A stopped app cannot remind you, and none of its notifications are
   shown.
2. When you unlock the Private Space, the app sets its reminders again.
   A reminder that was missed shows then, late.
3. When the Private Space is locked again, its notifications are
   hidden.

Android locks the Private Space by itself. When it does so depends on
your settings, for example each time the phone locks.

What to do: install an app whose reminders matter to you outside the
Private Space. Android gives the same warning when you set up a Private
Space.

## In another user profile

Android can have several users on one phone. Each has its own apps and
data. The first one is the Owner.

1. **An app reminds you only while its profile is running.**
2. After a restart of the phone, only the Owner profile starts. Another
   profile starts when you switch to it and unlock it. From then on it
   keeps running in the background when you switch away.
3. A profile stops when you end its session (**End session**), and at
   the next restart of the phone. Android may also stop one when many
   profiles run at once.
4. While a profile runs in the background, its reminders fire. The
   notification belongs to that profile. You see it when you switch to
   it.

On GrapheneOS you can let a profile in the background pass its
notifications on to the profile you are using:

1. Switch to the profile whose reminders you want to see elsewhere.
2. Open Settings, tap **System**, then **Multiple users**.
3. Turn on **Send notifications to current user**.

The profile must still be running for this.

What to do: after a restart of the phone, switch to each profile whose
reminders you need, and unlock it once.

## Other reasons a reminder does not show

| What you see | Why | What to do |
|---|---|---|
| No reminders at all | Notifications are not allowed. | See "Allow notifications" above. |
| No reminders after you tapped **Force stop** on the app's info page | Android removed the app's alarms and keeps the app stopped. | Open the app once. It sets its reminders again. |
| A reminder with no sound | Do Not Disturb is on, or the phone is muted, or you made this kind of notification silent. | Check Do Not Disturb. Then press and hold the notification and tap the gear to see its settings. |
| A reminder at the wrong hour after travel | The phone had not yet changed its time zone. | Nothing. When the phone changes its time zone, the app moves its reminders to the new local time. |

The apps need no exception from battery saving. They do not run in the
background: Android itself wakes the app at the minute of a reminder.
Leave **App battery usage** on the app's info page as it is. Do not set
it to **Restricted**: Android may then hold reminders back.

## What the apps ask Android for

An app with reminders has three permissions. Only the first one is a
question to you.

| Permission | What it is for |
|---|---|
| Notifications | To show the reminder. You allow it or not. |
| Alarms and reminders (exact alarms) | To be woken at the exact minute. Android grants it when the app is installed. |
| Run at startup | To set the reminders again after a restart of the phone. Android grants it when the app is installed. |

The full list, with the reasons, is in
[permissions.md](../security/permissions.md).

## Not yet checked on a phone

Open: the three cases above (after a restart, in Private Space, in
another user profile) follow from how Android and the code work. They
are tested on a GrapheneOS phone before the first app with reminders is
released. This page is corrected if a phone shows something else.
