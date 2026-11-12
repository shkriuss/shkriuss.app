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
  ([third-party.md](third-party.md)).
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
  `CheckGraphicsPathUseTask.kt`,
- `AndroidApplicationConventionPlugin.kt`, which connects both checks to
  the build.
- the two checks of the record rules, `CheckRoomSchemasTask.kt` and
  `CheckDaoRulesTask.kt`, and `AndroidRoomConventionPlugin.kt`, which
  connects them to the build (owner's decision on pull request 21),
- `AndroidCommon.kt`, the settings every module shares, which refuse the
  bundled SQLite driver (owner's decision on pull request 21).

## Commands

Claude runs these from `android/`. The same list is in
[CLAUDE.md](../../CLAUDE.md).

| Command | What it does |
|---|---|
| `./gradlew check` | Unit tests and Android Lint for all modules. |
| `./gradlew :app:<name>:assembleDebug` | Builds one app. |
| `./gradlew verifyRoborazziDebug` | Compares screenshots with the committed ones. |
| `./gradlew recordRoborazziDebug` | Records screenshots again after an intended UI change. |
| `./gradlew recordRoomSchemas` | Writes the database schema files after a schema change, to commit them. |
| `./gradlew checkRoomSchemas` | Checks that the committed schema files match the code. Part of `check`. |
| `./gradlew checkDaoRules` | Checks that DAOs only read and that only `RecordWriter` writes records. Part of `check`. |
| `./gradlew :app:<name>:assembleRelease` | Builds the unsigned release APK. |
| `./gradlew :app:<name>:assemblePreview` | Builds the unsigned preview APK. |
| `./gradlew :core:crypto:assembleDebugAndroidTest` | Builds a module's test APK for the emulator. It checks that the instrumented tests compile. The tests themselves run only in CI ([emulator-tests.md](emulator-tests.md)). |

The commands after a dependency change are in
[After a dependency change](#after-a-dependency-change).

CI runs `./gradlew check verifyRoborazziDebug` together with
`:app:<name>:checkReleaseApkRules` and
`:app:<name>:checkReleaseGraphicsPathUse` for every app. See
[ci.md](ci.md#job-check).

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
| `shkriuss.android.application` | Apps: SDK levels, build types, lint, warnings as errors, reproducible-build settings, the APK rules check and the graphics-path check. |
| `shkriuss.android.library` | Libraries: SDK levels, lint, warnings as errors. |
| `shkriuss.android.compose` | Compose compiler, Compose BOM, Compose test library. |
| `shkriuss.android.unit-test` | JUnit 4 and Robolectric, offline. |
| `shkriuss.android.screenshot-test` | Roborazzi. Applies the unit-test plugin too. |
| `shkriuss.android.instrumented-test` | Tests on an emulator, in `src/androidTest/`: the project's own test runner, JUnit 4 and `core/testing`. Tests in `src/sharedTest/` run on the JVM and on the emulator ([emulator-tests.md](emulator-tests.md), [ADR 0028](../adr/0028-instrumented-tests-own-runner-and-shell-steps.md)). |
| `shkriuss.android.room` | Room 3 on the system SQLite: KSP, Room's Gradle plugin, the runtime, the driver and the test library. The schema check and record tasks ([Room schemas](#room-schemas)) and the [DAO rules check](#dao-rules-check). |

Every module refuses the bundled SQLite driver, `androidx.sqlite:sqlite-bundled`.
Resolving it fails the build, with a message that names hard rule 2. The
setting is in `AndroidCommon.kt`.

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
- `core/crypto` has 19 test classes with 148 tests. They are the items 1
  to 8 of "What the tests must cover" in
  [crypto-design.md](../security/crypto-design.md#what-the-tests-must-cover),
  and the rules for hardware keys.
  - No Android Keystore exists on the JVM. So the tests pass a software
    stand-in for the hardware keys, `SoftwareHardwareKeys`, with the same
    byte layout. It can act like a phone that is locked, a Keystore that
    fails for a moment, a key that is gone and a screen lock that was
    removed. `StoppingStore` lets a test stop the app before any change
    to a keyset file, and start it again.
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
    the emulator, where Tink takes its Android path.
  - Most of these tests need no Robolectric. Those that build the object
    for the system prompt, read Android's log or build a key's settings
    run under it.
- Catalog has `CatalogScreenTest`. It starts the app's activity and checks
  the title is a heading, which is what TalkBack announces, that every page
  has a button at least 48 dp tall, that each page opens and back returns,
  and what TalkBack hears for a contrast.
- Catalog also has `ComponentPagesTest`. It opens each component page and
  checks the components where they sit: labels and roles, touch targets
  that do not overlap, the disabled states, the components to try, the
  section headers as headings, the loading state as "in progress", and
  the loading and error states to try as polite live regions.

### Instrumented tests

Tests that need a real Android run on an emulator, in the job "Emulator"
of CI. Today those are the tests of the hardware keys in `core/crypto`.
They cannot run in a cloud session, which has no emulator. What they
are, how they run and what they found is in
[emulator-tests.md](emulator-tests.md).

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

## Lint

1. Android Lint runs in `check`. Warnings are errors.
2. Lint findings are fixed, not hidden. One single line is suppressed, with
   its reason next to it: `MissingClass` on
   `androidx.startup.InitializationProvider` in Catalog's manifest. The
   class comes from a library Compose uses only at run time, so lint cannot
   see it. It is in the APK.
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
   at all.

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
3. The same rule runs on the preview APK of every pull request, and on a
   debug APK whenever one is built. R8 never touches a debug APK. CI
   itself builds only `release` and `preview`.

Its limits:

- It depends on `-dontobfuscate`. A comment next to that line in
  `build-logic/r8/app-rules.pro` says so. If renaming is ever turned on,
  the rule must read the classes before R8 instead, as the
  [graphics-path check](#the-graphics-path-check) does. That needs
  `AndroidApplicationConventionPlugin.kt`, which is owner-only.
- R8 removes code that nothing uses. A Play services library that is
  added but never called leaves no class in a release APK. Then the APK
  holds none, which is what the rule asks. The debug APK still holds it.

How it was tested, on 2026-11-12 in the cloud environment:

1. Catalog got a temporary class `com.google.android.gms.Probe`, used by
   its activity.
2. `assembleDebug`, `assembleRelease` and `assemblePreview` each failed in
   their APK rules check and named the class: in `classes4.dex` and
   `classes5.dex` of the debug APK, and in `classes.dex` of the release
   and the preview APK, which R8 had shrunk.
3. With the class removed, all three passed.

CI runs `checkReleaseApkRules` by name for every app, and checks that its
report was written. So removing the check from the build, or turning it
off, fails CI ([ci.md](ci.md#job-check)).

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
