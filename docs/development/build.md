# Build

How the Gradle project in `android/` is set up, and why. Builds run in
GitHub Actions and in the Claude Code cloud environment. There is no local
build. Set up in Phase 0, step 3.

## At a glance

| Part | Version | Where it is set |
|---|---|---|
| Gradle | 9.6.1 | `android/gradle/wrapper/gradle-wrapper.properties` |
| JDK | 21 | `android/gradle/gradle-daemon-jvm.properties` |
| Android Gradle Plugin (AGP) | 9.5.1 | `android/gradle/libs.versions.toml` |
| Kotlin | 2.4.21 | `android/gradle/libs.versions.toml` |
| Compose BOM | 2026.09.00 | `android/gradle/libs.versions.toml` |
| Room | 3.0.3 | `android/gradle/libs.versions.toml` |
| KSP (runs Room's compiler) | 2.3.13 | `android/gradle/libs.versions.toml` |
| Tink (`tink-android`) | 1.24.0 | `android/gradle/libs.versions.toml` |
| Min SDK | 33 (Android 13) | `build-logic`, `ShkBuild.kt` |
| Compile and target SDK | 37 (Android 17), platform `android-37.0` | `build-logic`, `ShkBuild.kt` |
| SDK build tools | 36.0.0 | `build-logic`, `ShkBuild.kt` |

Every other library version is in `android/gradle/libs.versions.toml`.
Nothing outside section 3 of the [plan](../plan/PLAN.md) is used.

## Layout

- `android/settings.gradle.kts`: the modules and the repositories.
- `android/gradle.properties`: Gradle settings.
- `android/gradle/`: the wrapper, the version catalog, the JDK version, and
  dependency verification.
- `android/build-logic/`: the convention plugins, and the R8 rules every
  app shares (`r8/app-rules.pro`). All module build config lives here. A
  module's own build file only names its plugins, its namespace, its app ID
  and version, and its dependencies.
- `android/core/design/`: the design system. See
  [design-system.md](design-system.md).
- `android/core/data/`: the base for every app database, and the
  committed schemas of its example database in `schemas/`. See
  [architecture/data.md](../architecture/data.md).
- `android/core/crypto/`: all cryptography, with Tink. See
  [crypto-design.md](../security/crypto-design.md). The recovery word
  list and its licence are in its resources
  ([third-party.md](third-party.md)). Its test fixtures, in
  `src/testFixtures/`, give the tests of other modules real keys
  ([Test fixtures](#test-fixtures)).
- `android/core/backup/`: the backup file of an app: writing, checking
  and restoring it. See
  [backup-format.md](../architecture/backup-format.md).
- `android/core/security/`: the recovery key screens and the security
  screen that every app uses. See
  [security-screens.md](../architecture/security-screens.md).
- `android/core/testing/`: test helpers that other modules use in their
  tests only.
- `android/app/catalog/`: the Catalog app, `app.shkriuss.catalog`, the
  design gallery.

How the modules depend on each other is in
[architecture/modules.md](../architecture/modules.md).

Owner-only ([CODEOWNERS](../../.github/CODEOWNERS)):

- the wrapper, and the verification metadata and keyring,
- both `settings.gradle.kts` files, which hold the repositories,
- the two build checks, `CheckApkRulesTask.kt` and
  `CheckGraphicsPathUseTask.kt`, and the two readers the APK rules check
  uses, `ApkResourceReader.kt` and `DexMethodReferences.kt`,
- `AndroidApplicationConventionPlugin.kt`, which connects both checks to
  the build and runs the tests of the build checks in `check`,
- `r8/app-rules.pro`, the R8 rules every app shares, which the APK rules
  check depends on (owner's decision on pull request 25),
- the two checks of the record rules, `CheckRoomSchemasTask.kt` and
  `CheckDaoRulesTask.kt`, and `AndroidRoomConventionPlugin.kt`, which
  connects them to the build (owner's decision on pull request 21),
- `AndroidCommon.kt`, the settings every module shares, which refuse the
  bundled SQLite driver (owner's decision on pull request 21), register
  the logging check and refuse `core/testing` outside tests,
- the logging check, `CheckNoLoggingTask.kt`, the tests of the build
  checks in `build-logic/src/test/`, and `build-logic/build.gradle.kts`,
  which sets those tests up (owner's decisions in step 1.9).

## Commands

Claude runs these from `android/`. The same list is in
[CLAUDE.md](../../CLAUDE.md).

| Command | What it does |
|---|---|
| `./gradlew check` | Unit tests, Android Lint, and the schema, DAO rules, instrumented test suite and logging checks, for all modules. Also the tests of the build checks. |
| `./gradlew :app:<name>:assembleDebug` | Builds one app. |
| `./gradlew verifyRoborazziDebug` | Compares screenshots with the committed ones. |
| `./gradlew recordRoborazziDebug` | Records screenshots again after an intended UI change. |
| `./gradlew recordRoomSchemas` | Writes the database schema files after a schema change, to commit them. |
| `./gradlew checkRoomSchemas` | Checks that the committed schema files match the code. Part of `check`. |
| `./gradlew checkDaoRules` | Checks that DAOs only read and that only `RecordWriter` writes records. Part of `check`. |
| `./gradlew checkInstrumentedTestSuite` | Checks that the suite the emulator runs lists every test class. Part of `check`. |
| `./gradlew checkNoLogging` | Checks that no module's main code logs or prints. Part of `check`. |
| `./gradlew :build-logic:test` | Runs the tests of the build checks. Part of `check`. |
| `./gradlew :app:<name>:assembleRelease` | Builds the unsigned release APK. |
| `./gradlew :app:<name>:assemblePreview` | Builds the unsigned preview APK. |
| `./gradlew :core:crypto:assembleDebugAndroidTest` | Builds a module's test APK for the emulator. It checks that the instrumented tests compile. The tests themselves run only in CI ([emulator-tests.md](emulator-tests.md)). |

The commands after a dependency change are in
[After a dependency change](#after-a-dependency-change).

CI runs `./gradlew check verifyRoborazziDebug` together with
`:app:<name>:checkReleaseApkRules` and
`:app:<name>:checkReleaseGraphicsPathUse` for every app. See
[ci.md](ci.md#job-check), and the next section for which check runs
where.

## Which check runs where

CI's job "Check" is a required check. It runs one Gradle command:
`check verifyRoborazziDebug`, plus two release checks for every app,
named one by one ([ci.md](ci.md#job-check)). So every check below runs
on every pull request, either inside `check` or by name.

| Check | Task | In `./gradlew check` | How CI runs it | What it reads |
|---|---|---|---|---|
| [Room schemas](#room-schemas) | `checkRoomSchemas` | Yes | Inside `check` | Modules with the Room plugin |
| [DAO rules](#dao-rules-check) | `checkDaoRules` | Yes | Inside `check` | Modules with the Room plugin, main and test classes |
| [Instrumented test suite](#instrumented-test-suite-check) | `checkInstrumentedTestSuite` | Yes | Inside `check` | Modules with tests on an emulator |
| [Logging](#logging-check) (hard rule 10) | `checkNoLogging` | Yes | Inside `check` | The main code of every Android module but `core/testing` |
| [Tests of the build checks](#tests-of-the-build-checks) | `:build-logic:test` | Yes | Inside `check` | `build-logic` |
| [APK rules](#apk-rules-check) 1 to 6: permissions, native code, emoji loader, Play services, test fixtures, backup | `check<Variant>ApkRules` | No | By name, `:app:<name>:checkReleaseApkRules`, and CI checks its report | Every APK that is built: release, preview and debug |
| [APK rules](#apk-rules-check) 7 to 9: WebView and code loading | The same task | No | The same | Only the APKs that ship: release and preview |
| [Graphics path](#the-graphics-path-check) | `check<Variant>GraphicsPathUse` | Debug only | By name, `:app:<name>:checkReleaseGraphicsPathUse`, and CI checks its report | Every class an app runs |

Two more rules are no task. They fail any Gradle command:

- The bundled SQLite driver is refused in every module
  ([Convention plugins](#convention-plugins)).
- `core/testing` is refused anywhere but in a test configuration
  ([Logging check](#logging-check)).

The APK rules check also runs before every `assemble` task. So the PR
preview workflow, which builds the preview APK, runs rules 1 to 9 on it
too.

## Repositories

1. Gradle downloads from Google's Maven repository and Maven Central only.
2. Google's repository is used only for the groups `androidx`,
   `com.android` and `com.google`.
3. Modules may not declare repositories. The build fails if one does.
4. The Gradle Plugin Portal is not used. So `build-logic` does not use the
   `kotlin-dsl` plugin, which is only published there. It uses Gradle's
   built-in `java-gradle-plugin`, the Kotlin JVM plugin and the Kotlin
   SAM-with-receiver plugin instead. That is what `kotlin-dsl` does inside.
5. The cloud environment adds Google's mirror of Maven Central in front,
   through an init script outside the project. See
   [cloud-environment.md](cloud-environment.md). Never add the mirror to
   the project.

## Convention plugins

| Plugin | What it does |
|---|---|
| `shkriuss.android.application` | Apps: SDK levels, build types, lint, warnings as errors, reproducible-build settings, the APK rules check and the graphics-path check. `check` also runs the [tests of the build checks](#tests-of-the-build-checks). |
| `shkriuss.android.library` | Libraries: SDK levels, lint, warnings as errors. |
| `shkriuss.android.compose` | Compose compiler, Compose BOM, Compose test library. |
| `shkriuss.android.unit-test` | JUnit 4 and Robolectric, offline. |
| `shkriuss.android.screenshot-test` | Roborazzi. Applies the unit-test plugin too. |
| `shkriuss.android.instrumented-test` | Tests on an emulator, in `src/androidTest/`: the project's own test runner, JUnit 4 and `core/testing`. Tests in `src/sharedTest/` run on the JVM and on the emulator ([emulator-tests.md](emulator-tests.md), [ADR 0028](../adr/0028-instrumented-tests-own-runner-and-shell-steps.md)). The [instrumented test suite check](#instrumented-test-suite-check). |
| `shkriuss.android.test-fixtures` | Test helpers that the tests of other modules may use, in `src/testFixtures/` ([Test fixtures](#test-fixtures), [ADR 0029](../adr/0029-test-fixtures-for-the-keystore-stand-in.md)). |
| `shkriuss.android.room` | Room 3 on the system SQLite: KSP, Room's Gradle plugin, the runtime, the driver and the test library. The schema check and record tasks ([Room schemas](#room-schemas)) and the [DAO rules check](#dao-rules-check). |

Every module refuses the bundled SQLite driver, `androidx.sqlite:sqlite-bundled`.
Resolving it fails the build, with a message that names hard rule 2. The
setting is in `AndroidCommon.kt`.

Every module also runs the [logging check](#logging-check) in `check`,
and refuses `core/testing` outside its tests. Both are in
`AndroidCommon.kt` too.

Compiler warnings are errors in every module and in `build-logic` itself.
KSP's warnings, which include Room's, are errors too.

## Build types

| Build type | App ID | R8 | Signed by |
|---|---|---|---|
| `debug` | `app.shkriuss.<name>` | No | The machine's debug key |
| `release` | `app.shkriuss.<name>` | Shrinks and optimises, no renaming | The release workflow, with the suite key |
| `preview` | `app.shkriuss.<name>.preview` | Shrinks and optimises, no renaming | The preview workflow, with a throwaway key |

- `preview` is a copy of `release` with the ID suffix `.preview`, so it
  installs next to the real app (section 13 of the plan). Its version name
  ends in `-preview`, and Catalog's preview is labelled "Catalog preview".
- Gradle never signs `release` or `preview`. The workflows sign them with
  `apksigner` (plan section 13, [ADR 0014](../adr/0014-release-flow-and-reproducible-builds.md)).
- R8 uses the default `proguard-android-optimize.txt` rules plus
  `build-logic/r8/app-rules.pro`. See [R8](#r8).

## R8

R8 makes `release` and `preview` smaller and faster. It removes unused code
and resources, and it optimises the code that is left.

### The decision

The owner decided on
[pull request 5](https://github.com/shkriuss/shkriuss.app/pull/5):

1. Keep shrinking and optimisation.
2. Turn class and member renaming off (`-dontobfuscate`).
3. Keep the source file and line number attributes
   (`-keepattributes SourceFile,LineNumberTable`).

Reasons:

- The code is public, so renaming hides nothing.
- There is no crash reporter, so users paste stack traces. The owner has no
  computer to translate renamed ones.

The rules are in `android/build-logic/r8/app-rules.pro`.

The file has two more rules since Phase 1, step 5: classes of Google
Play services, and classes of the test fixtures of `core/crypto`, are
kept as they are. They exist only so that the APK rules check can find
such a class in a `release` or `preview` APK. No app holds one, so the
rules match nothing
([The Play services class rule](#the-play-services-class-rule),
[The test fixtures rule](#the-test-fixtures-rule)). The file is
owner-only since then.

### What a stack trace shows

- Class and method names are the real ones, as in the source code.
- The source file shows as `r8-map-id-...`, and line numbers are
  instruction offsets, not source lines. R8 always does this while it
  optimises. Only the release's mapping file turns them back into exact
  files and lines.
- Turning optimisation off (`-dontoptimize`) would give exact files and
  lines. The owner chose against it: the APK would be 2.3 times as big, and
  Compose is slower without R8's optimisation.

### Size

Catalog's unsigned release APK, from the same source, on 2026-11-10:

| R8 setting | APK size | `classes.dex` |
|---|---|---|
| Renaming on (before) | 1,204,979 bytes | 1,083,532 bytes |
| Renaming off (now) | 1,365,890 bytes | 1,245,284 bytes |
| Renaming and optimisation off (rejected) | 2,755,308 bytes | 2,620,676 bytes |

Turning renaming off adds 160,911 bytes, about 13 percent.

### The mapping file

R8 writes a mapping file for every `release` and `preview` build, at
`app/<name>/build/outputs/mapping/<build type>/mapping.txt`. It is what
turns a pasted stack trace back into exact files and lines. Two clean builds
write the same mapping file, byte for byte.

The release workflow attaches it to every release, next to the APK, as
`<app>-v<version>-mapping.txt` (owner decision on pull request 5). Its
second build must write the same mapping file, or the release stops. See
[release.md](release.md#the-mapping-file).

## Tests

### Unit tests

- Tests run on the JVM with JUnit 4 and Robolectric.
- They run for the `debug` build type only. `release` and `preview` compile
  the same Kotlin code, and R8 does not run for unit tests, so running them
  again would test nothing new.
- `core/design` has ten: `ShkColorsContrastTest`,
  `ShkThemeMaterialTest`, `ShkComponentsTest`, `ShkIconSizeTest`,
  `ShkTextFieldTest`, `ShkSliderTest`, `ShkSelectionControlSizeTest`,
  `ShkRadioGroupTest`, `ShkContentComponentsTest` and `ShkRowEdgeTest`.
  They check the contrast of every colour pair, how Material 3 is set
  up, and every `Shk*` component at font scale 1.0 and 2.0: its touch
  target, what TalkBack hears and announces, that long text wraps inside
  its shape, that the text of rows lines up with the rest of the screen,
  and that an icon, a checkbox or a radio button next to text grows with
  it ([design-system.md](design-system.md#tests)).
  - The tests that draw components use a plain `ComponentActivity`. No
    manifest of the library declares one, so the test registers it with
    Robolectric's package manager first. That needs no extra test
    library.
  - `ShkContentComponentsTest` sets Robolectric's screen to the phone of
    the screenshot tests, 411 by 914 dp, with `@Config(qualifiers)`. On
    Robolectric's own smaller screen its long samples at font scale 2.0
    would not fit, and their text would be squeezed.
- `core/data` has `RecordWriterTest`, `ChangedSinceTest` and
  `SampleMigrationTest`, and `core/testing` has `RecordConventionsTest`
  and `TestSourcesTest`. They check how records are written, the "changed
  since" query, the example migration and the migration test helpers,
  on the system SQLite driver under Robolectric
  ([architecture/data.md](../architecture/data.md#tests)).
- `core/crypto` has 23 test classes with 190 tests. They are the items 1
  to 8 and 10 to 13 of "What the tests must cover" in
  [crypto-design.md](../security/crypto-design.md#what-the-tests-must-cover),
  the rules for hardware keys, and the example file of the backup format
  (`BackupExampleFileTest`, see `core/backup` below). `StartOverTest` and
  `RepairTest` came with step 1.7, session A: starting over after a setup
  that stopped, a damaged keyset file, and giving file keys up.
  `WordsProofTest` came with step 1.7, session B: the checks of the
  recovery words before the app lock is turned on.
  - No Android Keystore exists on the JVM. So the tests pass a software
    stand-in for the hardware keys, `SoftwareHardwareKeys`, with the same
    byte layout. It can act like a phone that is locked, a Keystore that
    fails for a moment, a key that is gone and a screen lock that was
    removed. `StoppingStore` lets a test stop the app before any change
    to a keyset file, and start it again. The stand-in is in the
    module's [test fixtures](#test-fixtures), so that the tests of other
    modules can have real keys too.
  - `DesignVectorsTest` and `PublishedVectorsTest` run every vector of
    the page and the published ones. Tink cannot be told which salt and
    nonce to use, so `ReferenceStream` builds the stream blobs a second
    time from HMAC and AES-GCM alone, and the module must open them.
  - `LargeStreamTest` encrypts and decrypts one stream that is longer
    than all the memory the test JVM may use, a little over 2 GiB,
    without ever holding it. It takes about 10 seconds.
  - `CryptoBoundaryTest` reads the source of every other module under
    `android/`, and fails if a file names `com.google.crypto.tink`,
    `javax.crypto`, `java.security.KeyStore` or
    `android.security.keystore`, imports `java.security.*` with a star,
    takes the cipher out of a `CryptoObject`, or uses the Tink entry of
    the version catalog.
    - It reads the whole text of a file. A comment that names one of
      them fails too: word it differently.
    - Its limit: it reads source, not compiled classes. And Gradle does
      not know that this test reads other modules. In a cloud session it
      may skip the test when only another module changed. CI starts from
      a clean checkout and always runs it.
    - How it was tested: with a temporary `import javax.crypto.Cipher`
      in `core/data`, the test failed and named the file.
  - `NoSecretsTest` runs every flow with its failures, collects every
    text form, every error with its stack trace, Android's log and the
    standard output, and searches all of it for the keys, the recovery
    words and the plaintext. With a temporary `toString` that showed two
    recovery words, it failed.
  - `ShkCryptoTest` builds the module the way an app does, with the real
    `AndroidHardwareKeys`. Robolectric has no Android Keystore, so it
    checks the other half: where the Keystore gives no answer, nothing is
    made, stored or deleted, and no key counts as lost. The Keystore
    itself is tested on an emulator
    ([emulator-tests.md](emulator-tests.md#the-tests-of-the-hardware-keys)).
  - Four of the classes are in `src/sharedTest/`, with the helpers they
    use: `DesignVectorsTest`, `PublishedVectorsTest`, `RecoveryWordsTest`
    and `KeysetFilesTest`. They run here on the JVM, and a second time on
    the emulator, where Tink takes its Android path. The stand-in they
    use comes from the test fixtures on both.
  - Most of these tests need no Robolectric. Those that build the object
    for the system prompt, read Android's log or build a key's settings
    run under it.
- `core/backup` has 10 test classes with 71 tests. They are the items of
  "What the tests must cover" in
  [backup-format.md](../architecture/backup-format.md#what-the-tests-must-cover).
  - They use real keys: `SoftwareKeysApp` from the
    [test fixtures](#test-fixtures) of `core/crypto`, and a fake app
    that holds its records in memory and its files in a folder.
  - `RoundTripTest`, `DamagedFileTest`, `WrongKeyAndVersionTest`,
    `BodyRulesTest`, `ExportTest` and `NothingChangesTest` write, check
    and restore backups in memory. `DamagedFileTest` cuts a backup at
    every length and changes every byte of it, one at a time. For every
    file that must be refused, a check and a restore must give the same
    answer, the app must be as it was, and nothing may be left in the
    staging folder.
  - `BodyRulesTest` writes bodies by hand that break one rule each, and
    encrypts them with the real keys. So only the rule can refuse them.
  - `LargeFileTest` proves that a file is never held in memory. One file
    of a little over 2 GiB, longer than all the memory the test JVM may
    use, goes into a backup and through the check, with nothing stored.
    It takes about 3 seconds in the cloud environment. In CI the whole
    test task of `core/backup` ended 29 seconds after its code was
    compiled. Two more tests watch that writing and restoring a file of
    64 MiB never run more than 4 MiB ahead of what they have passed on.
  - `ExampleFileTest` reads the example file of the page as a backup.
    `BackupExampleFileTest` in `core/crypto` builds the same bytes a
    second time with `ReferenceStream`. It is there because only
    `core/crypto` may use plain AES-GCM.
  - `BackupsTest` runs under Robolectric. It writes, checks and restores
    through Android's content resolver, with documents that are files
    behind a small content provider of the test. It checks that a
    document is opened in the mode that cuts off old content, that a
    failed backup is deleted, that only `content:` URIs are taken, and
    the two intents of the system file picker.
  - No test opens the picker itself. That is checked by hand with the
    first app.
- Catalog has `CatalogScreenTest`. It starts the app's activity and checks
  the title is a heading, which is what TalkBack announces, that every page
  has a button at least 48 dp tall, that each page opens and back returns,
  and what TalkBack hears for a contrast.
- Catalog also has `ComponentPagesTest`. It opens each component page and
  checks the components where they sit: labels and roles, touch targets
  that do not overlap, the disabled states, the components to try, the
  section headers as headings, the loading state as "in progress", and
  the loading and error states to try as polite live regions.

- `core/notify` has five test classes with 69 tests
  ([notifications.md](../architecture/notifications.md#tests)).
  - `AlarmSyncTest` runs the rules for alarms with `TestClock` of
    `core/testing` and a stand-in for Android's alarms. No test waits
    for real time.
  - `AlarmManagerSchedulerTest` and `NotifyTest` use Robolectric's
    `AlarmManager` and `NotificationManager`. Robolectric offers the
    broadcast of a waiting alarm only as a field it marks as
    deprecated. Two small helpers of the tests read it, and silence
    that one compiler warning there.
  - `NotifyTest` runs with the app class `TestApp`, a `NotifyHost`, set
    with `@Config(application = ...)`.
  - `ManifestTest` reads the module's `AndroidManifest.xml`.
  - `NotifyBoundaryTest` reads the source of every other module under
    `android/`, and fails if a file names `android.app.AlarmManager`,
    a class that starts with `android.app.Notification` or
    `androidx.core.app.Notification`, `androidx.core.app.AlarmManagerCompat`,
    imports `android.app.*` or `androidx.core.app.*` with a star, or
    names `ALARM_SERVICE` or `NOTIFICATION_SERVICE`. It has the limits
    of `CryptoBoundaryTest` above.
- `core/security` has nine test classes with 79 tests
  ([security-screens.md](../architecture/security-screens.md#tests)).
  - `FlowViewModelsTest` runs every flow of the recovery key through its
    ViewModel, with real keys from `SoftwareKeysApp`. Work runs on the
    test's own thread, so each state shows right after each call. The
    system prompt is answered by calling what the screen calls.
  - `SecurityActivitiesTest` starts the four screens under Robolectric,
    with the app class `TestHostApp`, a `SecurityHost`. It reads the
    window's flags and what the field tells the keyboard.
  - `ConfirmWordsTest` draws the screen with the four words that confirm
    a new key in a plain activity, which it adds to Robolectric's
    package manager first, as the tests of `core/design` do.
  - `WordInputTest` checks what a word field accepts, with no Android.
  - `AppLockWatcherTest` starts and stops plain screens with
    Robolectric's activity controller, moves a clock of its own instead
    of Android's, and turns Robolectric's screen off and on. It checks
    when the app locks and what the windows hide.
  - `AppLockGateTest` draws a screen in `AppLockGate`, with real drawing
    (`GraphicsMode.NATIVE`), so that it can count the frames of the
    screen while the app is locked. It delivers a picker's result with
    Robolectric while the app is locked. `AppLockGateWithoutAWatcherTest`
    uses an app class that never starts its watcher.
  - `AppLockViewModelsTest` runs the lock screen, the app lock screen and
    turning the app lock on through their ViewModels, with real keys, as
    `FlowViewModelsTest` does. A dispatcher of its own holds background
    work back, so that a test can stop the screen while the prompt still
    reads the kept key. `AppLockActivitiesTest` starts the app lock
    screen and checks its labels and touch targets.

### Instrumented tests

Tests that need a real Android run on an emulator, in the job "Emulator"
of CI. Today those are the tests of the hardware keys in `core/crypto`
and the tests of the alarms in `core/notify`. They cannot run in a cloud session, which has no emulator. What they
are, how they run and what they found is in
[emulator-tests.md](emulator-tests.md).

### Test fixtures

Test helpers that the tests of other modules may use
([ADR 0029](../adr/0029-test-fixtures-for-the-keystore-stand-in.md)).

1. A module that applies `shkriuss.android.test-fixtures` has a folder
   `src/testFixtures/`. Today only `core/crypto` does. `core/backup` and
   `core/security` use them.
2. Code there sees the `internal` declarations of its module. The
   module's own unit tests and emulator tests see what is in the
   fixtures, also what is `internal` there.
3. Another module uses the fixtures in its tests only:
   `testImplementation(testFixtures(project(":core:crypto")))`.
4. The fixtures of `core/crypto` are one package,
   `app.shkriuss.core.crypto.fixtures`, with two classes:
   - `SoftwareHardwareKeys`, the stand-in for the Android Keystore.
   - `SoftwareKeysApp`, which builds a real `ShkCrypto` on the stand-in
     and a folder. A test gives it a recovery key, and then encrypts and
     decrypts as an app does.
5. Fixtures are never part of an app. For those of `core/crypto`, the
   APK rules check makes sure ([The test fixtures rule](#the-test-fixtures-rule)).
6. Android Gradle Plugin 9.5.1 still marks test fixtures as incubating.
   What this project needs was checked on 2026-11-12 in the cloud
   environment:
   - Kotlin code in `src/testFixtures/` compiles with no experimental
     flag.
   - The visibility of point 2 holds, for the unit tests and for the
     emulator tests.
   - Nothing new is downloaded, so the dependency verification file did
     not change.

### Screenshot tests

Roborazzi takes screenshots on the JVM, through Robolectric.

1. Every screen is captured in eight configurations: phone and tablet,
   light and dark, font scale 1.0 and 2.0. A screen taller than the
   window is captured to its end, one window per image: `_part2`,
   `_part3` and so on
   ([design-system.md](design-system.md#screenshots)).
   - Phone: 411 by 914 dp at 420 dpi, close to the Pixel 9 Pro.
   - Tablet: 1280 by 800 dp at 320 dpi in landscape, the Pixel Tablet.
2. The reference images are committed in `src/test/screenshots/` of each
   module. Open them in the pull request's **Files changed** tab, or
   download the new and changed ones as one zip
   ([test-a-pull-request.md](test-a-pull-request.md#look-at-the-screenshots)).
3. `verifyRoborazziDebug` fails when a screenshot differs from its reference.
4. After an intended UI change, `recordRoborazziDebug` writes new reference
   images. Commit them with the change.

The test starts the real activity, so the images show the window theme and
the system bars' space too. An earlier version drew the screen on its own,
and under heavy load it once captured an empty image. Starting the activity
through the Compose test rule waits until drawing is done.

At font scale 2.0 the title grows by about 1.5 times, not 2 times. Android
14 and later scale large text less than small text. That is correct.

### Robolectric settings

- Robolectric 4.17 runs the Android 17 image (`android-all-instrumented`
  version `17-robolectric-15733970-i7`).
- Gradle downloads that image like any other dependency, so dependency
  verification checks it. Robolectric runs offline and never downloads
  anything itself.
- On JDK 21, Robolectric 4.17 needs one test JVM flag:
  `--add-exports=java.base/jdk.internal.access=ALL-UNNAMED`. Without it
  every test fails with "Failed to interact with raw FileDescriptor
  internals". The flag `--add-opens=java.base/java.io=ALL-UNNAMED` from the
  earlier test build is no longer needed. Robolectric 4.18 is still a beta
  (`4.18-beta-1`), so it was not tried.
- Compose UI tests ask for Espresso 3.5. Espresso 3.5 fails on the Android
  17 image (it calls `InputManager.getInstance()`, which Android 17
  removed). A version constraint lifts it to 3.7.0, which works. Espresso
  is not a direct dependency.

## Room schemas

Room writes the schema of each database version to a JSON file. The files
are committed in `schemas/<database class>/<version>.json` of the module
that holds the database. The decision is in
[ADR 0026](../adr/0026-room-build-tools.md).

1. Room's compiler writes a schema file only when the committed one is
   missing or describes a different schema.
2. Room's Gradle plugin would copy that file over the committed one in
   every build. The `shkriuss.android.room` plugin turns the copy off.
3. `checkRoomSchemas`, part of `check`, fails if Room wrote any file that
   is not committed exactly as written. So CI fails when a schema changes
   without a new version, or a new schema file is not committed.
4. `recordRoomSchemas` copies the files Room wrote into `schemas/`. Commit
   them.
5. Unit tests read the committed files as assets, for the migration tests
   in `core/testing`.

The steps for a schema change are in
[architecture/data.md](../architecture/data.md#how-to-change-a-schema).

How it was tested in Phase 1, step 3: with version 2 of the example
database not yet recorded, `checkRoomSchemas` failed and named
`2.json`. A changed `NOT NULL` in the committed `2.json` failed it too.
A change of spaces only did not, because the schema is the same.

## DAO rules check

Records are only marked as deleted, and every write goes through
`RecordWriter`, which stamps the record fields and the change number
([ADR 0027](../adr/0027-record-fields-and-stamping.md)). A DAO only reads.
The task `checkDaoRules` fails the build when code could break that. It
runs in `check` for every module with the `shkriuss.android.room` plugin.

1. It reads every class the module's Kotlin compile tasks write, main and
   tests. Room's annotations stay in the class files, each query is there
   as the compiler joined it, constants included, and so is every method a
   class calls. It needs no library: `CheckDaoRulesTask.kt` reads the class
   file format itself.
2. It fails if:
   - a function is annotated `@Delete` or `@Upsert`,
   - a function is annotated `@Insert` or `@Update`, unless it is in
     `RecordDao` itself,
   - a function is annotated `@Insert` or `@Update` with
     `OnConflictStrategy.REPLACE`, even in `RecordDao`,
   - a function is annotated `@Query` with SQL that contains `INSERT`,
     `DELETE`, `UPDATE`, `REPLACE INTO` or `OR REPLACE`. Comments and text
     in quotes are not counted,
   - a class other than `RecordWriter` and its nested classes calls
     `rawInsert` or `rawUpdate`, directly or as a function reference.
3. It checks every class, not only those marked `@Dao`, so a forbidden
   function in a base interface is caught too.
4. A DAO implementation that Room generates calls its own `rawInsert` and
   `rawUpdate`: that is a bridge the Kotlin compiler adds. A class that
   calls its own function of that name is therefore left alone.
5. The one exception: a function marked `@PurgesDeletedRecords` passes if
   its query is `DELETE FROM <table> WHERE deletedAt IS NOT NULL`,
   optionally followed by `AND` and more conditions, with no `OR`. A class
   may have only one. A marked function that is anything else fails.
   There is no other exception (owner's decision on pull request 21).
6. The failure message lists each problem, and says to stop and ask the
   owner. Never change the check to make a build pass.

The report is written to `build/reports/dao-rules/`.

What it cannot see:

- SQL that code runs outside a DAO, through a connection. `RecordWriter`
  raises the change counter that way, because the counter is not a
  record.
- Calls to `rawInsert` or `rawUpdate` from modules without the Room
  plugin, such as app modules.

How it was tested in Phase 1, step 3, with a temporary file in the tests
of `core/data`:

1. First round. In DAOs and in one base interface without `@Dao`, the
   file declared `@Delete`, `@Upsert`, `@Insert` and `@Update` with
   `REPLACE`, `DELETE` and lower-case `update` queries, `INSERT OR
   REPLACE`, `REPLACE INTO`, a `DELETE` built from two joined constants, a
   marked purge with `OR`, a marked read, and two marked purges in one
   DAO. `checkDaoRules` failed and named all 13.
2. Second round, after the owner's answers on pull request 21. The same
   file also declared a plain `@Insert` and a plain `@Update` in a feature
   DAO, an `INSERT` query, a repository that calls `rawInsert`, and a
   function reference to `rawUpdate`. The check failed and named 20
   problems: the 13, the `@Insert` and `@Update` of the two `REPLACE`
   functions, and the 5 new ones.
3. In both rounds a marked purge with quoted names and `AND`, a read with
   `update`, `delete` and `insert` inside quotes and a comment, and a
   repository that only calls `find` and `changedSince` passed.
4. With the file removed, the check passed on the 108 classes of
   `core/data`, including Room's generated DAO implementations.

## Instrumented test suite check

The emulator runs one class of a module: the JUnit suite
`InstrumentedTests` ([emulator-tests.md](emulator-tests.md),
[ADR 0028](../adr/0028-instrumented-tests-own-runner-and-shell-steps.md)).
A test class that the suite does not list is compiled and never runs,
and no red check would say so. The task `checkInstrumentedTestSuite`
fails the build for it. It runs in `check` for every module with the
`shkriuss.android.instrumented-test` plugin. The owner asked for it on
[pull request 24](https://github.com/shkriuss/shkriuss.app/pull/24).

What it compares:

1. Every class with a `@Test` function in the module's `src/androidTest/`
   and `src/sharedTest/` folders.
2. Every class the suite lists in `@Suite.SuiteClasses`.

It fails if:

- a class with `@Test` is not in the suite,
- the suite lists a class that has no `@Test` in those folders,
- there are such tests and no class `InstrumentedTests` in the module's
  package,
- a file with `@Test` holds no class, or more than one, at the left edge
  of the file. Then the check cannot tell which class the tests are in,
- a `.java` file is in those folders.

How it works, and its limits:

- It reads the source text, not compiled classes. So it runs in `check`
  without building a test APK, also in a cloud session.
- Comments and text in quotes are left out before it looks. A `@Test` in
  a comment counts for nothing.
- It asks for a simple shape: one test class in a file, and the suite
  names each class as `Name::class`. A test that a class only inherits
  from another class is not seen.
- It does not run the tests. That the listed classes pass is what the
  job "Emulator" shows ([ci.md](ci.md#job-emulator)).

The check is `CheckInstrumentedTestSuiteTask.kt` in `build-logic`. It is an
owner-only file, as are the runner and the plugin that connects them.

How it was tested, on 2026-11-12, in `core/crypto`:

1. `TinkOnAndroidTest` taken out of the suite: the check failed and named
   it.
2. A new file `ForgottenTest.kt` with one `@Test`, in `src/sharedTest/`
   and not in the suite: the check failed and named it.
3. `DeviceApp`, a class with no test, added to the suite: the check
   failed and named it.
4. The suite's file taken away: the check failed and said that none of
   the tests would run.
5. A `@Test` written only in a line comment, in a block comment and
   inside quotes: the check passed.
6. With all of that undone, the check passed on the 19 files of
   `core/crypto`.

## Logging check

Hard rule 10: user content must never reach a log. So main code never
logs or prints. The task `checkNoLogging` fails the build when it does.
It runs in `check` for every Android module. The owner asked for it in
step 1.9
([threat model](../security/threat-model.md#found-while-writing-this-page),
point 3). It replaced the test `theModuleNeverLogsOrPrints` in
`core/crypto`, which checked that one module only.

What it reads:

1. Every `.kt` and `.java` file in every folder under the module's
   `src/` that is not test code: `main`, `debug`, `release`, `preview`,
   and any folder added later.
2. Test code is a folder whose name starts with `test` (such as `test`,
   `testDebug` and `testFixtures`) or with `androidTest`, and the folder
   `sharedTest`.

What it forbids: any of these 13 forms, anywhere in the text, comments
and text in quotes included:

- the ten forms of the test it replaced: `android.util.Log`, `Log.`,
  `println`, `print(`, `printStackTrace`, `System.out`, `System.err`,
  `java.util.logging`, `Logger` and `Timber`,
- three more: `Log::` and `::print`, a function reference to a log or
  print function, which names neither `Log.` nor `print(`, and
  `dumpStack`, as in `Thread.dumpStack()`, which prints to the standard
  error.

It reads the text exactly as the replaced test did, so it is never
weaker. A comment that names one of the forms fails too. Write it
another way.

It fails if a module has no main code at all, so it never passes by
reading nothing. The failure message names each file, line and form.
The report is written to `build/reports/no-logging/`.

How it treats each kind of code:

- **Test code** is not checked. It never ships in an app, and it holds
  only test data. Some tests must print or capture the output, such as
  `NoSecretsTest` in `core/crypto`.
- **Catalog** is checked like every app. It ships to users.
- **`core/testing`** is not checked. It is a module of test helpers, and
  its test runner logs on purpose, so that the emulator job's log holds
  each test's result. A rule in `AndroidCommon.kt` makes sure it stays
  test code: if any module declares `core/testing` in a configuration
  whose name does not start with `test` or `androidTest`, every Gradle
  command fails and names the module and the configuration. So
  `core/testing` can never reach an app (owner's decision in step 1.9).
- **`build-logic`** is not checked. It is the build's own code and never
  part of an app.

Only Android modules are checked. `AndroidCommon.kt` registers the check,
and only the application and library plugins call it. A module that is
not an Android module, such as a plain Kotlin module, would not be
checked. Such a module must not be added without covering it by this
check first (owner's decision in step 1.9).

Its limit: it reads text. A call written so that it shows none of the
forms, for example through reflection, is not seen. Review keeps that.

How it was tested, on 2026-11-13 in the cloud environment:

1. Before the change, the forms appeared in main code in one place only:
   the test runner in `core/testing`.
2. With the check in place, all seven checked modules passed. They read
   9 to 29 files each, 27 in `core/crypto`.
3. A line `android.util.Log.d("probe", title)` added to a main file of
   `core/design` failed the check, which named the file, the line and
   the forms `android.util.Log` and `Log.`.
4. The same line in a test file of `core/design` passed.
5. `implementation(project(":core:testing"))` in Catalog's build file
   failed every Gradle command, naming `:app:catalog` and
   `implementation`.

## Tests of the build checks

Each build check added in step 1.9 has unit tests. They show that it
fails on a sample that breaks its rule, and passes on one that does not.
The owner asked for them in step 1.9.

1. They are in `build-logic/src/test/kotlin/`, and run on the JVM with
   JUnit 4. `build-logic/build.gradle.kts` sets them up. JUnit 4.13.2 is
   the version every module's tests use. It was already in the version
   catalog and in the dependency verification, so nothing new is
   downloaded.
2. `build-logic` is a build of its own, so the main build's `check`
   would not run them. The application plugin makes every app's `check`
   depend on `:build-logic:test`. So CI's `check` runs them on every pull
   request.
3. The tests write their own samples: binary XML, resource tables, dex
   files and APKs, with small writers in the test folder.
   No binary file is in the repository. That the readers also read what
   the real tools write is shown by the checks themselves, on Catalog's
   APKs, on every pull request. A file they cannot read fails the check.
4. The forbidden names, forms and domains are written out in the tests,
   not taken from the checks. So a check with a shorter list fails a
   test.

| Test | What it shows |
|---|---|
| `NoLoggingCheckTest` | Each of the 13 forms fails in main code, also in a comment or in quotes. The ten forms of the replaced test are all there. `main`, `debug`, `release`, `preview` and a new folder are main code. The test folders are not checked. A module with no main code is found. |
| `CoreTestingGuardTest` | `core/testing` in `implementation`, `api` or `debugImplementation` fails. In `testImplementation` and `androidTestImplementation` it passes. |
| `ApkResourceReaderTest` | The reader reads binary XML and every resource table layout it claims to read. A cut-off or wrong file is refused. |
| `BackupRulesTest` | Catalog's settings pass. Each way to turn backup or transfer on fails and is named: `allowBackup` true, missing or from a resource, a backup agent, no rules, a rules file that is missing, an `<include>`, each of the nine domains missing in each section, `<cross-platform-transfer>`, a missing or doubled section, a wrong root, and a wrong second copy. |
| `WebViewAndCodeLoadingRulesTest` | Each WebView class and each class loader fails as a class and as text. Each of the four calls fails. What today's APKs hold passes: `MimeTypeMap`, `URLUtil`, `loadLibrary`, D8's stub. Every dex file of an APK is read. An APK without a dex file, or with one the reader cannot read, fails. |

How the tests were checked: on 2026-11-13, the checks were weakened on
purpose, all at once: `allowBackup` true let through, `WebView` allowed,
`Runtime.exec` taken off the list, and `dumpStack` taken off the list.
Seven tests failed. With the checks restored, all passed.

The older checks (Room schemas, DAO rules, the instrumented test suite,
the graphics path, and APK rules 1 to 5) were tested by hand, as their
sections say. They have no unit tests yet.

## Lint

1. Android Lint runs in `check`. Warnings are errors.
2. Lint findings are fixed, not hidden. Two single places are suppressed,
   each with its reason next to it:
   - `MissingClass` on `androidx.startup.InitializationProvider` in
     Catalog's manifest. The class comes from a library Compose uses only
     at run time, so lint cannot see it. It is in the APK.
   - `MissingPermission` on the one function that sets an exact alarm,
     `AlarmManagerScheduler.set` in `core/notify`. Lint 32.5.1 does not
     know the permission `USE_EXACT_ALARM`, which the module's manifest
     declares. It accepts only `SCHEDULE_EXACT_ALARM`, which ADR 0010
     rejected. The owner decided this
     ([ADR 0030](../adr/0030-how-core-notify-keeps-alarms.md), point
     10). `ManifestTest` and the emulator tests check the permission
     instead. After an update of the Android Gradle Plugin, the build is
     tried without it (prompt R5 in [PROMPTS.md](PROMPTS.md)).
3. Compose and Activity ask for Lifecycle 2.9. Its built-in lint checks no
   longer load in this version of lint ("Library lint checks reference
   invalid APIs"). A version constraint lifts Lifecycle to 2.11.0, whose
   checks work.
4. Three checks are turned off in every module: `GradleDependency`,
   `NewerVersionAvailable` and `AndroidGradlePluginVersion`.
   - Why: they look up the newest versions online while lint runs. Their
     result depends on the date and the network, not on the code, so the
     same commit could pass today and fail tomorrow. In Phase 0, step 3,
     one of them asked `repo.gradle.org` for the newest Gradle release, which
     the cloud environment blocks but GitHub Actions does not.
   - Updates are handled by prompt R5 in [PROMPTS.md](PROMPTS.md) instead.
   - This is the owner's decision on
     [pull request 5](https://github.com/shkriuss/shkriuss.app/pull/5). It is
     not a precedent. Every other lint check stays on, and turning off
     another one needs the owner's decision too (hard rule 9).
   - The setting, with the same reason, is in `build-logic`,
     `AndroidCommon.kt`.

## Dependency verification

### How it works

1. Gradle checks every file it downloads, in every build, before it uses it.
2. A file signed with PGP must be signed by a key listed as trusted in
   `android/gradle/verification-metadata.xml`.
3. A file that is not signed must match the SHA-256 checksum listed there.
4. The public keys are committed in `android/gradle/verification-keyring.keys`.
   Key servers are turned off (`<key-servers enabled="false"/>`), so a
   normal build never contacts a key server.
5. A file that fails, or is not listed, stops the build.

The decision is recorded in
[ADR 0020](../adr/0020-dependency-verification.md).

### Where trust comes from

- The keys and checksums were recorded on 2026-11-10 from the first
  download. Gradle fetched the public keys from `keys.openpgp.org` and
  `keyserver.ubuntu.com`. Nothing was checked by hand. That is trust on
  first use.
- Room, KSP and what they need were added on 2026-11-12, in Phase 1,
  step 3, the same way. Gradle could not fetch one key,
  `3288B8BE8512D6C0CA185268C51E6CBC7FF46F0B` (Ron Shapiro, Google), from
  any key server, in two tries. It signs one parent POM,
  `com.google.auto:auto-parent:7`. Claude fetched the key from
  `keyserver.ubuntu.com`, checked with `gpg` that it made the POM's
  signature, and added it to the keyring. Gradle then recorded the
  signature itself.
- Tink was added on 2026-11-12, in Phase 1, step 4, session B, the same
  way. It needed one new key,
  `73976C9C39C1479B84E2641A5A68A2249128E2C6`, "Tink Developers (Signing
  key for Maven artifacts)". It is trusted for `tink-android` 1.24.0
  only. Claude checked with `gpg` that the key in the keyring made the
  signatures of the jar and of the POM. The four libraries Tink brings
  needed no new entry: Gson and Error Prone are signed by keys that were
  already trusted for their groups, the key of JSR-305 3.0.2 was already
  trusted for exactly that version, and Google's key covers
  `androidx.annotation`. The file already trusted another key for `tink`
  1.7.0, an older artifact that the Android Gradle Plugin uses. That
  entry was not touched.
- 60 keys are trusted. Google signs most AndroidX and AGP files, Room 3
  and `androidx.sqlite` included, so those are checked by signature.
- 64 components are listed one by one. 48 are checked by checksum only,
  because they are not signed: mostly older AndroidX releases, and parent
  POM files. 16 are checked by a key trusted for that one file.
- The keyring holds 68 keys.
- Gradle groups a trusted key by Maven group where it can. A new version in
  that group, signed by the same key, is then trusted without a new entry.

### After a dependency change

Claude does this in the same pull request as the change to
`libs.versions.toml` (hard rule 5 in CLAUDE.md).

1. Delete the build folders: `build/` in `android/`, in `build-logic/`
   and in every module, and `android/.gradle/configuration-cache/`.
   Without it, tasks that are up to date do not resolve their files, and
   entries go missing. `./gradlew clean` is not enough: it does not clean
   `build-logic`, and it fails when a new Gradle plugin is not in the file
   yet.
2. Run
   `./gradlew --write-verification-metadata sha256,pgp --export-keys help check verifyRoborazziDebug assembleDebug assembleRelease assemblePreview`.
   It runs every task CI runs, so files that are only resolved while a task
   runs (lint, R8, the Robolectric image) are included. In this mode Gradle
   fetches missing keys, even with key servers turned off.
3. Check that `<key-servers enabled="false"/>` is still in the file.
4. Search the file for `ignored-key`. An ignored key means Gradle could not
   fetch it. Run step 2 again with `--refresh-keys`; Gradle remembers a
   failed key lookup for 24 hours. In the cloud environment, key lookups
   failed now and then in Phase 0 and Phase 1.
   - If a key still fails, fetch it from `keyserver.ubuntu.com`, check with
     `gpg --verify` that it made the signature of the files it signs, and
     add it to `verification-keyring.keys`. Remove the `ignored-key` entry
     and the checksum entries Gradle wrote instead, then run step 2 for a
     task that resolves those files. Say in the pull request which key it
     was and how it was checked.
5. Read the diff of both files. Every new key and checksum must belong to
   the new dependency. Say in the pull request where it comes from.
6. Gradle also writes `verification-keyring.gpg`. It is ignored by Git.
   Only the `.keys` file is committed.

Gradle adds entries but never removes them. To drop old ones, put back
the files from `main` (or delete them and add the `key-servers` line
back), then run steps 1 and 2. In Phase 1, step 3, both files were
started again from `main`, so the pull request held only the entries the
new dependencies need.

### When verification fails

The build stops with "Dependency verification failed" and the name of the
file. Never turn verification off or make it lenient (hard rule 9). Find
out why the file changed. If a dependency was meant to change, follow the
steps above.

## Gradle wrapper

- Gradle 9.6.1, the bug-fix release of 9.6. AGP 9.5.1 needs at least
  Gradle 9.6.0.
- `distributionSha256Sum` pins the download. The value comes from Gradle's
  version list at `https://services.gradle.org/versions/all`, which is also
  what Gradle's own wrapper check uses. The download was checked against it.
- `gradle-wrapper.jar` was made by Gradle 9.6.1 itself, and matches the
  published checksum `497c8c2a…a194a9c7`.
- The cloud environment blocks `downloads.gradle.org`, where the
  `.sha256` files now live. The version list on `services.gradle.org` works.
- CI checks the jar, `distributionUrl` and `distributionSha256Sum` against
  that version list on every pull request
  ([ci.md](ci.md#job-gradle-wrapper)). The jar must be the one of the
  version named in `distributionUrl`. The wrapper task writes the jar of
  the Gradle that runs it, so after changing the version, run the wrapper
  task a second time.

## Reproducible builds

### What is set and why

1. **Everything is pinned.** Gradle with a checksum, every dependency
   version, the JDK version, the SDK platform and the build tools. The same
   source gives the same inputs.
2. **No version control info.** AGP puts the Git commit ID into release
   APKs by default. That would make the APK depend on the `.git` folder,
   not only on the source files. It is off for `release` and `preview`.
3. **No dependency info block.** AGP would add a list of dependencies to the
   APKs it signs, encrypted so that only Google Play can read it. Nobody
   else can check what is in it. It is off.
4. **Unsigned outputs.** Gradle does not sign `release` or `preview`, so
   the APK that is compared contains no signature.
5. **No caches for release builds.** The comparison runs with
   `--no-build-cache`. The release workflow uses no caches, and runs Gradle
   with `--no-build-cache` and `--no-configuration-cache`
   ([release.md](release.md)).

Gradle, AGP, R8 and the Kotlin compiler already write files in a fixed
order with fixed timestamps. Nothing else was needed.

### How it was checked

On 2026-11-10, in the cloud environment, Catalog was built twice from clean
copies of the source:

- in two different folders, with different path lengths,
- with two separate Gradle home folders, so no cached work was shared,
- with different time zones (UTC and UTC+14) and file permission masks
  (`022` and `077`),
- the second build offline,
- each with `--no-daemon --no-build-cache`.

The `debug`, `release` and `preview` APKs were byte for byte the same, and
so were the R8 mapping files. A release APK built inside the Git checkout
also matched one built from a copy without `.git`. The check was repeated
after each change to the build in pull request 5, last with R8 renaming
turned off.

The release workflow repeats this check for every release: its job
"Rebuild and compare" builds again on a new runner, in another folder, in
UTC+14 and with the mask `077`, and fails unless the APK and the mapping
file match ([release.md](release.md)). On 2026-11-11 the workflow's own
steps were run in the cloud environment on two such builds of Catalog.
The unsigned APK (1,365,890 bytes) and the mapping file (18,200,713 bytes)
were the same.

### What it does not cover

- Debug APKs are signed with the machine's own debug key. They only match
  when built on the same machine.
- Builds were compared on Linux only. CI also runs on Linux.

## APK rules check

Every time an APK is assembled, the task `check<Variant>ApkRules` reads it
and fails the build if:

1. it contains a native library (hard rule 2),
2. its manifest declares or requests any permission (hard rule 4, and no
   app needs a permission yet),
3. its manifest still starts the emoji font loader (hard rule 3, see below),
4. one of its dex files names a class under `com.google.android.gms`, the
   package of Google Play services (hard rule 3), or it has no dex file
   at all,
5. one of its dex files names a class under
   `app.shkriuss.core.crypto.fixtures`, the test fixtures of
   `core/crypto` ([ADR 0029](../adr/0029-test-fixtures-for-the-keystore-stand-in.md),
   see below),
6. Android's own backup or device transfer is not off
   ([The backup rule](#the-backup-rule)),
7. in an APK that ships, its code names a WebView class,
8. in an APK that ships, its code names a class loader that reads code,
9. in an APK that ships, its code calls `System.load`, `Runtime.load`,
   `Runtime.exec` or `ProcessBuilder.start`
   ([The WebView and code loading rules](#the-webview-and-code-loading-rules)).

An APK that ships is one of every build type but `debug`: `release` and
`preview` today. The failure message names the app and its application
ID, then each problem.

The report is written to `build/reports/apk-rules/`. A library can add any
of these without anyone noticing. The check makes sure someone does.

### The Play services class rule

The owner asked for rule 4 in Phase 1, step 4, session B. Tink would use
a security provider of Play services if an app had one
([crypto-design.md](../security/crypto-design.md#no-play-services-provider)).
An app has one only if it holds Play services code.

1. A dex file names every class the APK holds, and every class its code
   refers to, by a descriptor such as `Lcom/google/android/gms/Foo;`. The
   rule searches the bytes of every dex file for
   `Lcom/google/android/gms/` and names each class it finds.
2. It does not search for the dotted form. AndroidX Activity holds the
   plain text `com.google.android.gms.provider.action.PICK_IMAGES`, the
   name of a system action. That is a string, not a class.
3. An APK with no dex file fails. So the rule never passes by reading
   nothing.

How it still finds a class after R8:

1. This build never renames. `-dontobfuscate` is set for `release` and
   `preview` ([R8](#r8)). A class that stays in the APK keeps its real
   name.
2. R8 can only rename a class that is inside the APK. A class the code
   only refers to always keeps its name.
3. One R8 rule keeps every class of that package as it is:
   `-keep class com.google.android.gms.** { *; }` in
   `build-logic/r8/app-rules.pro`. The owner asked for it on pull
   request 25. Without it R8 can fold such a class into another one:
   the name is gone and the code stays. That is what the second test
   below showed.
4. The same rule runs on the preview APK of every pull request, and on a
   debug APK whenever one is built. R8 never touches a debug APK. CI
   itself builds only `release` and `preview`.

Its limits:

- It depends on `-dontobfuscate` and on the R8 rule of point 3. Comments
  next to both lines in `build-logic/r8/app-rules.pro` say so. If
  renaming is ever turned on, the rule must read the classes before R8
  instead, as the [graphics-path check](#the-graphics-path-check) does.
  That needs `AndroidApplicationConventionPlugin.kt`, which is
  owner-only.
- Before the R8 rule, a Play services library that was added but never
  called left no class in a release APK, because R8 removes code that
  nothing uses. With the R8 rule its classes are kept, so the release
  APK fails too. A Play services library in an app is always a mistake,
  called or not.

How it was tested, on 2026-11-12 in the cloud environment:

1. Catalog got a temporary class `com.google.android.gms.Probe`, used by
   its activity.
2. `assembleDebug`, `assembleRelease` and `assemblePreview` each failed in
   their APK rules check and named the class: in `classes4.dex` and
   `classes5.dex` of the debug APK, and in `classes.dex` of the release
   and the preview APK, which R8 had shrunk.
3. With the class removed, all three passed.

That first probe happened to be a class that R8 left as it was. The
second test, on the same day for pull request 25, used one that R8 folds
away:

1. Catalog got a temporary class `com.google.android.gms.Probe` with one
   small function, and its activity used the result.
2. Without the R8 rule: `assembleDebug` failed in its APK rules check
   and named the class. `assembleRelease` and `assemblePreview`
   **passed**. R8 had folded the class into the activity, so no class of
   that package was named in the APK any more.
3. With the R8 rule: `assembleDebug`, `assembleRelease` and
   `assemblePreview` each failed in their APK rules check and named the
   class: in `classes6.dex` and `classes7.dex` of the debug APK, and in
   `classes.dex` of the release and the preview APK.
4. With the use removed and only the class left, `assembleRelease` still
   failed and named the class.
5. With the class removed, all three passed.
6. The release APK of Catalog is the same, byte for byte, with and
   without the R8 rule (SHA-256 compared). In an app with no Play
   services class the rule matches nothing.

CI runs `checkReleaseApkRules` by name for every app, and checks that its
report was written. So removing the check from the build, or turning it
off, fails CI ([ci.md](ci.md#job-check)).

### The test fixtures rule

The owner asked for rule 5 in Phase 1, step 5. The test fixtures of
`core/crypto` hold a stand-in for the Android Keystore that keeps keys in
memory ([Test fixtures](#test-fixtures)). It is for tests only and must
never be in an app.

1. The rule searches the bytes of every dex file for
   `Lapp/shkriuss/core/crypto/fixtures/` and names each class it finds,
   the same way as the Play services class rule.
2. One R8 rule goes with it, in `build-logic/r8/app-rules.pro`:
   `-keep class app.shkriuss.core.crypto.fixtures.** { *; }`. It makes
   sure such a class keeps its name in a `release` and a `preview` APK,
   so that the check can see it. Why it is needed is in "How it was
   tested".
3. In an app with no fixtures, the R8 rule matches nothing. The release
   APK of Catalog is the same, byte for byte, with and without it
   (SHA-256 compared on 2026-11-12).
4. An app that only depends on the fixtures and never calls them fails
   too. The R8 rule keeps the classes, where R8 would have dropped them.
   A dependency on the fixtures outside tests is always a mistake.
5. The rule is for app APKs. It does not run for test APKs. The test APK
   of `core/crypto` holds the stand-in, because a test that runs on the
   JVM and on the emulator uses it. Only CI installs that APK, on an
   emulator. The owner decided to leave that as it is.

How it was tested, on 2026-11-12 in the cloud environment:

1. Catalog got a temporary dependency on the fixtures,
   `implementation(testFixtures(project(":core:crypto")))`, and one call
   to them in its activity.
2. First try, without the R8 rule. `assembleDebug` failed in its APK
   rules check and named `SoftwareHardwareKeys` and `SoftwareKeysApp`.
   `assembleRelease` and `assemblePreview` **passed**. R8 had folded the
   two classes into other classes. No class of the fixtures package was
   named in the APK any more, but the code of the stand-in was in it:
   its own error messages were in the dex file.
3. Second try, with the R8 rule. `assembleDebug`, `assembleRelease` and
   `assemblePreview` each failed in their APK rules check and named the
   two classes: in `classes2.dex` and `classes6.dex` of the debug APK,
   and in `classes.dex` of the release and the preview APK.
4. With the call removed and only the dependency left, `assembleRelease`
   still failed and named the two classes.
5. With the probe removed, all three passed.

What step 2 showed is true for every rule that finds classes by name:
"never rename" is not enough. R8 can fold a class into another one, and
then the name of the first is gone. The Play services class rule reads
names the same way. So the owner decided on pull request 25 that it gets
an R8 rule of its own
([The Play services class rule](#the-play-services-class-rule)).

### The backup rule

Rule 6. [crypto-design.md](../security/crypto-design.md) asks every app
to turn Android's own backup and device transfer off ("Where keys are
stored", point 1). The owner asked for this check in step 1.9
([threat model](../security/threat-model.md#found-while-writing-this-page),
point 1). It reads what ships: the APK itself, not the source files.

What it reads, from each APK:

1. The compiled `AndroidManifest.xml`. In `<application>`:
   - `android:allowBackup` must be the literal `false`. If it is
     missing, the rule fails: Android's default is `true`. A value taken
     from a resource fails too. On Android 12 and later this attribute
     stops cloud backup only, not a transfer to a new device.
   - `android:backupAgent` must not be set.
   - `android:dataExtractionRules` must name an XML resource. On
     Android 12 and later only these rules turn device transfer off.
2. `resources.arsc`, the resource table. It lists every copy of that
   resource, one for each configuration, such as `xml` and `xml-v35`,
   with the file's path in the APK. A release APK keeps its files under
   short names, such as `res/0E.xml`. The table says which is which.
3. Every copy of the rules file. Each must have:
   - the root `<data-extraction-rules>`,
   - exactly one `<cloud-backup>` and one `<device-transfer>`, and
     nothing else. So `<cross-platform-transfer>` fails. Since
     Android 16 QPR2, that section lets an app opt in to a transfer to
     another platform, such as an iPhone,
   - in each section, only `<exclude>`, with
     `<exclude domain="..." path="."/>` for each of the nine domains:
     `root`, `file`, `database`, `sharedpref`, `external`,
     `device_root`, `device_file`, `device_database` and
     `device_sharedpref`.

Why the APK and not the source folders: a library can bring its own copy
of the rules file for one configuration, for example `xml-v36`. The build
keeps it next to the app's copy, and Android 16 would use it. No source
folder of the app holds it. The APK holds every copy.

How it reads them: the APK holds the manifest and the rules as binary
XML, and the resource table in a binary format of its own.
`ApkResourceReader.kt` reads both. It follows AOSP's `ResourceTypes.h`
and needs no library. A file or a layout it cannot read fails the check
with a message, so the rule never passes by reading nothing.

It does not read `android:fullBackupContent`. Android uses it only on
Android 11 and older, and the minimum is Android 13.

The rule runs on every APK, `debug` too. Catalog passes: its manifest and
`res/xml/data_extraction_rules.xml` turn everything off.

How it was tested, on 2026-11-13 in the cloud environment. Each of these
temporary changes to Catalog failed the check, which named the app and
the attribute or the file. With each change undone, all three variants
passed.

1. `android:allowBackup="true"`. The release and the debug check each
   said "android:allowBackup is true. It must be false".
2. `android:allowBackup` removed.
3. `android:dataExtractionRules` removed.
4. The `<exclude>` of the domain `external` removed from
   `<device-transfer>`.
5. A `<cross-platform-transfer platform="ios">` section added.
6. A second copy in `res/xml-v35/` with an `<include>`. The debug check
   named `res/xml-v35/data_extraction_rules.xml`. The release check
   named `res/L6.xml`, the short name of the same file in the release
   APK. Lint also refused that file in a release build. For this one
   probe, the release check ran with lint left out, to see the check
   itself.
7. `android:backupAgent` set.

The [tests of the build checks](#tests-of-the-build-checks) cover each
of these, and more, on every pull request.

### The WebView and code loading rules

Rules 7, 8 and 9. Hard rule 1 and
[ADR 0019](../adr/0019-no-webview-no-runtime-code-loading.md): no
WebView, no code loaded at run time. The owner asked for them in step 1.9
([threat model](../security/threat-model.md#found-while-writing-this-page),
point 2).

1. Rule 7, WebView: every class of `android.webkit`, of `androidx.webkit`
   (AndroidX WebKit) and of `org.mozilla.geckoview` (GeckoView, another
   web engine). Two classes of `android.webkit` are allowed, by the
   owner's decision in step 1.9: `MimeTypeMap` and `URLUtil`. They only
   turn text into text and need no WebView. `FileProvider` in
   `androidx.core` uses `MimeTypeMap`.
2. Rule 8, class loaders that read code from a file, from memory or from
   the network: `dalvik.system.DexClassLoader`, `PathClassLoader`,
   `InMemoryDexClassLoader`, `DelegateLastClassLoader`,
   `BaseDexClassLoader` and `DexFile`, and `java.net.URLClassLoader`,
   with their nested classes. A class that extends one of them names it
   as its superclass, so it is caught too.
3. Rule 9, calls that load native code from any path, or run a program:
   `System.load`, `Runtime.load`, `Runtime.exec` and
   `ProcessBuilder.start`. `loadLibrary` is not on the list, by the
   owner's decision in step 1.9. It loads only from the APK's own library
   folder, which rule 2 keeps empty. Compose's graphics-path library
   calls it (see "What today's APKs hold" below).

How rules 7 and 8 search: every dex file is searched for each name in
two forms.

- As a class the dex file names, such as `Landroid/webkit/WebView;`. This
  is the search of [the Play services class rule](#the-play-services-class-rule).
- As dotted text, such as `dalvik.system.DexClassLoader`. That is the
  form code uses to load a class by its name, with `Class.forName`. The
  byte before a match is not looked at, because in a dex file it is often
  the length of the string, which can be any letter. So a longer name
  that ends the same way also fails. That can fail a build that need not
  fail, but it never passes one that must.

All these classes belong to Android or Java and are never inside an APK.
R8 cannot rename them or fold them away, so no R8 rule is needed.

How rule 9 searches: `DexMethodReferences.kt` reads the dex file's table
of method references. A method that code calls is always in that table,
so the table decides pass or fail. The reader reads nothing else. To name
the class that makes the call, it would have to read the instructions of
every method, so it leaves the caller out (owner's decision in step 1.9).
The failure message says how to find it: in a cloud session, run the
SDK's `dexdump -d` on that dex file and search for the method. A dex file
the reader cannot read, such as a newer format, fails the check.

Where they run: only on the APKs that ship, every build type but
`debug`, so `release` and `preview` today (owner's decision in step
1.9). R8 has shrunk those APKs, so they hold only code an app can run. A
`debug` APK holds every class of every library, used or not.

What today's APKs hold. Before the rules were written, Catalog's three
APKs were searched on 2026-11-13 with the SDK's `dexdump` and a search of
the dex bytes:

| APK | WebView and class loaders | Calls that load or run code |
|---|---|---|
| release | None | `System.loadLibrary` in the static block of `androidx.graphics.path.PathIteratorPreApi34Impl` |
| preview | None | The same |
| debug | `android.webkit.WebView`, in `androidx.core.text.util.LinkifyCompat.findAddress` (`androidx.core`). `android.webkit.MimeTypeMap`, in `androidx.core.content.FileProvider`. `dalvik.system.ZipPathValidator$Callback`, a stub that D8 adds by itself for a class of Android 14. It is no class loader. | `System.loadLibrary` in the static block of `androidx.graphics.path.PathIteratorImpl` |

No APK called `System.load`, `Runtime.load`, `Runtime.loadLibrary`,
`Runtime.exec` or `ProcessBuilder.start`. The graphics-path library is
left out of every APK, and the graphics-path check fails the build if any
code can reach it ([Native code from Compose](#native-code-from-compose)).

Limits:

- `Context.createPackageContext` with `CONTEXT_INCLUDE_CODE` gives code
  of another app. It is caught only if the code then names one of the
  class loaders.
- `ClassLoader.defineClass` cannot load code on Android. It throws there.
- A class name put together from pieces at run time is not text in the
  dex file.

How it was tested, on 2026-11-13 in the cloud environment:

1. Catalog got a temporary file with one function, called from its
   activity, that made a `WebView`, made a `DexClassLoader`, loaded
   `dalvik.system.InMemoryDexClassLoader` by its name with
   `Class.forName`, and called `Runtime.exec`.
2. The release and the preview check each failed and named all four:
   the class `android.webkit.WebView` (rule 7), the class
   `dalvik.system.DexClassLoader` (rule 8), the name
   `dalvik.system.InMemoryDexClassLoader` as text (rule 8), and a call to
   `java.lang.Runtime.exec` (rule 9).
3. The debug check passed, as decided.
4. With the file removed, all three passed.

## Native code from Compose

Compose UI depends on `androidx.graphics:graphics-path`. That library
ships a small JNI library, `libandroidx.graphics.path.so`. Hard rule 2
allows no native code outside Grammar.

### The decision

The owner decided on
[pull request 5](https://github.com/shkriuss/shkriuss.app/pull/5) to leave
the JNI library out, with no second exception. Reasons:

- The plan allows no C or C++.
- GrapheneOS turns memory tagging on by default only for user-installed
  apps without native libraries.

It is recorded in
[ADR 0011](../adr/0011-no-native-code-grammar-exception.md), point 4.

### What the build does

1. It leaves the library out of every APK (`packaging.jniLibs.excludes`).
2. The APK rules check fails the build if any `.so` file gets in.
3. The graphics-path check fails the build if any code could load the
   library. See below.

### Why leaving it out works, and the risk

Compose loads the library only when code walks through the segments of a
`Path`. That happens through `Path.iterator()`, `PathEasing`,
`PathHitTester`, and the helpers `computeDirection()`, `divide()`,
`reverse()` and `toSvg()`. In the Compose versions used now, no Compose
UI, Foundation, Material 3 or Animation code calls these itself, and no
module in this project does.

If any code did, the app would crash with `UnsatisfiedLinkError` on every
Android version. The library's loader runs even on Android 14 and later,
where the library is not used. The graphics-path check turns that crash
into a build failure.

### The graphics-path check

The task `check<Variant>GraphicsPathUse` reads every class the app runs:
the app's own classes, every module and every library. It runs before
every `assemble` task, and the `debug` one also runs in `check`.

1. A class fails the check if it refers to the package
   `androidx.graphics.path`, or to one of these:
   - `androidx.compose.ui.graphics.PathIterator`
   - `androidx.compose.ui.graphics.AndroidPathIterator`
   - `androidx.compose.ui.graphics.PathHitTester`
   - `androidx.compose.ui.graphics.PathGeometryKt` (`computeDirection()`,
     `divide()`, `reverse()`)
   - `androidx.compose.ui.graphics.PathSvgKt` (`toSvg()`, `addSvg()`)
   - `androidx.compose.animation.core.PathEasing`
2. Only the classes that define these may refer to them: the classes
   themselves, their nested classes, the package `androidx.graphics.path`,
   and five classes in Compose that belong to the same definitions:
   - `Path` and `Path$DefaultImpls`, which declare `Path.iterator()`.
   - `AndroidPathIterator_androidKt` and its `$WhenMappings`, from the same
     source file as `AndroidPathIterator`. They hold the `PathIterator(...)`
     factory.
   - `PathHitTesterKt`, from the same source file as `PathHitTester`. It
     holds the `PathHitTester(...)` factory.

   Code that calls one of those five still names `PathIterator` or
   `PathHitTester` in its own class file, because a JVM method reference
   carries its return type. So that code is still caught. The owner
   confirmed this list on
   [pull request 5](https://github.com/shkriuss/shkriuss.app/pull/5).
3. The failure message lists each class and what it refers to, and says to
   stop and ask the owner. Never add the library back, change the check, or
   work around it to make a build pass.

The report is written to `build/reports/graphics-path-use/`. In Phase 0 it
checked 11,630 classes for each Catalog variant.

CI runs `checkReleaseGraphicsPathUse` by name for every app, and checks
that its report was written, as for the APK rules check
([ci.md](ci.md#job-check)).

How it was tested:

1. A temporary file in Catalog walked through a `Path` and built a
   `PathEasing`. `assembleDebug` failed and named both uses.
2. A temporary file in `core/design` built a `PathHitTester`.
   `assembleRelease` failed and named it.
3. With both files removed, all three variants passed.

## Entries removed from library manifests

Libraries add entries to every app's manifest. Catalog's manifest removes
two:

1. **A permission from `androidx.core`**,
   `<app ID>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. `androidx.core`
   uses it only on Android 12 and older. The minimum is Android 13, so it is
   never used.
2. **The emoji font loader from `androidx.emoji2`**. At start-up it looks
   for a downloadable emoji font from a system font provider. On most
   phones that provider is Google Play services. Android 13 and later have
   their own emoji font.

Every new app must remove the same two. The APK rules check fails until it
does.

## Known messages in the build log

- "Warning: ... was tagged at AndroidManifest.xml to remove other
  declarations but no other declaration present". This comes from the
  manifest made for unit tests, where the two removed entries above do not
  exist. It is harmless.
- "Unable to strip the following libraries ... libandroidx.graphics.path.so".
  AGP prints this before the library is left out of the APK.

## Open

Nothing open. The last item, attaching the R8 mapping file to every
release, was done in Phase 0, step 6. See
[The mapping file](#the-mapping-file).
