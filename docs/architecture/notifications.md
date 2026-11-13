# Notifications and alarms

How an app of the suite reminds the user at a set time. All of it is the
module `core/notify`. No other module may use Android's alarms or
notifications ([CLAUDE.md](../../CLAUDE.md)). The decisions are in
[ADR 0010](../adr/0010-exact-alarms-and-reminder-storage.md) and
[ADR 0030](../adr/0030-how-core-notify-keeps-alarms.md).

Built in Phase 1, step 6. No app uses it yet. Water is the first
(Phase 2, step 4).

## At a glance

| Part | Choice |
|---|---|
| Alarms | Android's `AlarmManager`, `setExactAndAllowWhileIdle` with `RTC_WAKEUP`: at the exact time on the wall clock, also when the device sleeps |
| Notifications | Android's `NotificationManager` and `Notification.Builder`. No library. |
| Permissions | `POST_NOTIFICATIONS`, `USE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`, in the module's manifest ([permissions.md](../security/permissions.md#apps-that-use-corenotify)) |
| Lint | `MissingPermission` is suppressed on the one function that sets an alarm, because lint does not know `USE_EXACT_ALARM` ([ADR 0030](../adr/0030-how-core-notify-keeps-alarms.md), point 10) |
| Receivers | Two, in the module's manifest. Neither is exported. |
| Where the reminders are | In the app's own database. `core/notify` stores no reminder. |
| What `core/notify` stores | The ids and times of the alarms it registered, and whether the user was asked for the permission. No title, no text. |
| Before the first unlock | Nothing runs and nothing fires ([ADR 0010](../adr/0010-exact-alarms-and-reminder-storage.md)) |
| Libraries added | None |

## What an app does

