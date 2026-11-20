# Water

Water helps you drink enough during the day. You log each drink with one
tap and see how close you are to your daily goal. It can remind you
during the hours you choose. Everything stays on your phone, with no
account and no network.

## Install it

1. Install it with Obtainium, as [Install with Obtainium](install.md)
   says. In **Filter release titles by regular expression**, type
   `^water-v`.
2. Check it with AppVerifier, as [Verify with AppVerifier](verify.md)
   says. Its package name is `app.shkriuss.water`.

Water needs Android 15 or newer.

## The first start

1. Open Water. It opens on **Today**. There is no setup and no welcome
   screen.
2. The daily goal is 2,000 ml. The three quick amounts are 150, 250 and
   500 ml. Reminders are off. Change any of them in **Settings**.

Water asks for your recovery key only when something needs it: a
backup, a restore or the app lock ([Your recovery key](recovery-key.md)).

Water has three places, in a bar along the bottom of the screen:
**Today**, **History** and **Settings**. On a tablet, or a phone on its
side, the bar is a rail along the side. Each place keeps where you were
when you switch. **Back** from History or Settings goes to Today.

## Today

At the top: how much you drank today, such as "1,250 ml", and under it
"of 2,000 ml · 62%", with a bar. When you reach your goal, a check and
"Goal reached" appear.

Log a drink:

1. Tap a quick amount, such as **+250 ml**. Water logs it now.
2. A message says "Added 250 ml". Tap **Undo** if it was a mistake.

Log another amount, or a drink from earlier today:

1. Tap **Other amount**. The sheet **Add a drink** opens.
2. Type the amount. Tap the time to change it.
3. Tap **Save**.

Below the buttons are today's drinks, newest first, such as "14:05 ·
250 ml". With no drink yet, it says "No drinks yet today."

