# 0030 How core/notify keeps alarms, and what it adds to an app

- Status: Proposed
- Date: 2026-11-13
- Source: Phase 1, step 6 ([PROMPTS.md](../development/PROMPTS.md)),
  [pull request 26](https://github.com/shkriuss/shkriuss.app/pull/26).
  Claude proposed it while building `core/notify`. The owner accepts it,
  or changes it, in the review of that pull request.

## Context

- [0010](0010-exact-alarms-and-reminder-storage.md) decided: exact alarms
  through `AlarmManager`, only in `core/notify`; `USE_EXACT_ALARM`;
  alarms registered again after a reboot, an app update and a time-zone
  change; reminder data stays in credential-encrypted storage. It did
  not say how.
- Android forgets every alarm at a reboot, and drops them at "Force
  stop". It cannot list the alarms of an app.
- Android creates a broadcast receiver itself. Nothing can be passed to
  it through a constructor, and there is no dependency-injection
  framework ([0012](0012-no-di-framework.md)).
- A reminder's title is user content. It must not be logged, and should
  not be stored a second time.
- A notification needs the permission `POST_NOTIFICATIONS`, which the
  user can refuse. A receiver for the start of the device needs
  `RECEIVE_BOOT_COMPLETED`. Neither had a decision record.
- No library may be added without a decision record.

## Decision

1. **The app's database is the only place where reminders are.**
   `core/notify` asks the app for its alarms (`AlarmSource`) every time
   it registers them. An alarm is an id and a time, nothing else.
2. **One way in.** A sync asks for all alarms and makes Android's
   alarms match. It runs when the app starts, when the app says
   something changed, after each alarm that fired, and after the four
   broadcasts `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `TIME_SET` and
   `TIMEZONE_CHANGED`. `TIME_SET` is added to the list of 0010: after
   the clock is set back, an alarm may be due a second time.
   - At a start of the app and after the four broadcasts it sets every
     alarm again, because Android may have dropped them.
   - Otherwise it sets only an alarm that is new or has a new time.
     Android fires no alarm sooner than about 5 seconds after it was
     set, so setting one that is almost due would make it late. The
     tests on the emulator showed this limit.
3. **A small file of ids and times.** `core/notify` writes down which
   alarms it registered and which fired. With it, an alarm that is no
   longer wanted is removed, and the app's handler runs once for one id
   and time. The file holds no title and no text. It is in the app's
   private storage and in no backup.
4. **`setExactAndAllowWhileIdle` with `RTC_WAKEUP`.** The alarm is one
   broadcast to a receiver of the same app, with the id in the intent's
   identifier and no extras.
5. **At most 100 alarms wait at Android**, the soonest ones.
6. **The module's manifest declares the three permissions**:
   `POST_NOTIFICATIONS`, `USE_EXACT_ALARM` and `RECEIVE_BOOT_COMPLETED`.
   Every app that uses `core/notify` gets them. Each app is still
   allowed them one by one: the APK rules check fails an app until the
   owner adds them to its allow list, and
   [permissions.md](../security/permissions.md) lists them for the app.
7. **Two receivers, in the module's manifest, not exported, not
   `directBootAware`.** They reach the app's `Notify` through the app
   class, which implements `NotifyHost`.
8. **After one "no" the app does not ask for the notification
   permission again.** The screen says that reminders will not appear,
   and offers Android's settings page. `core/notify` keeps one flag for
   this: the user was asked.
9. **No library.** Notifications are built with Android's own
   `Notification.Builder`. The minimum is Android 13, so nothing from
   AndroidX is needed.

## Options rejected

- **`core/notify` keeps its own copy of the reminders**, with titles,
  and registers from that. A second copy can differ from the database,
  must be migrated and backed up, and holds user content outside the
  database.
- **The app sets and cancels each alarm itself.** Then every app must
  repeat the work after a reboot, an update and a change of time, and
  each has its own mistakes. With one sync there is one code path, and
  it is tested once.
- **`setAlarmClock`.** It shows an alarm icon in the status bar and
  tells the lock screen the time of the next alarm. That is for an
  alarm clock, not for a reminder to drink water.
- **Each app declares the permissions in its own manifest**, and the
  module declares none. An app can then forget one, and the reminders
  fail without an error: a missing `RECEIVE_BOOT_COMPLETED` only shows
  after a reboot. The first version in this pull request did it this
  way, with a check at the start of the app.
- **Exported receivers.** Android can reach a receiver that is not
  exported. Nothing else has a reason to.
- **Asking again after a "no".** Android shows its question a second
  time and then never again. The app cannot tell which of the two it
  is without a screen in front. A button to the settings works in both
  cases and does not nag.
- **`NotificationCompat` of AndroidX.** A new direct dependency for
  what the platform does itself from Android 13.

## Consequences

- An app implements `AlarmSource`, `AlarmHandler` and `NotifyHost`, and
  calls `Notify.sync()` after each change. The rules for both
  interfaces are in
  [notifications.md](../architecture/notifications.md).
- The handler can run twice for one alarm if the app stops inside it.
  It must give the same result both times.
- A reminder that was missed while the device was off shows late, if
  the app still names it. Each app decides that.
- The first app with reminders needs the owner to allow the three
  permissions in the APK rules check, which is owner-only.
- An app that wants a notification but no reminders would get all three
  permissions and both receivers today. That needs its own decision
  when such an app comes (the Sync app, for example).
- The docs for users explain what happens before the first unlock, in
  Private Space and in a secondary profile
  ([reminders.md](../user/reminders.md)).

## Open

Open: Android Lint. Lint 32.5.1, which comes with the Android Gradle
Plugin 9.5.1, does not know `USE_EXACT_ALARM`. Its check
`MissingPermission` fails the call `setExactAndAllowWhileIdle` unless
the manifest declares `SCHEDULE_EXACT_ALARM`. Warnings are errors, so
`./gradlew check` fails for `core/notify`.

What was tried:

- `USE_EXACT_ALARM` in the module's manifest: lint still fails.
- Catching the `SecurityException` around the call: lint still fails.
- `SCHEDULE_EXACT_ALARM` with `android:maxSdkVersion="32"` next to
  `USE_EXACT_ALARM`: lint passes.

The options, for the owner:

1. **Suppress `MissingPermission` on the one function that sets the
   alarm**, with the reason next to it. Hard rule 9 forbids it unless
   the owner asks. `ManifestTest` proves that the permission is
   declared, and the emulator tests prove on Android 13, 14, 15 and 17
   that Android allows and fires the alarms.
2. **Declare `SCHEDULE_EXACT_ALARM` with `android:maxSdkVersion="32"`.**
   Android reads that entry only up to Android 12L, and the minimum is
   Android 13. So it changes nothing on any device. But every app with
   reminders then lists, in its manifest, the permission that
   [0010](0010-exact-alarms-and-reminder-storage.md) rejected, and a
   tool that reads manifests shows it.

Claude recommends option 1.
