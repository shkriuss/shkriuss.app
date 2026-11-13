# Emulator tests

Tests that need a real Android run on an emulator in GitHub Actions. They
are called instrumented tests. Set up in Phase 1, step 4, session C, with
the tests of the hardware keys in `core/crypto`. Phase 1, step 6 added
the tests of the alarms in `core/notify`.

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

Step 1.4, session B built `core/crypto` with unit tests on the JVM. No
Android Keystore exists there, so those tests use a software stand-in for
the hardware keys. The class that talks to the real Keystore,
`AndroidHardwareKeys`, first ran in the tests below. They are item 9 of
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

First run on 2026-11-12, in
[pull request 24](https://github.com/shkriuss/shkriuss.app/pull/24), on
AOSP emulators with Android 13, 14, 15 and 17. Each run has 68 tests. A
test that does not apply to a version is skipped: five on Android 13 and
14, one from Android 15.

Android behaved as
[crypto-design.md](../security/crypto-design.md) says, on every version.
Nothing in the design had to change.

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

Not met in any test: `KeyPermanentlyInvalidatedException`. After the
screen lock was removed, the keys were simply not found.

The emulators start in about half a minute, and the tests take about one
minute. A whole job takes four to five minutes.

### What the job and the tests had to learn

Four things did not work at first. None of them is about the Keystore.

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
   settings of the emulator were tried: `-gpu lavapipe`,
   `-gpu swangle_indirect`, `-gpu auto` and `-feature -GLDMA`. The run
   got no further with any of them. With `-gpu lavapipe` the same crash
   came, and with `-feature -GLDMA` the emulator itself died at the
   same moment. Android 13, 14 and 15 do not have this fault.
   - What the tests do about it: `SystemPrompt` opens its one empty
     screen at the first prompt and leaves it open until the run ends.
     It is never closed and never hidden.
   - So the emulator may be locked only before the first prompt.
     `ScreenLock.lockPhone` checks this, and the suite runs
     `UnlockedKeyTest` before the prompt tests.
   - No test was left out or weakened for it. All 68 run on Android 17.
   - It is a fault of the emulator image, revision 6 of
     `system-images;android-37.0;default;x86_64`, with emulator 37.2.13.
     A later revision may fix it. The tests can stay as they are.
4. **Android 17 asks for the PIN on a number pad**, not in a text
   field. `SystemPrompt` waits for either before it types.

## The tests of `core/notify`

Phase 1, step 6 built `core/notify` with unit tests on the JVM. There
the clock is the test's own, and Robolectric stands in for Android's
alarms ([notifications.md](../architecture/notifications.md#tests)).
The tests below use the real `AlarmManager` and `NotificationManager`,
and the emulator's own clock.

The test APK is set up as an app with reminders is. Its app class,
`DeviceApp`, is a `NotifyHost` and starts `Notify`. The three
permissions and the two receivers come from the module's manifest.

| Test class | What it checks |
|---|---|
| `PermissionOnAndroidTest` | A newly installed app shows no notifications, and the state is "never asked". After the answer "no" it is "denied". After the permission is granted it is "ready". The app has the three permissions of the module's manifest and no other. `Notify.start` made the channel, with its name, description and importance. |
| `AlarmsOnAndroidTest` | Android allows exact alarms with `USE_EXACT_ALARM`, without asking the user. An alarm set seven seconds ahead fires, not before its time, through the receiver that is not exported, and the app's notification is shown. Two alarms with two ids both fire. An alarm that is no longer wanted does not fire. An alarm whose time has passed fires within seconds. |
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

First runs on 2026-11-12 and 2026-11-13, in
[pull request 26](https://github.com/shkriuss/shkriuss.app/pull/26), on
AOSP emulators with Android 13, 14, 15 and 17. Each run has 10 tests,
and all of them pass on every version. On Android 17 the first runs did
not get to their end, until the job waited for Android
([below](#android-17-the-job-waits-for-android)).

Android behaved the same on every version. The numbers of the first
runs are from Android 13, 14 and 15.

| What | Result |
|---|---|
| A newly installed app | Android shows none of its notifications, and the state is "never asked". |
| The permission is granted | Android shows notifications at once. The state is "ready". |
| The permissions of the test APK | Exactly the three of the module's manifest. No library added another. |
| The channel | Made by `Notify.start`, with its name, description and importance. |
| Exact alarms with `USE_EXACT_ALARM` | `AlarmManager.canScheduleExactAlarms` is true. The user is not asked. |
| The receivers, which are not exported | Android reaches both: the alarm's own broadcast, `TIME_SET` and `TIMEZONE_CHANGED`. |
| An alarm fires | The app's handler runs, never before the alarm's time, and the notification is shown with the alarm's time. |
| **How exact an alarm is** | An alarm set 7 seconds ahead reached the app's handler 2 to 3 milliseconds after its time, on all four versions. The emulator was awake. |
| **The shortest wait** | Android fires no alarm sooner than 5 seconds after it was set. In the first runs an alarm set 3 seconds ahead fired 2.0 seconds after its time, on all three versions. An alarm whose time had passed fired 5.0 seconds after it was set. This is Android's own limit for every app. |
| **Two alarms that are due together** | They arrive in either order. In the first runs two alarms one second apart, both inside the 5 seconds, came together, on Android 13 and 15 the later one first. The handler ran once for each. Two alarms two seconds apart, both more than 5 seconds ahead, came in their order. |
| An alarm that is no longer wanted | Does not fire. |
| The clock is set eleven minutes ahead | `cmd alarm set-time` sets it. Android fires the alarm that is now due and sends `TIME_SET`. The app is asked for its alarms once for each. |
| The time zone is changed | `cmd alarm set-timezone` sets it. Android sends `TIMEZONE_CHANGED`, and the app is asked for its alarms again. |

After the first runs the tests set their alarms seven seconds ahead,
so that they measure the alarm and not the 5 seconds. What this showed
changed the code: a sync after a change in the app no longer sets an
alarm again that already waits at Android
([notifications.md](../architecture/notifications.md#how-alarms-are-kept-right)).

#### Android 17: the job waits for Android

On the Android 17 image the first runs of `core/notify` were stopped
after a few tests, with "INSTRUMENTATION_ABORTED: System has crashed".

- The cause is fault 3 of
  [What the job and the tests had to learn](#what-the-job-and-the-tests-had-to-learn).
  The tests of `core/crypto` leave their one screen open until their
  run ends. When the run ends the screen closes, and Android's system
  process aborts in `TaskSnapshotPersister`, 0.2 seconds later. Android
  then starts again by itself.
- Until then no test APK ran after `core/crypto`, so nobody saw it. The
  job runs the test APKs in the order of their names, and
  `core/notify` comes second.
- Nothing in `core/notify` can prevent it. Its tests were stopped from
  outside.
- The fix is in the job, and the owner asked for it: before each test
  APK after the first, the job waits until Android answers again
  ([ci.md](ci.md#job-emulator), step 8). The wait has a limit, and the
  log says when Android started again.
- No test was left out or changed for it.

What the first run with the wait showed, on 2026-11-13:

| Android | What the log said | The tests of `core/notify` |
|---|---|---|
| 13, 14, 15 | "Waited 10 seconds before the next test APK. Android did not start again." | All 10 pass, as before. |
| 17 | A warning: "Android 17 started again after the tests of `app.shkriuss.core.crypto.test` ... The job waited 20 seconds until it answered." | All 10 pass. |

- On Android 17, Android answered again within the first 10 seconds
  after the crash. The other 10 seconds are the pause the job adds
  after a restart.
- The wait makes each job about 10 seconds longer, and about 20 on
  Android 17.
- The warning shows on the page of the run, above the jobs. It will
  show on every run for as long as the Android 17 image has this
  fault. If a later image fixes it, the warning stops by itself.

## What an emulator cannot check

The emulator has a software Keystore, no fingerprint and no GrapheneOS.
These points stay unproven until they are checked on a device:

| What | Why the emulator cannot check it |
|---|---|
| StrongBox | An emulator has none. The tests never take the StrongBox path of `AndroidHardwareKeys`, and never the second try without StrongBox. |
| A real fingerprint | The prompt was answered with the PIN only. A fingerprint as the answer, and a fingerprint added or removed (the table "When things change"), were not tested. |
| A pattern or a password as the screen lock | The emulator's lock was always a PIN. |
| A restart of the phone | The tests run inside one start of the emulator. |
| App data cleared, app uninstalled | Clearing the data of the test APK ends the test. |
| A real update from Android 14 to 15 | The test runs the app "as on Android 14" on a newer emulator. No real update happens. |
| GrapheneOS, a second user profile, Private Space | The images are plain AOSP with one user. |
| A screen lock reset by a device administrator | The emulator has no device administrator. |
| A Keystore that fails for a moment | A test cannot make the real Keystore fail. What `getKey` and `aliases` answer then stays read from Android's source. The rules for it are tested with the stand-in (`HardwareKeyRulesTest`). |
| A loss of power while a keyset file is replaced | A test cannot cut the power. |
| The time before the first unlock after a restart | No test runs then. |
| The app lock in a real app | No app uses it yet. Its rules are unit tests with Robolectric; what a real phone does with the screen-off broadcast, the recent apps, the system pickers and the prompt's PIN view is checked in [the app lock steps](#steps-for-the-three-devices-the-app-lock). |

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
| The dialog for the notification permission | No screen asks yet. The test answers through `UiAutomation`. |
| GrapheneOS | The images are plain AOSP. |

### Steps for the three devices

For the Pixel 9 Pro, the Pixel Tablet and the Pixel 6a.

These steps cannot be done today. They need an app that holds keys and
has the recovery key screens and the security screen. Step 1.7 built
those screens in `core/security`
([security-screens.md](../architecture/security-screens.md)). Water is
the first app that holds keys and uses them. Catalog holds none: it shows
the screens with sample data only. The steps name what a screen does,
not its final title.

Before you start:

- Use the preview build of a pull request
  ([test-a-pull-request.md](test-a-pull-request.md)). Let the app make a
  new recovery key for this check. Never type your real recovery words
  into a preview build.
- Write the 24 test words on paper. Steps 16 and 19 need them.
- Do every part on each of the three devices, except part 8.
- Tell Claude in a session what did not match. Claude records the result
  in this page and in the assumptions of
  [crypto-design.md](../security/crypto-design.md#assumptions).

Part 1, StrongBox:

1. In the phone's Settings, set a PIN as the screen lock and add one
   fingerprint.
2. Open the app. Create a recovery key, write the words down and confirm
   the four words it asks for.
3. The system prompt appears, to keep the recovery key. Answer it with
   the fingerprint.
4. Open the app's security screen. Check: every key shows StrongBox, and
   the app says it keeps the recovery key.

Part 2, a real fingerprint:

5. Ask the app to show the recovery key again. The system prompt
   appears. Touch the sensor with the enrolled finger. Check: the words
   are the ones on your paper.
6. Ask again. This time choose the PIN in the prompt and type it. Check:
   the same words.
7. Ask again. Touch the sensor with a finger that is not enrolled, then
   close the prompt. Check: no words are shown, and the app works as
   before.

Part 3, a fingerprint added or removed:

8. In Settings, add a second fingerprint. In the app, show the recovery
   key with the new finger. Check: the same words. The security screen
   shows the same keys as in step 4.
9. In Settings, remove every fingerprint. In the app, show the recovery
   key. Check: the prompt asks for the PIN, and the words are shown.
10. Add one fingerprint again for the next parts.

Part 4, the app lock. Step 1.7, session B built it in `core/security`.
It needs an app that uses it, Water from step 2.5. The longer steps are
in [Steps for the three devices: the app lock](#steps-for-the-three-devices-the-app-lock):

11. Turn the app lock on. Check: it asks for four of the words and shows
    two system prompts.
12. Close the app and open it again. Check: the system prompt appears,
    the fingerprint opens the app, and a file opens if the app has files.

Part 5, a restart:

13. Restart the phone and unlock it. Open the app. Check: it does not
    ask to be set up again, the security screen shows the same keys as
    in step 4, and showing the recovery key works after the prompt.

Part 6, the screen lock changed:

14. In Settings, change the PIN to a password or a pattern. Open the
    app and show the recovery key. Check: the prompt takes the new
    password or pattern, and the words are the same.

Part 7, the screen lock removed. Do this part last, because it deletes
keys:

15. In Settings, set the screen lock to "None". Open the app. Check: it
    says the recovery key is no longer kept on this phone. If the app
    lock was on, it says the app lock was reset. Records are still
    there.
16. If the app lock was on: enter the 24 words. Check: the files open
    again.
17. In Settings, set a PIN again. Enter the 24 words in the app and
    answer the prompt. Check: the app keeps the recovery key again, and
    the security screen shows StrongBox for every key.
18. In Settings, open the app's page, then storage, and clear the
    storage. Open the app. Check: it starts as a new app, with no keys.
19. Enter the 24 words. Check: the security screen shows the keys again.

Part 8, another profile, on the Pixel 9 Pro only:

20. Install the app in a second user profile, or in Private Space. Give
    that profile its own PIN.
21. Do steps 2 to 6 there. Check: the same results. The main profile's
    app is not changed.

When you are done, uninstall the preview on all three devices.

Not on this list, because no step on a phone can show them: the real
update from Android 14 to 15 (your devices are past it), a screen lock
reset by a device administrator, a Keystore that fails for a moment, a
loss of power, and the time before the first unlock.

### Steps for the three devices: reminders

For the Pixel 9 Pro. Parts 1 and 2 also on the Pixel Tablet and the
Pixel 6a.

These steps cannot be done today. They need an app with reminders.
Water is the first (Phase 2, step 4). The steps name what a screen
does, not its final title. Step 10 of part 1 of the
[release checklist](release-checklist.md) will point here.

Before you start: use the preview build of a pull request
([test-a-pull-request.md](test-a-pull-request.md)), and allow its
notifications.

Part 1, on time with the screen off:

1. Set a reminder for a time 30 minutes from now.
2. Turn the screen off, unplug the phone and leave it alone.
3. Check: the reminder comes in the minute it was set for.

Part 2, a restart and the first unlock:

4. Set one reminder for 5 minutes from now and one for 30 minutes from
   now.
5. Restart the phone. Do not unlock it. Wait until the first time has
   passed.
6. Check: nothing showed on the lock screen and nothing made a sound.
7. Unlock the phone. Do not open the app.
8. Check: the first reminder shows now, late. The second one comes at
   its time.

Part 3, an app update:

9. Set a reminder for 15 minutes from now.
10. Install a newer preview build over the app. Do not open it.
11. Check: the reminder comes at its time.

Part 4, a new time zone:

12. Set a reminder that repeats every day at a time one hour from now.
13. In Settings, search for **Time zone**. Turn off the automatic time
    zone and choose a zone that is one hour ahead.
14. Check: the reminder comes within a minute, because its time on the
    wall clock is now. Choose a zone that is one hour behind your own.
    Check tomorrow: it comes at its time on the wall clock of that zone.
15. Turn the automatic time zone on again.

Part 5, a secondary user profile:

16. Install the app in a secondary user, as in step 8 of part 1 of the
    release checklist. In that user, allow notifications and set a
    reminder for 10 minutes from now.
17. Switch back to the Owner without ending the session.
18. Check: with **Send notifications to current user** off, nothing
    shows in the Owner. After a switch to the secondary user, the
    reminder is there, with its time.
19. Turn **Send notifications to current user** on in the secondary
    user. Set another reminder and switch to the Owner. Check: the
    reminder shows in the Owner at its time.
20. Set a reminder for 10 minutes from now, then end the session of
    the secondary user. Check: nothing shows. Switch to the secondary
    user after the time has passed and unlock it. Check: the reminder
    shows now, late.

Part 6, Private Space:

21. Install the app in the Private Space, as in step 9 of part 1 of the
    release checklist. Allow notifications and set a reminder for 10
    minutes from now.
22. Lock the Private Space. Wait until the time has passed.
23. Check: nothing showed.
24. Unlock the Private Space. Do not open the app.
25. Check: the reminder shows now, late.

Part 7, "Force stop" and notifications turned off:

26. Set a reminder for 10 minutes from now. On **App info**, tap
    **Force stop**. Check: the reminder does not come. Open the app.
    Check: it shows now, late.
27. On **App info**, tap **Notifications** and turn the switch off.
    Open the app. Check: it says that reminders will not appear, and
    its button opens that same page.

Tell Claude in a session what did not match. Claude records the result
in this page, in [notifications.md](../architecture/notifications.md)
and in the user page [reminders.md](../user/reminders.md).

### Steps for the three devices: the app lock

For the Pixel 9 Pro, the Pixel Tablet and the Pixel 6a. They need an app
that uses the app lock of `core/security`
([security-screens.md](../architecture/security-screens.md#the-app-lock)),
Water from step 2.5. Use its preview build and a new recovery key for
testing, never your real words. The unit tests cover the rules with
Robolectric; these steps check what only a real phone shows.

Before you start: the app has a recovery key, the phone has a PIN and a
fingerprint, and the app has one reminder and, if it can, one file.

Turning it on:

1. In the app's security screen, check that it keeps the recovery key.
   Open the app lock screen and turn the app lock on. Check: the plain
   warning, one prompt, four words, then a second prompt. Type one wrong
   word first. Check: the app says that a word does not match and shows
   no words. Then, while the four fields show, switch to another app and
   back. Check: the prompt asks again, and then four words show. Turn
   the phone while the four fields show. Check: no new prompt, and the
   words you typed stay.
2. Turn the app lock off. In a second test app, or after clearing the
   app's data and entering the words with **Not now** at the prompt,
   turn it on in an app that does not keep the key. Check: it asks for
   all 24 words on the screen of "Enter your recovery key", then one
   prompt. Check on the security screen: the key is still not kept.

When it locks:

3. Choose **When it leaves the screen**. Switch to another app, then
   back. Check: the lock screen comes first. No content of the app shows
   for a moment, neither in the recent apps nor on the way back.
4. Choose **5 minutes**. With the app on the screen, turn the screen off,
   wait 10 seconds, turn it on and unlock the phone. Check: the lock
   screen, and no content first.
5. Still **5 minutes**. Switch to another app. Turn the screen off for 10
   seconds, turn it on, unlock the phone, and go back to the app. Check:
   the app shows either its content or the lock screen, but never its
   content first and the lock screen after. The preview in the recent
   apps is blank. Write down which one it showed: Android 14 and later
   may hold the screen-off broadcast back, so the content is allowed
   here, as the user guide says.
6. Still **5 minutes**. Switch to another app for more than 5 minutes,
   then go back. Check: the lock screen comes first.
7. With **When it leaves the screen**, open the prompt and answer it with
   the PIN instead of the fingerprint. Check: the app opens and does not
   lock again right away.

Pickers and sharing:

8. In the app, start to add a file, so that Android's file picker opens.
   Pick a file. Check: the lock screen comes first; after the prompt,
   the file is added.
9. Open the file picker again. In the recent apps, swipe the app away
   or use **Force stop** while the picker is open, then pick a file.
   Check: the app starts locked, and after the prompt the screen is
   there. Write down whether the file arrived.
10. Share something from the app, if it can. Check: after the share
    sheet, the lock screen comes first.

The app lock screen and the windows:

11. Open the app lock screen while the app is unlocked. Check: the
    prompt opens before anything shows. Close it. Check: the screen
    closes.
12. Turn on **Hide in recent apps and block screenshots**. Try a
    screenshot on a screen of the app. Check: Android refuses it, and
    the recent apps show the app blank.

Notifications:

13. With the app lock off, let the reminder show. Then turn the app lock
    on. Check: the reminder in the shade changes to the name of its kind
    and "The app lock hides this notification", with no new sound.
14. Let the reminder show again. Check: the hidden form. Turn on **Show
    the text in notifications**, let it show again. Check: its text.

Tell Claude in a session what did not match. Claude records the result
in this page, in [security-screens.md](../architecture/security-screens.md)
and in the user page [app-lock.md](../user/app-lock.md).

## Decided

The owner's decisions on
[pull request 24](https://github.com/shkriuss/shkriuss.app/pull/24):

1. **The runner.** ADR 0028 is accepted: the project's own runner, shell
   steps and AOSP images. A test class that the suite does not list
   fails the build.
2. **Required checks.** Decided at the Phase 1 gate, on 2026-11-13.
   "Emulator (Android 13)", "(Android 14)" and "(Android 15)" become
   required checks. "Emulator (Android 17)" does not, while its image
   crashes Android's system process (point 3 of
   [What the tests showed](#what-the-tests-showed)). The owner turned
   the three on in the ruleset on 2026-11-13, and decides again at the
   Phase 2 gate ([ci.md](ci.md#the-emulator-jobs)).
3. **Pinning.** The emulator and the system images are not pinned to a
   revision. `sdkmanager` takes the newest, and the job writes the
   installed revisions into its log. A new revision can fix a fault,
   such as the one of the Android 17 image above, or bring a new one.
4. **Owner-only files.** The runner, the convention plugin and the suite
   check are listed in [CODEOWNERS](../../.github/CODEOWNERS).

## Open

- A restart of the emulator, and clearing the app's data, could be
  tested in a job with two runs of the tests and a step between them.
  Not built. Today both are steps for the three devices.
- `core/notify`: alarms that are registered again after a restart (the
  Phase 1 gate in the [plan](../plan/PLAN.md), section 16) need the
  job with two runs above. Today the restart is tested with Robolectric
  and is a step for the three devices. Alarms that fire, and a change of
  the time and the time zone, are tested on the emulator.
- The other first instrumented tests the plan names: Compose
  accessibility checks (plan section 11). Compose's test rule for
  instrumented tests expects the AndroidX runner, so that step decides
  about the runner again (ADR 0028).