While reminders are on, a line says when the next one comes, such as
"Next reminder at 14:30". If Water cannot show reminders, the line says
why, with a button to fix it ([Reminders](#reminders)).

At midnight Today moves to the new day by itself. After a change of the
phone's clock or time zone, every screen follows within a minute.

## Change or delete a drink

1. Tap the drink in the list. The sheet **Edit drink** opens.
2. Change the amount or the time, and tap **Save**.
3. Or tap **Delete**. A message says "Drink deleted". Tap **Undo** to
   bring it back.

Good to know:

- An amount must be from 1 to 3,000 ml (1 to 101 fl oz).
- On today, a time later than now is refused: "That time has not come
  yet."
- A drink's day cannot be changed. To move it, delete it and add it on
  the other day.

## History

**History** lists every day since your first drink, newest first. Each
row shows the day, such as "Yesterday" or "Thu, 12 Nov", how much you
drank and that day's goal, such as "1,800 of 2,000 ml", and "Goal
reached" when you reached it. Days with no drink show "0 ml".

1. Tap a day. It opens, with its drinks.
2. Tap **Add a drink** to add a drink on that day. The time starts at
   12:00.
3. Tap a drink to change or delete it.

On a tablet, the day opens beside the list.

A day keeps the goal it had. When you change your goal, it counts from
today. Past days do not change.

## Settings

Tap an item to change it. A change takes effect at once.

**Drinking**

- **Daily goal**: from 500 to 10,000 ml. The new goal counts from
  today.
- **Unit**: **Millilitres (ml)** or **US fluid ounces (fl oz)**. Water
  keeps every amount in millilitres, so changing the unit changes
  nothing you logged.
- **Quick amounts**: the three buttons of Today. The first one is also
  the amount of a reminder's **Drank** button.
- In fluid ounces, a goal or a quick amount that you leave as it is in
  its dialog stays exactly as it was.

**Reminders**

- **Remind me to drink**: turns reminders on and off.
- **Every**: 30 minutes, 45 minutes, 1 hour, 1 hour 30 minutes, 2 hours
  or 3 hours.
- **From** and **Until**: the hours when reminders may come. "Until"
  must be at least 30 minutes after "From". They cannot cross midnight.

**Backup**: **Make a backup** and **Restore a backup**
([Back up and restore](#back-up-and-restore)).

**Security**: **Recovery key** and **App lock**
([The recovery key and the app lock](#the-recovery-key-and-the-app-lock)).

**About**: the version, and **Licences**, which lists everything made by
others that is inside Water, with its licence.

## Reminders

1. In **Settings**, set **Every**, **From** and **Until**.
2. Turn on **Remind me to drink**.
3. The first time, Water explains in a dialog, "Allow notifications".
   Tap **Continue**. Android then asks. Tap **Allow**.

When reminders come:

- Every interval you chose, counted from your last drink, between
  **From** and **Until**.
- At their minute, also while the screen is off.
- None once you reached today's goal.
- A reminder says "Time for some water" and how much you drank, such as
  "1,250 of 2,000 ml today".

The two buttons:

- **Drank 150 ml** logs a drink of your first quick amount, now. The
  next reminder then comes one interval after it. If Water cannot save
  the drink, the reminder stays, and you can press **Drank** again.
- **Later** reminds you again in 15 minutes.
- On the lock screen, a button first asks you to unlock the phone.
  Before the unlock it does nothing.
- To undo **Drank**, open Water, tap the drink at the top of Today, and
  tap **Delete**.

A tap on the reminder opens Today.

If notifications are not allowed, or **Drink reminders** is turned off
in Android's settings, Water still keeps time but shows nothing. The
line on Today says so, and its button opens the right page of Android's
settings. A reminder that was due while notifications were off counts
as shown: the next one comes one interval after it.

What happens when the phone was off, after a restart, in Private Space
or in another user profile is in
[Reminders and notifications](reminders.md). In short: a missed reminder
is skipped, never shown late, and Water names the next one.

Who else can see a reminder:

- On the lock screen, Android shows its text only if your phone's
  setting allows it.
- A reminder's text and buttons reach another app only if you gave that
  app notification access. Such an app can pass them on to a watch. It
  can also press the buttons, without the phone's unlock.
- With the app lock on, a reminder shows only "Drink reminders" and "The
  app lock hides this notification. Open the app to see it.", without
  amounts and without buttons. Unless you turn on **Show the text in
  notifications** on the app lock screen.

## Back up and restore

A backup is one file that holds your drinks, your goals and your
settings. You choose where it goes. How backups work for every app is in
[Back up and restore](backup.md).

Make a backup:

1. In **Settings**, tap **Make a backup**.
2. The first time, Water asks you to set up your recovery key. Tap
   **Create a recovery key**, or **I already have one**.
3. Android's file picker opens, with a name such as
   `water-2026-11-15.shkbackup`. Pick a place and tap **Save**.
4. Water writes the file, reads it again and checks it. It says "Backup
   written" and how many drinks the backup holds.

Restore a backup:

1. In **Settings**, tap **Restore a backup**, and pick the file.
2. Water checks the whole file first. It asks "Restore this backup?",
   with when it was made and how many drinks it holds.
3. Tap **Restore**, or **Cancel** to change nothing.

For every drink, goal and setting, the newest edit stays. A restore
cannot undo a deletion or an edit you made after the backup.

Restore on a new phone:

1. Install Water, and tap **Restore a backup**. Water says "Enter your
   recovery key first".
2. Tap **Enter the words**, and type your 24 words. The file picker then
   opens by itself.
3. Pick the file, and tap **Restore** at the question. Your drinks,
   goals and settings are back.
4. If reminders were on, the line on Today says "Reminders are on, but
   Water may not show notifications yet." Tap **Allow**, then
   **Continue**, then **Allow** in Android's question.

In Water's backup: every drink, every goal, and the settings of
**Drinking** and **Reminders**. Not in it: the app lock and its
settings, the times of past reminders, and your recovery key.

## The recovery key and the app lock

- **Recovery key** opens the security screen. Create your 24 words
  there, enter them, or see them again
  ([Your recovery key](recovery-key.md)).
- **App lock** makes Water ask for your fingerprint, or your phone's
  PIN, pattern or password, before it shows anything
  ([The app lock](app-lock.md)).

## TalkBack

- Amounts are read with the unit in words, such as "250 millilitres" or
  "8 fluid ounces".
- The summary of Today is read as one item, such as "1,250 of 2,000
  millilitres today, 62 percent".
- Each drink and each day of History is one item.
- The messages after a new drink or a deletion are read, with their
  **Undo**.
- Section headers are headings, so you can jump between them.

## Permissions

Water asks Android for five permissions, and no other:

| Permission | What it is for | Who decides |
|---|---|---|
| Notifications | To show reminders | You. Android asks the first time you turn on reminders. |
| Alarms at an exact time | To remind you at the right minute | Android, at install |
| Run at start-up | To set the next reminder again after a restart | Android, at install |
| Use biometric hardware | To show Android's own prompt for the app lock and your recovery key | Android, at install |
| Hide other apps' windows | To hide other apps' windows over the recovery key screens and the lock screen | Android, at install |

Water has no network permission and no storage permission. It reaches
only the one file you pick. The details are in
[permissions.md](../security/permissions.md#water-appshkriusswater).

## Your data

Everything Water stores stays on your phone, in Water's own storage. It
sends nothing over the network, has no account and tracks nothing. What
it stores, and what can leave the phone, is in [Privacy](privacy.md).

To delete everything: in Android's Settings, open **Apps**, then
**Water**, **Storage**, and tap **Clear storage**. That also deletes
Water's keys. A backup then opens only with your 24 words.

## Known problems

Version 1.0.1 has these known problems and limits.

Not checked on a phone yet:

1. How TalkBack reads "ml" and "fl oz" on the buttons of a reminder.

Limits of reminders:

2. No reminder comes after a restart until you unlock the phone once.
   Water cannot run before that.
3. A missed reminder is skipped, never shown late. A reminder can come
   up to a minute late.
4. No reminder comes while Water's profile or Private Space is stopped,
   or after **Force stop**, until you open Water again.
5. A reminder's text and buttons reach apps you gave notification
   access. Such an app can pass them on to a watch, and can press the
   buttons without the phone's unlock. Water does not
   mark its reminders "local only". Whether it should, or offers a
   setting, is not decided yet.
6. With the app lock off, the lock screen shows a reminder's text if
   your phone's setting allows it.
7. When the clocks go back at the end of summer time, one hour of the
   night comes twice. A drink you log in the second of the two counts
   as if you logged it in the first, so the next reminder can come up
   to an hour early, that one night.

Limits of the app lock:

8. If you choose a time in **Lock the app** and turn the screen off
   from another app, Water may stay unlocked until that time has passed
   ([The app lock](app-lock.md#when-the-app-locks)).
9. The app lock hides your drinks. It does not encrypt them. Android's
   own encryption protects them, with your screen lock.

Limits of backups:

10. A restore keeps the newest edit of each drink, goal and setting. It
    cannot bring back exactly how Water was on the day of the backup.
11. Some storage apps do not let Water read a file again right away,
    or hand back an older copy. Water then says "Backup written, not
    checked". Check such a file with **Restore a backup**, and tap
    **Cancel** at the question.

Other:

12. Never type your real recovery words into a preview build of a pull
    request. Use test words.
13. No accessibility checks run on an emulator for Water. A TalkBack
    pass on a phone stands in for them.

Not in version 1.0.1:

- Kinds of drinks, such as coffee or tea, charts and statistics.
- UK fluid ounces, litres or cups.
- Reminder hours that cross midnight, or different hours on different
  days.
- Widgets, a watch app, and sync.
- Other languages than English.
