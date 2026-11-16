# Emulator tests

Tests that need a real Android run on an emulator in GitHub Actions. They
are called instrumented tests. Two modules have them: `core/crypto`, for
the hardware keys, and `core/notify`, for alarms and notifications.

Emulator tests run only in GitHub Actions. The cloud environment has no
KVM, so it cannot run an emulator ([cloud-environment.md](cloud-environment.md)).
In a cloud session Claude can only build the test APK, which shows that
the tests compile.

## At a glance

| Part | Choice |
|---|---|
| Where | The job "Emulator" in [`ci.yml`](../../.github/workflows/ci.yml), on every pull request and every push to `main` ([ci.md](ci.md#job-emulator)) |
| Android versions | 13 (API 33, the minimum), 14 (API 34), 15 (API 35) and 17 (API 37, the newest image) |
| System images | AOSP only: `system-images;android-<level>;default;x86_64`. No Google APIs, no Google Play. |
| How the emulator starts | Shell steps with `sdkmanager`, `avdmanager`, `emulator` and `adb`. No action. |
| Test runner | The project's own, `InstrumentedTestRunner` in `core/testing`, on Android's `Instrumentation` and JUnit 4 |
| Test libraries | None added |
| Decision | [ADR 0028](../adr/0028-instrumented-tests-own-runner-and-shell-steps.md) |
| Required checks | Android 13, 14 and 15. Not Android 17, for now ([Decided](#decided)). |

## How a module gets instrumented tests

1. Apply the plugin `shkriuss.android.instrumented-test` in the module's
   build file, after `shkriuss.android.unit-test`.
2. Write JUnit 4 tests in `src/androidTest/kotlin/`, in the module's own
   package.
3. List every test class in a JUnit suite named `InstrumentedTests` in
   that package. The runner runs this one class. A test class that is not
   listed would not run, so `./gradlew check` fails for it and names it
   ([build.md](build.md#instrumented-test-suite-check)). The same goes
   for a test class in `src/sharedTest/`.
4. Reach the emulator through `TestDevice` in `core/testing`:
   - `TestDevice.context`: the context of the test APK.
   - `TestDevice.instrumentation`: to start a screen, or to run something
     on the main thread.
   - `TestDevice.shell("...")`: runs a command as the shell user, as
     `adb shell` would. That is how a test sets the screen lock or
     presses a key.
   - `TestDevice.note("...")`: writes a line that starts with `NOTE` into
     the run's output, for facts that differ between Android versions.
5. A test that needs no emulator, but whose answer could differ on a
   real Android, goes into `src/sharedTest/kotlin/`. It runs on the JVM
   with the unit tests and on the emulator.
6. The job finds the module by its folder `src/androidTest/`. Nothing in
   `ci.yml` changes.

Today only library modules have instrumented tests: `core/crypto` and
`core/notify`. A library's test APK
holds the library and its tests, and is its own app on the emulator. An
app module would need its app APK installed too. The job does not do that
yet.

## What the runner writes

One line when a test starts and one when it ends:

```text
START HardwareKeysTest.aChangedBlobIsRefused
OK    HardwareKeysTest.aChangedBlobIsRefused (0 s)
```

- `OK`: the test passed.
- `FAIL`: the test failed. Its stack trace stands above the line.
- `SKIP`: the test does not apply here, for example a test of the
  Unlocked key on Android 13. The line above says why.
- `NOTE`: something the test wrote down.

The last line is `INSTRUMENTED_TESTS_PASSED` if at least one test ran and
none failed, and `INSTRUMENTED_TESTS_FAILED` otherwise. The job passes
only with the first.

The same lines go to Android's log under the tag `InstrumentedTests`.

## The tests of the hardware keys

`core/crypto` has unit tests on the JVM. No Android Keystore exists
there, so those tests use a software stand-in for the hardware keys. The
class that talks to the real Keystore, `AndroidHardwareKeys`, is tested
only in the tests below. They are item 9 of
"What the tests must cover" in
[crypto-design.md](../security/crypto-design.md#what-the-tests-must-cover).

The test APK is an app of the suite on the emulator, with the app name
`water`. Its hardware keys are in the emulator's Keystore, and its keyset
files are in its own no-backup files folder, exactly where an app's are.

| Test class | What it checks |
|---|---|
| `HardwareKeysTest` | A key that needs no prompt: it exists from when it is made until it is deleted, and the list shows it. It wraps and opens with the layout of kind 5, with a new IV each time. A changed blob, other associated data and another key's blob are "damaged or changed". A key that does not exist is "gone". A key that needs the prompt cannot be made without a screen lock. The security level is read. A new key gets the next number. At start, a key that no keyset file names is deleted. |
| `UnlockedKeyTest` | Android 13 and 14: the app makes no Unlocked key, and the Background key wraps `backup` and `file-key`. From Android 15: the Unlocked key wraps them. It is made and used without a screen lock. While the emulator is locked it is "not usable now" and not gone, and the Background key works. Records are sealed and opened while the emulator is locked; backup and files wait. An app that ran "as on Android 14" moves its keysets under an Unlocked key at its next start. |
| `ScreenLockChangesTest` | The table "When things change": the screen lock is set, changed, removed and set again. After each step every key is there or gone as the table says, and the keys that need no prompt still open their blobs. |
| `SystemPromptTest` | The Lock key and the Recovery guard through Android's own system prompt, answered with the PIN. The recovery key is kept and shown again. A key that needs the prompt still works after the screen lock is changed. One prompt serves one use. Without the prompt nothing is stored. A changed keyset file is "damaged or changed" after the prompt. Associated data given before the prompt is refused. The app lock is turned on, unlocked and turned off. |
| `ScreenLockRemovedTest` | After the screen lock is removed. App lock off: files, records and backup go on, the kept recovery key is lost, and the words make the app a keeper again once a screen lock is set. App lock on: the app lock is reset, the files are closed, and the recovery words open them again. An app that was unlocked at that moment keeps its files without the words. |
| `TinkOnAndroidTest` | Tink finds Android's own provider and no Play services provider. |
| `DesignVectorsTest`, `PublishedVectorsTest`, `RecoveryWordsTest`, `KeysetFilesTest` | The same classes as on the JVM, from `src/sharedTest/`: every vector with Tink's Android code path, the word list loaded from inside an APK, and the keyset files replaced on a real Android file system. |

How the tests reach what an app cannot:

- **The screen lock.** `ScreenLock` runs Android's `locksettings` command
  as the shell user. The lock is a PIN.
- **Locking and unlocking the emulator.** A key press turns the screen
  off. To unlock, the test wakes the screen and types the PIN.
- **The system prompt.** `SystemPrompt` opens an empty screen of the test
  APK, shows Android's `BiometricPrompt` with the step's `CryptoObject`,
  waits until the PIN screen is in front, and types the PIN. The emulator
  has no fingerprint enrolled, so Android asks for the PIN at once.
- **An older Android on a newer emulator.** `AndroidHardwareKeys` takes
  the Android version as a constructor value. The test of the move to
  Android 15 first runs the app with version 34 and then with the real
  one.

### What the tests showed

The tests run on AOSP emulators with Android 13, 14, 15 and 17. A test
that does not apply to a version is skipped.

Android behaves as
[crypto-design.md](../security/crypto-design.md) says, on every version.

| What | Result |
|---|---|
| Making and using each kind of key | Works. The Background key and, from Android 15, the Unlocked key wrap and open. The Lock key and the Recovery guard do so through the prompt. |
| The layout of kind 5 | As the page says: a 12-byte IV that the Keystore picks, new each time, then the ciphertext and a 16-byte tag. For a key that needs the prompt, the IV is read from the cipher after encrypting. |
| "Does this key exist" | `KeyStore.getKey` answers "not found" for a key that was never made, that was deleted, and that Android deleted with the screen lock. Deleting a key that does not exist is not an error. |
| The list of keys | `KeyStore.aliases` shows each key from when it is made until it is gone. |
| Which failure is which | A changed blob, other associated data and another key's blob arrive as "damaged or changed", also after the prompt. A key that does not exist is "gone". The Unlocked key on a locked emulator is "not usable now", and still exists. |
| A key that needs the prompt, with no screen lock | Cannot be made. Android refuses. |
| A key that needs the prompt, with no fingerprint | Can be made. The prompt asks for the PIN. |
| Screen lock set | Nothing changes for the keys that exist. |
| Screen lock changed | Every key stays. A Recovery guard made before the change opens its keyset after it, with the new PIN. |
| Screen lock removed | The Lock key and the Recovery guard are deleted at once. The Background key and the Unlocked key stay and open their blobs. |
| Screen lock set again | The deleted keys do not come back. New ones can be made. |
| The Unlocked key, from Android 15 | Made and used with no screen lock. Refused while the emulator is locked, and usable again after it is unlocked. The Background key works while the emulator is locked. |
| Android 13 and 14 | The app makes no Unlocked key. The Background key wraps `backup` and `file-key`. |
| An update to Android 15 | An app that ran "as on Android 14" moves `backup` and `file-key` under a new Unlocked key at its next start. `record` stays under the Background key. |
| The order of calls for the prompt | Works as the page says: start the cipher, show the prompt, then give the associated data and finish. |
| Without the prompt | The last step fails. Nothing is stored, and the new key is deleted. |
| Associated data before the prompt | Android does not complain at that call. The operation is lost all the same: it fails at its last step, also after a prompt that succeeded. |
| One prompt, one use | A second cipher of the same key is not opened by the first prompt. |
| The app lock | Turned on with one prompt of the new Lock key. The old key that wrapped `file-key` is deleted. After a new start the app is locked: records work, files do not. One prompt unlocks. Turning it off needs no prompt and deletes the Lock key. |
| Screen lock removed, app lock off | Files, records and backup go on. The app no longer keeps the recovery key. With a new screen lock and the words, it keeps it again. |
| Screen lock removed, app lock on | The app lock is reset and the files are closed. Records and backup go on. The recovery words open the files again. |
| Screen lock removed while the app is unlocked | The app stores `file-key` under a key that needs no prompt at once. The files stay open with no words. |
| A key that no keyset file names | Deleted at the app's next start. The keys that files name stay. |
| The security level | `KeyInfo` says software on every emulator. The app shows that as "not protected by hardware". |
| Tink on Android | Every vector passes. Java's vendor name is "The Android Project", Android's own provider `AndroidOpenSSL` is there, and no Play services provider. |
| The word list | Loads from inside the test APK, with the right hash. |
| Keyset files | Written, flushed, renamed and the folder flushed, on Android's own file system. |

No test gets `KeyPermanentlyInvalidatedException`. After the screen
lock is removed, the keys are simply not found.

The emulators start in about half a minute, and the tests take about one
minute. A whole job takes four to five minutes.

#### What the job and the tests work around

Four faults of the runner and the emulator images. None of them is about
the Keystore.

1. **Where the emulator's files are.** On GitHub's runner `avdmanager`
   and `emulator` look in different folders. The job names one folder to
   both, with `ANDROID_AVD_HOME`.
2. **The emulator's program with a window** needs a sound library,
   `libpulse`, which the runner does not have. The job starts only the
   windowless program, with `-no-window`. Even asking the emulator for
   its version starts the other one.
3. **Android 17 crashes when a screen of the tests closes.** Android
   saves a picture of a task for the recent-apps view when the task is
   hidden or closed. On the Android 17 image, saving it aborts Android's
   system process, inside the emulator's graphics driver:
   `mapper.ranchu.so`, "Assertion failed:
   !rcEnc->featureInfo()->hasReadColorBufferDma". Four other graphics
   settings of the emulator do not help: `-gpu lavapipe`,
   `-gpu swangle_indirect`, `-gpu auto` and `-feature -GLDMA`. With
   `-gpu lavapipe` the same crash comes, and with `-feature -GLDMA` the
   emulator itself dies at the same moment. Android 13, 14 and 15 do not
   have this fault.
   - What the tests do about it: `SystemPrompt` opens its one empty
     screen at the first prompt and leaves it open until the run ends.
     It is never closed and never hidden.
   - So the emulator may be locked only before the first prompt.
     `ScreenLock.lockPhone` checks this, and the suite runs
     `UnlockedKeyTest` before the prompt tests.
   - No test is left out or weakened for it. All of them run on
     Android 17.
   - It is a fault of the emulator image, revision 6 of
     `system-images;android-37.0;default;x86_64`, with emulator 37.2.13.
     A later revision may fix it. The tests can stay as they are.
4. **Android 17 asks for the PIN on a number pad**, not in a text
   field. `SystemPrompt` waits for either before it types.

## The tests of `core/notify`

`core/notify` has unit tests on the JVM. There the clock is the test's
own, and Robolectric stands in for Android's alarms
([notifications.md](../architecture/notifications.md#tests)).
The tests below use the real `AlarmManager` and `NotificationManager`,
and the emulator's own clock.

The test APK is set up as an app with reminders is. Its app class,
`DeviceApp`, is a `NotifyHost` and starts `Notify`, with a button
handler. The three permissions and the three receivers come from the
module's manifest.

| Test class | What it checks |
|---|---|
| `PermissionOnAndroidTest` | A newly installed app shows no notifications, and the state is "never asked". After the answer "no" it is "denied". After the permission is granted it is "ready". The app has the three permissions of the module's manifest and no other. `Notify.start` made the channel, with its name, description and importance. |
| `AlarmsOnAndroidTest` | Android allows exact alarms with `USE_EXACT_ALARM`, without asking the user. An alarm set seven seconds ahead fires, not before its time, through the receiver that is not exported, and the app's notification is shown. Two alarms with two ids both fire. An alarm that is no longer wanted does not fire. An alarm whose time has passed fires within seconds. |
| `ButtonsOnAndroidTest` | Android takes a notification with two buttons, and each asks for the phone's unlock. The pending intent of a button reaches the receiver that is not exported, and the app gets the press with the key, the action, the time and the value. |
| `ClockChangesOnAndroidTest` | The time zone is changed: Android tells the receiver, and the app is asked for its alarms again. The clock is set eleven minutes ahead: an alarm that is now due fires, and the app is asked again. |

How the tests reach what an app cannot:

- **The permission.** The test grants `POST_NOTIFICATIONS` through
  Android's `UiAutomation`, as the user's "Allow" would. It never takes
  it back: Android stops an app whose permission is taken away.
- **The clock and the time zone.** An app cannot set them. The test
  asks Android as the shell user. The commands differ between Android
  versions. So the test tries the ones it knows, checks the effect, and
  writes a `NOTE` with the one that worked. Where none works, the test
  is skipped, and the run says `SKIP`. Afterwards the test puts the
  clock and the time zone back.
- **The order.** `PermissionOnAndroidTest` runs first, because it needs
  an app that was never asked. `ClockChangesOnAndroidTest` runs last,
  because it moves the clock.

### What the notify tests showed

The tests run on AOSP emulators with Android 13, 14, 15 and 17. All of
them pass on every version. On Android 17 they get to their end only
because the job waits for Android
([below](#android-17-the-job-waits-for-android)).

Android behaves the same on every version.

| What | Result |
|---|---|
| A newly installed app | Android shows none of its notifications, and the state is "never asked". |
| The permission is granted | Android shows notifications at once. The state is "ready". |
| The permissions of the test APK | Exactly the three of the module's manifest. No library added another. |
| The channel | Made by `Notify.start`, with its name, description and importance. |
| Exact alarms with `USE_EXACT_ALARM` | `AlarmManager.canScheduleExactAlarms` is true. The user is not asked. |
| The receivers, which are not exported | Android reaches both: the alarm's own broadcast, `TIME_SET` and `TIMEZONE_CHANGED`. |
| An alarm fires | The app's handler runs, never before the alarm's time, and the notification is shown with the alarm's time. |
| **How exact an alarm is** | An alarm set 7 seconds ahead reaches the app's handler 2 to 3 milliseconds after its time, on all four versions, while the emulator is awake. |
| **The shortest wait** | Android fires no alarm sooner than 5 seconds after it was set. On Android 13, 14 and 15, an alarm set 3 seconds ahead fires 2.0 seconds after its time, and an alarm whose time has passed fires 5.0 seconds after it was set. This is Android's own limit for every app. |
| **Two alarms that are due together** | They arrive in either order. Two alarms one second apart, both inside the 5 seconds, come together; on Android 13 and 15 the later one can come first. The handler runs once for each. Two alarms two seconds apart, both more than 5 seconds ahead, come in their order. |
| An alarm that is no longer wanted | Does not fire. |
| The clock is set eleven minutes ahead | `cmd alarm set-time` sets it. Android fires the alarm that is now due and sends `TIME_SET`. The app is asked for its alarms once for each. |
| The time zone is changed | `cmd alarm set-timezone` sets it. Android sends `TIMEZONE_CHANGED`, and the app is asked for its alarms again. |

The tests set their alarms seven seconds ahead, so that they measure
the alarm and not the 5 seconds. Because of the 5 seconds, a sync after
a change in the app leaves alone an alarm that already waits at Android
([notifications.md](../architecture/notifications.md#how-alarms-are-kept-right)).

#### Android 17: the job waits for Android

On the Android 17 image, without a wait, the tests of `core/notify` are
stopped after a few tests, with "INSTRUMENTATION_ABORTED: System has
crashed".

- The cause is fault 3 of
  [What the job and the tests work around](#what-the-job-and-the-tests-work-around).
  The tests of `core/crypto` leave their one screen open until their
  run ends. When the run ends the screen closes, and Android's system
  process aborts in `TaskSnapshotPersister`, 0.2 seconds later. Android
  then starts again by itself.
- The job runs the test APKs in the order of their names, and
  `core/notify` comes second.
- Nothing in `core/notify` can prevent it. Its tests are stopped from
  outside.
- The fix is in the job, and the owner asked for it: before each test
  APK after the first, the job waits until Android answers again
  ([ci.md](ci.md#job-emulator), step 8). The wait has a limit, and the
  log says when Android started again.
- No test is left out or changed for it.

What the log says with the wait:

| Android | What the log says | The tests of `core/notify` |
|---|---|---|
| 13, 14, 15 | "Waited 10 seconds before the next test APK. Android did not start again." | All pass. |
| 17 | A warning: "Android 17 started again after the tests of `app.shkriuss.core.crypto.test` ... The job waited 20 seconds until it answered." | All pass. |

- On Android 17, Android answers again within the first 10 seconds
  after the crash. The other 10 seconds are the pause the job adds
  after a restart.
- The wait makes each job about 10 seconds longer, and about 20 on
  Android 17.
- The warning shows on the page of the run, above the jobs. It shows
  on every run for as long as the Android 17 image has this fault. If
  a later image fixes it, the warning stops by itself.

## What an emulator cannot check

The emulator has a software Keystore, no fingerprint and no GrapheneOS.
These points stay unproven until they are checked on a device:

| What | Why the emulator cannot check it |
|---|---|
| StrongBox | An emulator has none. The tests never take the StrongBox path of `AndroidHardwareKeys`, and never the second try without StrongBox. |
| A real fingerprint | The tests answer the prompt with the PIN only. A fingerprint as the answer, and a fingerprint added or removed (the table "When things change"), are not tested. |
| A pattern or a password as the screen lock | The emulator's lock is always a PIN. |
| A restart of the phone | The tests run inside one start of the emulator. |
| App data cleared, app uninstalled | Clearing the data of the test APK ends the test. |
| A real update from Android 14 to 15 | The test runs the app "as on Android 14" on a newer emulator. No real update happens. |
| GrapheneOS, a second user profile, Private Space | The images are plain AOSP with one user. |
| A screen lock reset by a device administrator | The emulator has no device administrator. |
| A Keystore that fails for a moment | A test cannot make the real Keystore fail. What `getKey` and `aliases` answer then stays read from Android's source. The rules for it are tested with the stand-in (`HardwareKeyRulesTest`). |
| A loss of power while a keyset file is replaced | A test cannot cut the power. |
| The time before the first unlock after a restart | No test runs then. |
| The app lock in a real app | Water has it, and has no emulator tests. Its rules are unit tests with Robolectric. What a real phone does with the screen-off broadcast, the recent apps, the system pickers and the prompt's PIN view needs a real phone. |

For `core/notify`, these points stay unproven until they are checked on
a device:

| What | Why the emulator cannot check it |
|---|---|
| A restart, and the time before the first unlock | The tests run inside one start of the emulator. That `BOOT_COMPLETED` reaches the receiver, and that nothing fires before the unlock, is not tested there. The unit tests send the broadcast themselves. |
| An app update | Installing the test APK again ends the test. |
| "Force stop" | It ends the test. |
| A secondary user profile and Private Space | The images are plain AOSP with one user. |
| Deep sleep with the screen off for a long time | The job keeps the emulator awake, and a run takes minutes. |
| A channel the user turned off, Do Not Disturb, an app with restricted battery use | No test changes these settings on the emulator. The state for a channel that is off is tested with Robolectric. |
| The dialog for the notification permission | Water asks for it, but Water has no emulator tests. The test of `core/notify` answers through `UiAutomation`. Robolectric shows no question either. |
| A press of a button on the screen, and the unlock it asks for | `ButtonsOnAndroidTest` sends the button's pending intent, as Android does after the unlock. No test taps the notification shade or unlocks the phone. |
| GrapheneOS | The images are plain AOSP. |

No automatic test covers these points, and no release waits for a check
of them ([ADR 0039](../adr/0039-no-manual-checklist-for-a-release.md)).

## Decided

The owner's decisions:

1. **The runner.** ADR 0028 is accepted: the project's own runner, shell
   steps and AOSP images. A test class that the suite does not list
   fails the build.
2. **Required checks.** "Emulator (Android 13)", "(Android 14)" and
   "(Android 15)" are required checks, turned on in the ruleset.
   "Emulator (Android 17)" is not, while its image crashes Android's
   system process (point 3 of
   [What the job and the tests work around](#what-the-job-and-the-tests-work-around)).
   Whether it becomes required is an open point with no date: the owner
   decides it when asking for it ([ci.md](ci.md#the-emulator-jobs)).
3. **Pinning.** The emulator and the system images are not pinned to a
   revision. `sdkmanager` takes the newest, and the job writes the
   installed revisions into its log. A new revision can fix a fault,
   such as the one of the Android 17 image above, or bring a new one.
4. **Owner-only files.** The runner, the convention plugin and the suite
   check are listed in [CODEOWNERS](../../.github/CODEOWNERS).

## Open

- A restart of the emulator, and clearing the app's data, could be
  tested in a job with two runs of the tests and a step between them.
  Not built.
- `core/notify`: alarms that are registered again after a restart
  ([plan](../plan/PLAN.md), section 16) need the job with two runs
  above. Today the restart is tested with Robolectric. Alarms that
  fire, and a change of the time and the time zone, are tested on the
  emulator.
- The other instrumented tests the plan names: Compose accessibility
  checks (plan section 11). Compose's test rule for instrumented tests
  expects the AndroidX runner, so the work that adds them decides about
  the runner again (ADR 0028).
