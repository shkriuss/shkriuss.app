# Emulator tests

Tests that need a real Android run on an emulator in GitHub Actions. They
are called instrumented tests. Set up in Phase 1, step 4, session C, with
the tests of the hardware keys in `core/crypto`.

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
| Decision | [ADR 0028](../adr/0028-instrumented-tests-own-runner-and-shell-steps.md), proposed |

## How a module gets instrumented tests

1. Apply the plugin `shkriuss.android.instrumented-test` in the module's
   build file, after `shkriuss.android.unit-test`.
2. Write JUnit 4 tests in `src/androidTest/kotlin/`, in the module's own
   package.
3. List every test class in a JUnit suite named `InstrumentedTests` in
   that package. The runner runs this one class. A test class that is not
   listed does not run.
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

Today only library modules have instrumented tests. A library's test APK
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

Not written yet. The first runs on the emulators are in progress.

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

### Steps for the three devices

For the Pixel 9 Pro, the Pixel Tablet and the Pixel 6a.

These steps cannot be done today. They need an app that holds keys and
has the recovery key screens and the security screen. Step 1.7 builds
those screens, and Water is the first app that holds keys. Catalog holds
none. The steps name what a screen does, not its final title.

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

Part 4, the app lock. Skip it until the app lock exists (step 1.7,
session B):

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

## Open

- Whether the four emulator jobs become required checks
  ([ci.md](ci.md#required-checks)).
- Whether they run on every pull request, as now, or only when `android/`
  or `ci.yml` changes.
- Whether the emulator and the system images should be pinned to a
  revision. Today `sdkmanager` takes the newest, and the job writes the
  revisions into its log (ADR 0028).
- The other first instrumented tests the plan names: `core/notify`, for
  alarms that fire and are registered again after a restart or a time
  change (the Phase 1 gate in the [plan](../plan/PLAN.md), section 16),
  and Compose accessibility checks (plan section 11). Compose's test rule
  for instrumented tests expects the AndroidX runner, so that step
  decides about the runner again (ADR 0028).
