# 0028 Instrumented tests: own runner, emulator started by shell steps

- Status: Accepted
- Date: 2026-11-12
- Source: the owner's prompt for Phase 1, step 4, session C
  ([PROMPTS.md](../development/PROMPTS.md)), which asked for the emulator
  job and the tests of the hardware keys. Claude proposed points 1 and 2
  inside that prompt. The owner accepted them on
  [pull request 24](https://github.com/shkriuss/shkriuss.app/pull/24),
  and added point 7 there. The owner also decided there that the
  emulator and the system images are not pinned (point 4).

## Context

- The tests of the hardware keys need a real Android Keystore, so they
  run on an emulator
  ([emulator-tests.md](../development/emulator-tests.md)).
- The plan for the emulator job named two things first: the test
  libraries `androidx.test:runner` and `androidx.test.ext:junit`, and the
  Android Gradle Plugin's Gradle Managed Devices.
- Hard rule 5 in [CLAUDE.md](../../CLAUDE.md): a new dependency needs a
  record and new verification metadata.
  `android/gradle/verification-metadata.xml` is an owner-only file. The
  owner's prompt allows a change to `ci.yml` and to no other owner-only
  file.
- What was found in session C:
  - `androidx.test:runner` is not in the verification metadata. Adding
    it changes the owner-only file.
  - Gradle Managed Devices, and also `connectedAndroidTest`, make the
    Android Gradle Plugin 9.5.1 download four more artifacts when the
    tests run: `com.android.tools.androidtest:android-test-engine`,
    `android-test-engine-result-listener`,
    `org.junit.platform:junit-platform-engine` and
    `junit-platform-launcher`. Read in the plugin's class
    `AndroidTestEngineConfigurerKt`. None is in the verification
    metadata. They would also have to be written into it on a machine
    that can start an emulator, and the cloud environment cannot.
  - JUnit 4.13.2 is already in the version catalog and in the
    verification metadata, for the unit tests.
  - Android itself has what the tests need from a runner: the class
    `android.app.Instrumentation` starts code inside a test APK, and its
    `UiAutomation` runs commands as the shell user.
- The tests must set and remove the emulator's screen lock, lock and
  unlock the emulator, and type the PIN into the system prompt. All of
  that is possible as the shell user.

## Decision

1. Instrumented tests are JUnit 4 tests, run by a runner of our own:
   `InstrumentedTestRunner` in `core/testing`. It is one class on top of
   `android.app.Instrumentation` and JUnit's `JUnitCore`. No test library
   is added.
   - It runs one class: the JUnit suite `InstrumentedTests` in the
     module's package. A test class that the suite does not list would
     not run. Point 7 makes the build fail for such a class.
   - It writes one line per test and the stack trace of each failure.
     Its last line is `INSTRUMENTED_TESTS_PASSED` only if at least one
     test ran and none failed.
   - Tests reach the emulator through `TestDevice` in `core/testing`: the
     instrumentation, the context, and commands as the shell user.
2. The emulator is started by shell steps in the job "Emulator" of
   `ci.yml`, with the SDK's own tools: `sdkmanager`, `avdmanager`,
   `emulator` and `adb`. Gradle only builds the test APK
   (`assembleDebugAndroidTest`). The job installs the APK and runs it with
   `am instrument`. This is point 5 of the plan in emulator-tests.md.
3. Only AOSP system images are used: the package
   `system-images;android-<level>;default;x86_64`. The job refuses any
   other image name (hard rule 3).
4. The emulator, `platform-tools` and the system images are SDK packages
   from Google's SDK repository, installed with `sdkmanager`, like the
   SDK platform and the build tools that "Check" installs. They are test
   tools. Nothing of them goes into an APK. They are not pinned to a
   revision: `sdkmanager` takes the newest, and the job writes the
   installed revisions into its log.
5. A new convention plugin, `shkriuss.android.instrumented-test`, sets
   the runner, adds JUnit and `core/testing` to a module's instrumented
   tests, and adds the folder `src/sharedTest/` to both the unit tests
   and the instrumented tests. A test there runs on the JVM and on the
   emulator.
6. The test APK of `core/crypto` declares
   `android.permission.USE_BIOMETRIC`, which Android's system prompt
   needs. The APK is installed only on the emulator in CI. No app gets
   the permission from this record
   ([permissions.md](../security/permissions.md)).
7. A test class that the suite does not list fails the build. The task
   `checkInstrumentedTestSuite` compares the classes with `@Test` in a
   module's `src/androidTest/` and `src/sharedTest/` with the classes the
   suite lists. It runs in `check`
   ([build.md](../development/build.md#instrumented-test-suite-check)).
8. The runner, the convention plugin and the check are owner-only files
   ([CODEOWNERS](../../.github/CODEOWNERS)). A change to one of them
   could stop tests from running without a red check.

## Options rejected

- **`androidx.test:runner` and `androidx.test.ext:junit`.** The usual
  choice, and what the plan named. It needs a change to the owner-only
  verification metadata, which the prompt of session C does not allow
  without asking. The tests of the hardware keys use nothing of it that
  Android and JUnit do not already give. It stays open for a later step
  (see Consequences).
- **Gradle Managed Devices.** Needs the four artifacts above in the
  owner-only verification metadata. Its tasks start the emulator
  themselves, so the metadata for them cannot be written in the cloud
  environment.
- **Android's old runner, `android.test.InstrumentationTestRunner`.**
  Part of Android, but deprecated since Android 7, and it runs JUnit 3
  tests only.
- **`reactivecircus/android-emulator-runner`,** the usual action to
  start an emulator. Not one of GitHub's own actions
  (`.claude/rules/workflows.md`).
- **Google APIs or Google Play system images.** They contain Google Play
  services (hard rule 3).
- **The smaller "ATD" test images (`aosp_atd`).** They exist for every
  level used here. They leave out parts of the system to start faster.
  The tests need the lock screen and the system prompt, which are system
  parts. Whether the ATD images keep them was not tried.

## Consequences

- No dependency, no version catalog entry and no verification metadata
  changed for the emulator tests.
- The project owns under 200 lines of test runner, in two files. They
  are test code only, and never part of an app.
- The runner gives no test report file, only text. The job shows that
  text and keeps Android's log and a picture of the screen when a test
  fails.
- A test class must be listed in its module's `InstrumentedTests` suite.
  Forgetting that fails `check`, which names the class.
- The emulator and the system images are not pinned to a version or a
  checksum of our own. `sdkmanager` takes the newest revision and checks
  the download against Google's own list. So a new revision can change
  what a run does, and the log of a run says which revisions it used.
- The owner decided at the Phase 1 gate, on 2026-11-13: the jobs for
  Android 13, 14 and 15 become required checks, and the job for Android
  17 does not, while its image crashes Android's system process. The
  owner decides again at the Phase 2 gate. See
  [ci.md](../development/ci.md#the-emulator-jobs).
- Compose's test rule for instrumented tests
  (`androidx.compose.ui:ui-test-junit4`) expects the AndroidX runner. The
  plan puts Compose accessibility checks into emulator tests (section 11
  of the [plan](../plan/PLAN.md)). The step that adds them decides again
  between this runner and `androidx.test:runner`, with the owner's leave
  for the verification metadata. Switching is small: the runner's name
  in the convention plugin, the dependency, and one annotation per test
  class.
- It works: the first runs passed on Android 13, 14, 15 and 17, in four
  to five minutes for each version
  ([emulator-tests.md](../development/emulator-tests.md#what-the-tests-showed)).
- [emulator-tests.md](../development/emulator-tests.md) and
  [ci.md](../development/ci.md) describe the job.
