# Permissions

Every permission each app declares, and why, and every receiver a module
adds to an app. A pull request that adds a permission updates this page
and has its own decision record ([CLAUDE.md](../../CLAUDE.md)).

## Rules

- Data apps never declare `android.permission.INTERNET`. Only the Sync app
  may (hard rule 4, [ADR 0005](../adr/0005-no-network-permission-in-data-apps.md)).
- No storage permissions. Files come and go only through the system
  pickers.
- Every APK build fails if the app's final manifest declares or requests a
  permission it is not allowed. Each app has an allow list in the APK
  rules check. Only the owner changes it, after the app's ADR and its
  entry on this page. The sentence the owner uses for it is in
  [PROMPTS.md](../development/PROMPTS.md#2-build). Today Water and
  Reminders are allowed the same five: the three of `core/notify` and
  the two of `core/security`. An app that is not on the list may request
  none, and no app may
  declare a permission of its own. The check is described in
  [build.md](../development/build.md#apk-rules-check).

## Apps

### Catalog (`app.shkriuss.catalog`)

No permissions.

Libraries can add permissions to an app without anyone writing them. One
did:

| Permission | Added by | What happens to it |
|---|---|---|
| `app.shkriuss.catalog.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | `androidx.core` | Removed in Catalog's manifest. `androidx.core` uses it only on Android 12 and older, below the minimum. |
| `android.permission.USE_BIOMETRIC` | `core/security` | Removed in Catalog's manifest. Catalog shows the recovery key screens with sample data, holds no keys and never shows the system prompt ([ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md)). |
| `android.permission.HIDE_OVERLAY_WINDOWS` | `core/security` | Removed in Catalog's manifest. Catalog has none of the screens that hide other apps' windows, and no app lock ([ADR 0033](../adr/0033-hide-overlay-windows-for-the-security-screens.md)). Its switch **Protect this page** does the rest of what the screens do, which needs no permission. |

Other components that libraries add, none of them a permission:

- The six screens of `core/security`: removed in Catalog's manifest,
  for the same reason. Catalog draws their content on two pages of its
  own. Catalog has no app lock, so nothing registers the screen-off
  receiver of the app lock either.

- `androidx.startup.InitializationProvider`: not exported. Starts
  libraries when the app starts.
- `androidx.profileinstaller.ProfileInstallReceiver`: exported, but only
  callers with `android.permission.DUMP` can reach it. Normal apps cannot
  get that permission; the system and the developer shell have it. It
  installs the app's start-up profile.
  - Open, for the next change to Catalog: remove it, as Water does
    (owner's decision; [Water](#water-appshkriusswater)).
- The emoji font loader from `androidx.emoji2` is removed, because it would
  ask a system font provider, usually Google Play services, for a font.

Catalog stores no data, so Android backup and device-to-device transfer are
turned off.

### Water (`app.shkriuss.water`)

Five permissions: three from `core/notify`, for its reminders, and two
from `core/security`, for the recovery key screens and the app lock.

| Permission | From | Why |
|---|---|---|
| `android.permission.POST_NOTIFICATIONS` | `core/notify` | To show a reminder. The user allows it or not: Water explains first, then Android asks ([spec.md](../apps/water/spec.md#asking-for-notifications)). |
| `android.permission.USE_EXACT_ALARM` | `core/notify` | To remind at the exact minute ([ADR 0010](../adr/0010-exact-alarms-and-reminder-storage.md)). Granted at install. |
| `android.permission.RECEIVE_BOOT_COMPLETED` | `core/notify` | To set the alarm again after a restart. Granted at install. |
| `android.permission.USE_BIOMETRIC` | `core/security` | To show Android's system prompt: for the recovery key that the phone keeps, and for the app lock ([ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md)). Granted at install. |
| `android.permission.HIDE_OVERLAY_WINDOWS` | `core/security` | To hide other apps' windows while a screen of the recovery key or the lock screen shows ([ADR 0033](../adr/0033-hide-overlay-windows-for-the-security-screens.md)). Granted at install. |

- They are Water's allow list in the APK rules check. The owner asked
  for all five. A build of Water with any other permission fails.
- What they allow and do not allow is under
  [Apps that use core/notify](#apps-that-use-corenotify) and
  [Apps that use core/security](#apps-that-use-coresecurity).
- Water asks the user for one only: `POST_NOTIFICATIONS`. Android grants
  the other four at install.

Water's manifest still removes one permission that a library asks for:

| Permission | Added by | What happens to it |
|---|---|---|
| `app.shkriuss.water.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | `androidx.core` | Removed in Water's manifest, for good, as in Catalog. `androidx.core` uses it only on Android 12 and older. |

Other components that libraries add, none of them a permission:

- The three receivers of `core/notify`, none exported
  ([Receivers](#receivers)): `AlarmReceiver` for Water's one alarm,
  `SystemEventReceiver` for a restart, an update and a new time or time
  zone, and `ButtonReceiver` for **Drank** and **Later** on a reminder.
  `WaterManifestTest` checks that these three are Water's receivers.

- The six screens of `core/security`, none exported
  ([Screens](#screens)). Only Water itself opens them: from "Recovery
  key" and "App lock" in Settings, and from the dialog that shows when
  the recovery key is first needed
  ([spec.md](../apps/water/spec.md#the-recovery-key-when-first-needed)).
  A screen of the module needs both permissions
  ([ADR 0033](../adr/0033-hide-overlay-windows-for-the-security-screens.md),
  point 5), and the APK rules check fails a build of Water without
  them. `WaterManifestTest` checks that Water's screens are its own and
  these six, that none of the six is exported, and that none has an
  intent filter.
- `androidx.room3.MultiInstanceInvalidationService`: added by Room, not
  exported. Room starts it only for a database opened with
  multi-instance invalidation, which Water does not use.
- `androidx.startup.InitializationProvider`: not exported. Starts
  libraries when the app starts. The emoji font loader is removed from
  it, as in Catalog.
- `androidx.profileinstaller.ProfileInstallReceiver`: removed in Water's
  manifest (owner's decision). It is exported to
  callers with `android.permission.DUMP`, the system and the developer
  shell, so that developer tools can install or save the start-up
  profile from outside the app. Water lets no other app reach any part
  of it but its screen. The start-up profile is still installed when the
  app starts, by the profile installer's initializer in
  `androidx.startup`.
- The app lock's screen-off receiver, registered while the app runs,
  not exported ([A receiver registered at runtime](#a-receiver-registered-at-runtime)).
  Water starts its `AppLockWatcher`.
- `WaterManifestTest` fails unless `WaterActivity` is the only exported
  part of Water's merged manifest, so a library that adds another fails
  the tests.

Water stores its data in its own database and backs it up only into the
backup file of the suite, so Android backup and device-to-device transfer
are turned off.

### Reminders (`app.shkriuss.reminders`)

Two permissions, from `core/security`, for the recovery key screens and
the app lock.

| Permission | From | Why |
|---|---|---|
| `android.permission.USE_BIOMETRIC` | `core/security` | To show Android's system prompt: for the recovery key that the phone keeps, and for the app lock ([ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md)). Granted at install. |
| `android.permission.HIDE_OVERLAY_WINDOWS` | `core/security` | To hide other apps' windows while a screen of the recovery key or the lock screen shows ([ADR 0033](../adr/0033-hide-overlay-windows-for-the-security-screens.md)). Granted at install. |

- Reminders' allow list in the APK rules check has five permissions,
  the same as Water's, which its
  [specification](../apps/reminders/spec.md#as-in-water) names: these
  two, and the three of `core/notify`, `POST_NOTIFICATIONS`,
  `USE_EXACT_ALARM` and `RECEIVE_BOOT_COMPLETED`. The owner asked for
  all five. A build of Reminders with any other permission fails.
- Reminders does not use `core/notify` yet, so it does not hold the
  three. They come with the module, for the reminders. Their reasons are
  those of Water, above.
- Reminders asks the user for none of the two. Android grants both at
  install.

Reminders' manifest removes one permission that a library asks for:

| Permission | Added by | What happens to it |
|---|---|---|
| `app.shkriuss.reminders.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | `androidx.core` | Removed in Reminders' manifest, for good, as in Water. `androidx.core` uses it only on Android 12 and older. |

Other components that libraries add, none of them a permission:

- The six screens of `core/security`, none exported
  ([Screens](#screens)). Reminders has no Settings yet, so nothing opens
  them, and the app lock cannot be turned on. A screen of the module
  needs both permissions, and the APK rules check fails a build of
  Reminders without them. `RemindersManifestTest` checks that Reminders'
  screens are its own and these six, that none of the six is exported,
  and that none has an intent filter.
- `androidx.room3.MultiInstanceInvalidationService`: added by Room, not
  exported. Reminders does not use multi-instance invalidation.
- `androidx.startup.InitializationProvider`: not exported. The emoji
  font loader is removed from it, as in Water.
- `androidx.profileinstaller.ProfileInstallReceiver`: removed in
  Reminders' manifest, as in Water.
- The app lock's screen-off receiver, registered while the app runs,
  not exported ([A receiver registered at runtime](#a-receiver-registered-at-runtime)).
  Reminders starts its `AppLockWatcher`.
- No receiver in the manifest. `RemindersManifestTest` checks that there
  is none, and fails unless `RemindersActivity` is the only exported
  part of Reminders' merged manifest.

Reminders stores its data in its own database and backs it up only into
the backup file of the suite, so Android backup and device-to-device
transfer are turned off.

## Apps that use `core/notify`

`core/notify` sets the alarms and shows the notifications of an app with
reminders ([notifications.md](../architecture/notifications.md)). Its
manifest declares three permissions and three receivers. Every app that
uses the module gets them when the app is built. Water uses it.
Calendar, Reminders and Tasks will use it too
([ADR 0010](../adr/0010-exact-alarms-and-reminder-storage.md)).

An app does not get them unnoticed. The APK rules check fails the app
until the owner allows these permissions for it, and this page then
lists them under the app.

### Permissions

| Permission | Who grants it | Why |
|---|---|---|
| `android.permission.POST_NOTIFICATIONS` | The user. Android asks when a screen of the app starts the question. The user can take it back in Android's settings at any time. | To show a reminder as a notification. Without it Android drops every notification of the app. |
| `android.permission.USE_EXACT_ALARM` | Android, at install. The user is not asked and cannot take it away. | To be woken at the exact minute of a reminder, also when the phone sleeps. Without it Android may delay an alarm by minutes or hours. It is meant for calendar and alarm apps ([ADR 0010](../adr/0010-exact-alarms-and-reminder-storage.md)). |
| `android.permission.RECEIVE_BOOT_COMPLETED` | Android, at install. The user is not asked. | To be told that the phone, or the profile the app is in, has started and was unlocked. Android forgets every alarm at a restart, so the app must set them again. |

What they do not allow:

- None of them gives access to the network, to files, to contacts or
  to any other data.
- `USE_EXACT_ALARM` lets an app wake the phone at a time. The module
  uses it only for the alarms the app names from its own reminders.
- The other permission for exact alarms, `SCHEDULE_EXACT_ALARM`, is not
  declared. Android denies it until the user allows it on a special
  page ([ADR 0010](../adr/0010-exact-alarms-and-reminder-storage.md)).

What happens when the user says no to notifications is in
[notifications.md](../architecture/notifications.md#the-permission-and-the-states)
and, for users, in [reminders.md](../user/reminders.md#allow-notifications).

### Receivers

A receiver is a part of an app that Android can start for a broadcast.

| Receiver | Exported | Starts for | What it does |
|---|---|---|---|
| `app.shkriuss.core.notify.AlarmReceiver` | No | The app's own alarm, sent by Android's `AlarmManager` at the alarm's time. It has no intent filter. | It hands the alarm's id to the app, which reads the reminder from its database and shows the notification. Then the alarms are set again. |
| `app.shkriuss.core.notify.SystemEventReceiver` | No | Four broadcasts of Android: `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `TIME_SET` and `TIMEZONE_CHANGED`. | It sets the app's alarms again. It reads nothing from the broadcast. |
| `app.shkriuss.core.notify.ButtonReceiver` | No | A press of a button on a notification of the app, after the phone's unlock: the button's own pending intent, which the app made. It has no intent filter. | It hands the press to the app, which logs a drink or sets a snooze, for example ([ADR 0034](../adr/0034-notification-buttons.md)). |

- No receiver is exported. No other app can start them. Android itself
  can, and so can a pending intent the app made.
- Only Android can send the four broadcasts. They are protected: an
  app that tries is refused.
- The alarm's broadcast carries the alarm's id and nothing else. The id
  is the id of a record or a fixed name, never a title or a text.
- A press carries the notification's key, the button's action, the
  notification's time and the button's fixed value, such as an amount.
  Never a title or a text. Its pending intent is immutable.
- Every button asks Android for the phone's unlock first. A locked
  phone's notification cannot change a record.
- No receiver is `directBootAware`, and the module does not listen for
  `LOCKED_BOOT_COMPLETED`. So nothing of the app runs between a restart
  and the first unlock
  ([ADR 0010](../adr/0010-exact-alarms-and-reminder-storage.md)).
- A receiver ignores every broadcast that is not one of its own.

The unit test `ManifestTest` in `core/notify` fails if the module's
manifest declares another permission, a receiver that is exported, a
receiver that runs before the first unlock, another broadcast, or an
intent filter on the receiver of alarms or of buttons.

## Apps that use `core/security`

`core/security` holds the recovery key screens, the security screen and
the app lock ([security-screens.md](../architecture/security-screens.md)).
Its manifest declares two permissions and six screens. Every app that
uses the module gets them when the app is built. Water and Reminders
have them ([Water](#water-appshkriusswater),
[Reminders](#reminders-appshkriussreminders)). Catalog removes them for
good.

An app does not get the permissions unnoticed. The APK rules check fails
the app until the owner allows them for that app, and this page then
lists them under the app.

An app does not lose them unnoticed either:

1. The unit test `ManifestTest` in `core/security` fails unless the
   module's manifest asks for exactly these two permissions.
2. The APK rules check fails an app whose merged manifest declares a
   screen of `core/security` but does not request both
   ([ADR 0033](../adr/0033-hide-overlay-windows-for-the-security-screens.md);
   [build.md](../development/build.md#the-security-screens-rule)).
3. Without `HIDE_OVERLAY_WINDOWS`, the screens still work. They only no
   longer hide other apps' windows.

### Permissions

| Permission | Who grants it | Why |
|---|---|---|
| `android.permission.USE_BIOMETRIC` | Android, at install. The user is not asked and cannot take it away. | To show Android's own system prompt: a fingerprint, or the phone's PIN, pattern or password. Two keys need it for every use: the Recovery guard of the kept recovery key, and the Lock key of the app lock ([ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md)). |
| `android.permission.HIDE_OVERLAY_WINDOWS` | Android, at install. The user is not asked and cannot take it away. | To hide the windows that other apps draw over other apps, while a screen of `core/security` shows and while the app is locked. A fake screen or a see-through window cannot then sit over the words or the lock screen ([ADR 0033](../adr/0033-hide-overlay-windows-for-the-security-screens.md)). |

What they do not allow:

- Neither gives access to any data. `USE_BIOMETRIC` cannot read a
  fingerprint. The app learns only whether the user answered the prompt.
- `USE_BIOMETRIC` cannot unlock anything by itself. Only the Keystore
  decides, after the user answered.
- `HIDE_OVERLAY_WINDOWS` hides other apps' windows only while the app's
  own screen shows. It cannot see, read or close other apps. Android's
  own windows stay: the status bar, the keyboard, TalkBack,
  notifications and the system prompt.

### Screens

| Screen | Exported | What it does |
|---|---|---|
| `app.shkriuss.core.security.SecurityActivity` | No | The security screen. |
| `app.shkriuss.core.security.CreateRecoveryKeyActivity` | No | Creating a recovery key. |
| `app.shkriuss.core.security.EnterRecoveryKeyActivity` | No | Entering the 24 words. |
| `app.shkriuss.core.security.ShowRecoveryKeyActivity` | No | Showing the kept recovery key again, after the system prompt. |
| `app.shkriuss.core.security.AppLockActivity` | No | The app lock screen. It asks for the system prompt first while the app lock is on. |
| `app.shkriuss.core.security.TurnOnAppLockActivity` | No | Turning the app lock on: the warning, the recovery words, the system prompt. |

- No screen is exported. Only the app itself can open them.
- Every screen that shows or takes the words blocks screenshots, screen
  recording and the recent-apps preview, and keeps autofill and content
  capture away. The app lock screen follows the app's own setting, as
  every screen of the app does.
- Every screen hides other apps' windows, ignores a tap under another
  app's window, and speaks only to accessibility tools
  ([security-screens.md](../architecture/security-screens.md#overlays-and-accessibility-services)).

### A receiver registered at runtime

The app lock listens for Android's broadcast that the screen turned off
([security-screens.md](../architecture/security-screens.md#when-the-app-locks)).

- It is not in the manifest: Android delivers this broadcast only to
  receivers that an app registers while it runs. `AppLockWatcher`
  registers it when the app starts, with `RECEIVER_NOT_EXPORTED`, so no
  other app can send to it.
- It needs no permission. It only drops the app's file keys from
  memory, and locks the app if the app lock is on.
- Android may hold it back while the app waits in the background. A
  late one is ignored. The app does not depend on it.

The app lock adds no permission. Its settings are in a small file in the
app's private storage
([ADR 0032](../adr/0032-app-lock-settings-in-android-preferences.md)).

## Test APKs

A test APK is built from a module's `src/androidTest/` folder. It is
installed only on the emulator in CI
([emulator-tests.md](../development/emulator-tests.md)). It is never part
of an app and never reaches a user, so the APK rules check does not look
at it.

| Test APK | Permission | Why |
|---|---|---|
| `app.shkriuss.core.crypto.test` | `android.permission.USE_BIOMETRIC` | Android's own system prompt needs it. The tests of the Lock key and the Recovery guard show the prompt and answer it with the emulator's PIN. |
| `app.shkriuss.core.notify.test` | `android.permission.POST_NOTIFICATIONS`, `android.permission.USE_EXACT_ALARM`, `android.permission.RECEIVE_BOOT_COMPLETED` | The three permissions of `core/notify`, from the module's own manifest, as an app gets them. The tests set real alarms and show real notifications on the emulator. The test APK also has the module's three receivers. |

No app gets `USE_BIOMETRIC` from the test APK. Apps get it from
`core/security`
([ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md)).
