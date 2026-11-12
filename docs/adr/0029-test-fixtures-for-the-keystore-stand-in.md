# 0029 Test fixtures for the Keystore stand-in

- Status: Accepted
- Date: 2026-11-12
- Source: the owner's decisions in the planning session of Phase 1,
  step 5 ([PROMPTS.md](../development/PROMPTS.md)) and in that session
  after it, for
  [pull request 25](https://github.com/shkriuss/shkriuss.app/pull/25)

## Context

- Unit tests run on the JVM, where no Android Keystore exists. So
  `core/crypto` takes its hardware keys through an interface, and its
  tests pass a stand-in that keeps ordinary keys in memory
  ([crypto-design.md](../security/crypto-design.md#what-the-tests-must-cover)).
- The stand-in, and everything needed to build the module's entry point
  with it, is `internal` to `core/crypto`. Until this step it sat among
  the tests of `core/crypto`, and no other module could reach it.
- The tests of `core/backup` must encrypt and decrypt real backup
  streams. A file cut short, one changed byte and a wrong recovery key
  are refused by the real encryption. A fake in its place would only
  test the fake. Feature modules will need real keys in their tests too.
- A stand-in that keeps keys in memory must never be part of an app.
- No library may be added without a decision record, and the dependency
  verification file is owner-only ([0020](0020-dependency-verification.md)).

## Decision

1. `core/crypto` has Gradle test fixtures, in `src/testFixtures/`. The
   convention plugin `shkriuss.android.test-fixtures` turns them on.
2. The fixtures are one package of their own,
   `app.shkriuss.core.crypto.fixtures`. It holds two things and nothing
   else:
   - `SoftwareHardwareKeys`, the stand-in. It is `internal`.
   - `SoftwareKeysApp`, which is public. It builds a real `ShkCrypto` on
     the stand-in, for the unit tests of other modules.
3. Another module uses the fixtures only in its tests:
   `testImplementation(testFixtures(project(":core:crypto")))`.
4. The stand-in is never in an app APK. The APK rules check fails an app
   APK whose dex files name a class of that package. The owner asked for
   this rule.
   - One R8 rule goes with it, in the rules every app shares: classes of
     that package are kept as they are. Without it the check missed
     release and preview APKs. R8 had folded the fixture classes into
     other classes, so their names were gone while their code was in
     the APK. With it, a fixture class that reaches an app keeps its
     name and the check fails the build.
   - In an app that has no fixtures, the R8 rule matches nothing and
     the APK is the same, byte for byte.
5. The rule covers app APKs only. Test APKs are not covered. The test
   APK of `core/crypto` holds the stand-in, as it did before, because a
   test that runs on the JVM and on the emulator uses it. Only CI
   installs that APK, on an emulator.
6. The fixtures add no library.

## Options rejected

- **A debug-only source folder in `core/crypto`.** It needs no change to
  the build. But a debug build of an app would then contain the
  stand-in. The owner decided it must never be in any app APK.
- **A public way to hand hardware keys to `core/crypto`.** Tests could
  then pass the stand-in from anywhere. But so could an app, by mistake.
- **A fake encryption in the tests of `core/backup`.** It would show how
  the backup code reacts to a refusal, and not that a damaged file is
  refused.
- **The backup tests inside `core/crypto`**, with a test dependency on
  `core/backup`. It needs no build feature. But it puts the tests of one
  module into another, and it does not help feature modules.
- **A module of test helpers for cryptography.** Another module cannot
  see the `internal` parts of `core/crypto` that the stand-in is made of.

## Consequences

- Android Gradle Plugin 9.5.1 still marks the test fixtures setting as
  incubating. What this project needs from it was checked in this step:
  - Kotlin code in `src/testFixtures/` compiles with no experimental
    flag.
  - It sees the `internal` declarations of the module.
  - The module's own unit tests and emulator tests see the `internal`
    stand-in in the fixtures.
  - No new file is downloaded, so the dependency verification file did
    not change.
- If a later version of the plugin changes any of this, the build
  fails. No app is affected, because fixtures are never in an app.
- The tests of `core/crypto` import the stand-in from its new package.
  Nothing else changed in them.
- A module that needs real keys in its unit tests adds the one line of
  point 3 and builds a `SoftwareKeysApp` on a temporary folder.
- The new rule reads class names in the dex files, like the rule for
  Play services classes. Both depend on the build never renaming classes
  ([build.md](../development/build.md#the-play-services-class-rule)).
- An app that only depends on the fixtures and never calls them fails
  too, because the R8 rule keeps the classes. Before, R8 would have
  dropped them without a word. A dependency on the fixtures outside
  tests is always a mistake, so that is wanted.
- How the rule was proven to fail, and what the first try showed, is in
  [build.md](../development/build.md#the-test-fixtures-rule).
- What the first try showed also holds for the Play services rule: R8
  can fold a class into another one even when it never renames. The
  owner decided on pull request 25 that the Play services rule gets an
  R8 rule of its own, and that the file of the R8 rules is owner-only
  from then on
  ([build.md](../development/build.md#the-play-services-class-rule)).
- An app's own test APK is not checked by the APK rules check. If an app
  module ever uses the fixtures in emulator tests, the stand-in is in
  that test APK, and never in the app.
