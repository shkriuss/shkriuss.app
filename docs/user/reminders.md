# Reminders and notifications

Some apps of the suite remind you at a time you set: Water, Reminders,
Tasks and Calendar. This page says when a reminder shows, and when it
cannot.

Water and Reminders have reminders now. How to use Water's reminders is
in [its guide](water.md#reminders). What Reminders does is
[below](#what-reminders-does).

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

1. When you turn on reminders in an app, or save a reminder in
   Reminders, the app explains what they are for. If you tap **Not
   now**, it explains again the next time, until Android has asked.
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
- While the app lock of an app is on, its notifications show no text,
  only their kind, and no buttons. You can show the text again on the
  app lock screen ([The app lock](app-lock.md#notifications)).

## Buttons on a reminder

Some reminders have buttons. Water's has **Drank** with your first
quick amount, such as **Drank 150 ml**, which logs that drink, and
**Later**, which reminds you again in 15 minutes. Each reminder of
Reminders has **Done**, which takes it away, and **Snooze 10 min**,
which shows it again 10 minutes later.

1. On the lock screen, a button first asks you to unlock the phone.
   Without the unlock it does nothing.
2. A button does what it says, even if you changed the app's settings
   since the reminder came.
3. A button works once. A button on an older reminder does nothing.
4. There is no undo in the notification. To undo what a button did,
   open the app and change it there. In Water: tap the drink at the top
   of Today, then **Delete**.
5. While the app lock hides the text of notifications, a reminder has no
   buttons. Open the app to answer it.

## Who else sees a reminder

1. On the lock screen, Android shows a reminder's text only if your
   phone's setting allows it.
2. A reminder's text and buttons reach another app only if you gave that
   app notification access. Such an app can pass them on to a watch, for
   example a watch's companion app.
3. Water and Reminders do not mark their reminders "local only". That
   mark would not hide them from apps with notification access. It only
   asks apps that pass notifications to a watch not to pass them on.
   Whether they mark them, or offer a setting, is not decided yet.
4. With the app lock on, a reminder shows only its kind and "The app
   lock hides this notification. Open the app to see it.", without its
   title or amounts and without buttons. Unless you turn on **Show the
   text in notifications** ([The app lock](app-lock.md#notifications)).
5. If you turned on Android's notification history, Android keeps the
   notifications of the last 24 hours there, with their text, also after
   they are gone from the screen.

## When a reminder cannot be shown

Rarely, an app cannot read or show a reminder at its time. Then you see
a notification in its place, with the kind of reminder, such as "Drink
reminders", and the words "A reminder could not be shown. Open the app
to see it." Open the app. The next reminder still comes.

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
   useful. Water skips it; Reminders shows it
   ([below](#what-reminders-does)).

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

## What Water does in these cases

Water skips a reminder whose time passed more than a minute ago. It
never shows one late. On GrapheneOS:

1. **After a restart**, a reminder comes at its minute once you have
   unlocked the phone, also if you have not opened Water. Before the
   first unlock, nothing shows and nothing makes a sound. When you
   unlock later, a reminder that was due is skipped, and the next one
   comes at its time.
2. **In another user profile**, a reminder comes while the profile runs
   in the background. You see it when you switch to that profile. With
   **Send notifications to current user** on, it also shows in the
   profile you are using. After **End session**, nothing comes; when you
   switch back and unlock, Water names the next reminder.
3. **In Private Space**, nothing shows while it is locked. When you
   unlock it, no missed reminder appears, and Water names the next one.
4. **After Force stop**, nothing comes. When you open Water, no missed
   reminder appears, and Water names the next one.
5. **After a change of time zone**, the next reminder moves to the new
   local time.

## What Reminders does

Reminders shows each reminder at its minute, with its title, and the
buttons **Done** and **Snooze 10 min**. Its own guide is
[Reminders](reminders-app.md).

1. **The text** says the repeat, such as "Every day" or "Every Mon, Wed,
   Fri". A one-time reminder has none.
2. **A missed reminder shows late, once.** Its text says "Missed:
   09:00", or "Missed: Mon 16 Nov, 09:00" when it was another day. If
   several times of one reminder were missed, only the latest shows.
   This happens after a restart, after **Force stop**, in another
   profile and in Private Space, as the cases above say.
3. **Snooze 10 min** shows the reminder again 10 minutes later, with
   "Snoozed. It was due at 09:00."
4. **Done**, a swipe, or no answer: the reminder shows next at its next
   time. The next one replaces the old one on the screen.
5. **A tap** opens Reminders with that reminder, after the app lock.
6. **Each reminder has its own notification.** Several can show at
   once.
7. **After a change of time zone**, a reminder shows at its time in the
   new zone: "09:00" stays 09:00 on the phone's clock.
8. **After you set the clock back**, a reminder that showed can show
   again.
9. **Without notifications**, Reminders still keeps time: a reminder
   that repeats moves on to its next time. Upcoming says that your
   reminders are silent, with a button to fix it.