1. The app class implements `NotifyHost` and builds one `Notify` when
   the app starts:

   ```kotlin
   class WaterApp : Application(), NotifyHost, SecurityHost {
       override val notify: Notify by lazy {
           Notify(
               this,
               listOf(drinkChannel),
               reminders,
               reminders,
               Clock.System,
               hidesText = appLock::hidesNotificationText,
           )
       }

       override fun onCreate() {
           super.onCreate()
           appLock.start()
           notify.start()
       }
   }
   ```

   The parts of `SecurityHost` are in
   [security-screens.md](security-screens.md#what-an-app-does-for-the-app-lock).

2. It hands over five things:
   - **The channels.** Each is a `NotifyChannel`: a fixed id, a name and
     a description from the app's string resources, and how much it
     interrupts at the start (`ChannelImportance`).
   - **An `AlarmSource`.** It answers one question: which alarms does
     the app want from now on? The app reads that from its records.
   - **An `AlarmHandler`.** It runs when an alarm fires. The app reads
     the record and shows a notification.
   - **A `Clock`**, the one from `core/data`. A test passes its own.
   - **`hidesText`.** It answers whether notifications must hide their
     text now ([While the app lock is on](#while-the-app-lock-is-on)).
     It has no default, so that no app can forget it. An app with the
     app lock passes `AppLockWatcher.hidesNotificationText`. An app
     without one passes `{ false }` and says so in a comment.
3. After every change to a reminder, the app calls `notify.sync()`. That
   is all. It never sets or removes a single alarm itself.
4. A screen that turns reminders on asks `notify.state(channel)` and
   shows what it says ([the states](#the-permission-and-the-states)).

An alarm is an id and a time: `Alarm(AlarmId, atMillis)`.

- The id is the `id` of the record, or a fixed name such as
  `next-drink`. It has 1 to 64 characters: letters, digits, `.`, `_`
  and `-`. It is never user content.
- The time is in milliseconds since 1970-01-01T00:00:00Z, like every
  timestamp of a record.

### Rules for the app's `AlarmSource`

1. Name every alarm that should fire from now on, each id once.
2. Work out each time from the record and the time zone of this moment,
   with `java.time`. A reminder "every day at 09:00" then follows a new
   time zone and the change to summer time by itself.
3. A time in the past is allowed. That alarm fires within seconds. This
   is how a reminder that was missed while the device was off shows up
   late. An app that does not want late reminders leaves them out.
4. After the handler ran for an alarm, name its next time, or leave it
   out.
5. It is called on a background thread, so it may read the database.

### Rules for the app's `AlarmHandler`

1. It runs on a background thread and has a few seconds.
2. Doing it twice must give the same result as doing it once. If the app
   stops in the middle, it runs again for the same alarm later.
3. It shows notifications through the `Notifications` it is given.

## The parts

| Class | What it is for |
|---|---|
| `Notify` | The entry point. `start`, `sync`, `hideShownText`, `state`, `permissionAnswered`, `settingsIntent`, and `notifications`. |
| `NotifyHost` | The interface of the app class. Android creates the receivers itself, so nothing can be passed to them through a constructor. They reach the app's `Notify` through the app class. |
| `Alarm`, `AlarmId`, `AlarmSource`, `AlarmHandler` | What the app names and gets back. |
| `AlarmScheduler` | The small interface in front of `AlarmManager`: `set` and `cancel`. `AlarmManagerScheduler` is the real one. A test passes one that only keeps a list. |
| `AlarmSync` | The rules below. Internal. |
| `AlarmRegistry` | The small file with ids and times. Internal. |
| `NotifyChannel`, `ChannelImportance` | A notification channel. |
| `Notifications`, `ShkNotification` | Showing and removing a notification. |
| `NotifyState` | What a screen shows about the permission and the channel. |
| `AlarmReceiver`, `SystemEventReceiver` | The two receivers. |

## How alarms are kept right

There is one way in for every cause. A sync asks the app's `AlarmSource`
for everything it wants now and makes Android's alarms match. A reboot,
an update, a new time zone and a changed reminder all run the same
code.

A sync does this:

1. It asks the app for its alarms.
2. It leaves out every alarm that already fired with the same id and
   the same time.
3. It takes the 100 soonest of the rest. Android allows one app 500
   alarms. An app with more reminders still gets every one: each alarm
   that fires ends in a sync, which registers the ones after it.
4. It removes from Android every alarm it registered earlier that is no
   longer among them.
5. It sets every alarm that is new or has a new time.
6. At a start of the app, and after one of Android's four broadcasts,
   it sets all of them again, also those it already set. Android may
   have dropped its alarms since, and setting an alarm twice leaves one
   alarm.
7. It writes the ids and times into its file.

Why step 5 leaves the other alarms alone: Android fires no alarm sooner
than about 5 seconds after it was set. Setting an alarm again that is
almost due would make it late.

When Android fires an alarm:

1. The handler runs only if that alarm is registered and its time has
   come on the clock. Anything else is an old or repeated broadcast and
   is dropped. So **the handler runs once for one id and time.**
2. Then the alarm is written down as fired, and a sync follows. That
   sets the next time of a reminder that repeats.
   - If the broadcast was dropped, that sync sets all alarms again.
     Android's alarms and the file may differ then.
3. "Fired" is written after the handler. If the app stops inside the
   handler, the alarm fires again at the next sync.
4. "Fired" is written also when the handler fails. A reminder that
   cannot be read fails once, and not at every start of the app.

Two more rules:

- **The clock was set back.** An alarm that is written down as fired at
  a time that is now in the future is due again. The mark is dropped
  and the alarm is set.
- **One thread.** Every sync and every fired alarm of an app runs on one
  worker thread, one after the other.

## When alarms are registered again

| Moment | What Android does | What `core/notify` does |
|---|---|---|
| The app starts | | `Notify.start()` makes the channels and runs a sync that sets all alarms again. |
| The app changes a reminder | | The app calls `Notify.sync()`. New and changed alarms are set. |
| An alarm fired | The alarm is gone. | The handler runs, then a sync as after a change. |
| Reboot | Every alarm is forgotten. After the first unlock, Android sends `BOOT_COMPLETED`. | `SystemEventReceiver` runs a sync that sets all alarms again. |
| The profile of the app starts (a secondary user, Private Space unlocked) | The same as a reboot, for that profile. | The same. |
| App update | The app is stopped, and its alarms can be lost with it. Android sends `MY_PACKAGE_REPLACED`. | The same. |
| The time changed | Android sends `TIME_SET`, and fires what is now due. | The same. |
| The time zone changed | Android sends `TIMEZONE_CHANGED`. | The same. The app works out its times again. |
| "Force stop" in Android's settings | Every alarm is dropped, and the app gets no broadcast until the user opens it. | Nothing can be done. The next start of the app runs a sync. |

The change to and from summer time needs no broadcast. The app names the
next time of a reminder after each alarm, and `java.time` already knows
the change.

Both receivers keep their broadcast open until the work is done
(`goAsync`). For an alarm, Android keeps the device awake that long.

## What goes where

Hard rule 10: no user content is logged. `core/notify` logs nothing at
all.

| Where | What is there |
|---|---|
| The alarm at Android | The time, and a broadcast to `AlarmReceiver` of this app with the alarm id. No title, no text, no extras. |
| The file `app.shkriuss.core.notify.xml` in the app's private storage | For each registered alarm its id and time. For each fired alarm its id and time. Whether the user was asked for the permission. |
| The notification | The title and text the app's handler read from its database at that moment. They go to Android to be shown. While the app lock hides the text: only the channel's name and a fixed text. |

- The file is in credential-encrypted storage, like the database. It
  can be read only after the first unlock.
- The file is not in a backup. After a restore, the app calls
  `Notify.sync()`.
- A notification is shown with `VISIBILITY_PRIVATE`. On a locked screen
  Android shows its text only if the user lets the lock screen show all
  notification content.
- A tap opens a screen of the same app. `Notifications.show` refuses any
  other target.

## While the app lock is on

Decided by the owner on 2026-11-13, in Phase 1, step 7, session B, with
the app lock ([security-screens.md](security-screens.md#the-app-lock)).

1. While the app lock is on, a notification shows only the name of its
   channel, for example "Drink reminders", and the text "The app lock
   hides this notification. Open the app to see it." It is the same
   while the app is unlocked, so nothing changes when the app locks.
2. The app lock screen has a switch, "Show the text in notifications".
   It is off by default. With it on, notifications show their title and
   text as when the app lock is off.
3. When the app lock is turned on, or the switch is turned off, the
   notifications already showing are posted again in the hidden form,
   so no old text stays in the notification shade. They keep their key,
   tap target, icon and time, and make no new sound
   (`setOnlyAlertOnce`). `Notify.hideShownText()` does it, on the
   module's one worker thread, after any alarm handler that is running.
   The app lock calls it through the `onTextHidden` it was given.
4. If the state of the app lock cannot be read, the text is hidden.
   `Notifications.show` also hides it when `hidesText` itself fails.
5. A notification that is hidden stays hidden after the app lock is
   turned off. New ones show their text again.
6. The title and text the app gives are never stored by `core/notify`,
   so a hidden notification cannot be shown again with its text. A tap
   opens the app, behind the lock screen.

## Channels

1. An app lists all its channels when it builds `Notify`.
2. `Notify.start()` tells Android about them at every start. A channel
   that exists keeps the user's choices. Only its name and description
   are updated, for example after a change of language.
3. The id of a channel never changes. Android keeps the user's choices
   under it.
4. The importance is only the start value. After the channel exists,
   only the user can change it.
5. `core/notify` never deletes a channel.

## The permission and the states

Android shows a notification only after the user allowed it. The
question is Android's own dialog for `POST_NOTIFICATIONS`. A screen of
the app starts it.

`Notify.state(channel)` answers what a screen shows:

| State | What it means | What the screen does |
|---|---|---|
| `Ready` | Notifications of this channel are shown. | Nothing. |
| `NotAsked` | The user was never asked. | It explains what the reminders are for. Then it starts Android's question for `Notify.PERMISSION`. When the answer is in, it calls `notify.permissionAnswered()`. |
| `Denied` | The user said no, or turned the app's notifications off. | It says that reminders will not appear. It offers a button that opens `notify.settingsIntent(channel)`, Android's notification page for the app. The app does not ask again. |
| `ChannelOff` | Notifications are allowed, but the user turned this channel off. | It says so, and offers the same button. It opens the channel's page. |

- The screen asks for the state every time it comes to the front. The
  user can change the answer in Android's settings at any moment.
- After one "no", the app never shows Android's question again. The way
  back is the settings page, which always works. Android itself stops
  showing the question after the second "no".
- **Alarms fire in every state.** The handler runs, so a reminder that
  repeats moves on. Android drops the notification. That is why the
  screen must say clearly that reminders are silent.
- `USE_EXACT_ALARM` and `RECEIVE_BOOT_COMPLETED` are granted at install.
  The user is not asked and cannot take them away.

Open: the screen itself, with its words, is built with the first app
that has reminders (Phase 2, step 4). `core/notify` has no screen.

## Limits of Android

These are not choices of the suite. The page for users is
[reminders.md](../user/reminders.md).

| Case | What happens |
|---|---|
| After a reboot, before the first unlock | The app's storage is locked. Nothing runs, no alarm is registered, nothing fires. After the unlock, Android sends `BOOT_COMPLETED`, the alarms are registered again, and a missed reminder that the app still names fires late. The opt-in mode of [ADR 0010](../adr/0010-exact-alarms-and-reminder-storage.md), point 5, is not built. |
| Private Space, locked | Android stops every app in it. They cannot run and cannot show notifications. When it is unlocked, its apps are told as after a reboot. |
| A secondary profile | Its apps run only while the profile is running. After a reboot it is not running until the user switches to it and unlocks it. "End session" stops it. While it runs in the background, alarms fire, and the notification belongs to that profile. |
| An alarm for the next few seconds | Android fires no alarm sooner than 5 seconds after it was set. An alarm for an earlier moment, or for the past, fires then. Two alarms that become due together can arrive in either order ([emulator-tests.md](../development/emulator-tests.md#what-the-notify-tests-showed)). |
| Deep sleep | The alarm wakes the device. Android limits how many such alarms one app may fire in an hour while the device sleeps deeply. Reminders stay far below that. |
| "Force stop" | See the table above. |

## Tests

Unit tests, on the JVM. They are in `core/notify/src/test/`:

| Test class | What it checks |
|---|---|
| `AlarmSyncTest` | The rules of "How alarms are kept right", with a clock the test moves and a stand-in for Android's alarms: what is registered, that an alarm fires once and not before its time, changed and removed reminders, a reminder that repeats, a reboot, a missed alarm, the clock set forward and back, a new time zone, more than 100 alarms, a handler that fails, and that a change in the app does not set the other alarms again. |
| `AlarmManagerSchedulerTest` | What is asked of `AlarmManager`: exact, on the wall clock, waking the device, one alarm for each id, a broadcast that only this app can send and that carries only the id. |
| `NotifyTest` | `Notify` as an app uses it, on Robolectric's Android: the channels, a notification when an alarm fires, the four states and the settings pages, and that the alarms are registered again after each of the four broadcasts. The broadcasts reach the receivers through the module's manifest. The hidden form while the app lock is on, also when `hidesText` fails, and the shown notifications posted again in it with the same key and tap target and no new alert. |
| `ManifestTest` | The module's manifest: the three permissions and no other, two receivers, not exported, nothing that runs before the first unlock, and exactly the four broadcasts. |
| `NotifyBoundaryTest` | No other module under `android/` names `AlarmManager` or a notification class of Android or AndroidX. It reads source, like `CryptoBoundaryTest` ([build.md](../development/build.md#unit-tests)). |

The clock in these tests is `TestClock` of `core/testing`. Nothing in
`core/notify` reads the device's clock itself.

Tests on an emulator, with a real Android and the device's clock, are in
[emulator-tests.md](../development/emulator-tests.md#the-tests-of-corenotify).
That page also lists what no emulator can check, and the steps for the
three devices.

## Open

1. The screen for the permission, and its words (Phase 2, step 4).
2. Buttons on a notification, such as "Done" or "Later". `core/notify`
   has none yet. They come with the first app that needs them.
3. A notification that is not a reminder, for example progress in the
   Sync app. Today every app that uses `core/notify` gets all three
   permissions and both receivers.
4. The checks on a GrapheneOS device: after a reboot, in a secondary
   profile and in Private Space
   ([emulator-tests.md](../development/emulator-tests.md#steps-for-the-three-devices-reminders)).
5. What a notification shows while the app lock is on. Decided in
   Phase 1, step 7, session B
   ([While the app lock is on](#while-the-app-lock-is-on)).
6. What the user sees when an app's alarm handler fails. Today the
   reminder is marked as fired and is lost without a word
   ([How alarms are kept right](#how-alarms-are-kept-right)). Decided in
   Phase 2, step 4, with the reminders of Water.
