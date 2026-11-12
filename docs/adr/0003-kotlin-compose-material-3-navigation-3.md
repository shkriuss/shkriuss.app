# 0003 Kotlin, Compose, Material 3, Navigation 3

- Status: Accepted. Point 2's "adaptive libraries" superseded by
  [0024](0024-own-adaptive-layouts.md).
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 2 (decision 2), 3, 4 and 17,
  and the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4)

## Context

- The suite uses no Google Play services, Firebase, analytics, ads or
  trackers (section 1).
- Decision 2 says what that means for libraries. AndroidX, Compose and
  Kotlin libraries are allowed. "No Google" means no Google services.
- Nothing else is used at runtime without a decision record (section 3).
- The versions below were checked in November 2026. Exact versions are
  pinned in Phase 0.

## Decision

1. Language: Kotlin 2.4.x.
2. UI: Jetpack Compose through the Compose BOM, Material 3 and its adaptive
   libraries, and Navigation 3.
   - The adaptive libraries are not used: `core/design` builds its own
     adaptive layouts ([0024](0024-own-adaptive-layouts.md), owner
     decision on
     [pull request 16](https://github.com/shkriuss/shkriuss.app/pull/16)).
   - Open: whether the apps use Navigation 3 is decided when the first
     app is built (the same decision).
3. Only `core/design` uses Material 3 directly. Apps use the `Shk*`
   components (section 4).
4. Other libraries:
   - kotlinx.coroutines and kotlinx.serialization.
   - WorkManager, in the Sync app only.
   - AndroidX Biometric, for the app lock.
5. Build: the latest stable Android Gradle Plugin (9.5.1 on 2026-11-10),
   with the Gradle version it needs through the wrapper (9.6.0 worked in a
   test build), and JDK 21.
6. Tests: JUnit, Robolectric, Roborazzi (screenshots on the JVM) and
   Compose UI tests.

This record also holds the parts of the stack in section 3 that have no
record of their own. Room and DataStore are in
[0004](0004-room-on-system-sqlite-no-sqlcipher.md). Tink is in
[0006](0006-tink-and-key-hierarchy.md). Hilt and Koin are in
[0012](0012-no-di-framework.md).

## Options rejected

- **Java for new code.** Compose needs Kotlin, and one language is simpler
  to maintain.
- **Kotlin Multiplatform.** There is no second platform.
- **Cross-platform toolkits.** They bundle their own native engines, which
  breaks the no-native-code rule
  ([0011](0011-no-native-code-grammar-exception.md)).
- **XML views.** A second UI toolkit to maintain. The adaptive and Material
  3 libraries the project uses are built for Compose.
- **Google's Compose Preview Screenshot Testing.** It is still
  experimental. Roborazzi is used instead.

## Consequences

- Material 3 imports stay inside `core/design`. Features use the `Shk*`
  components and tokens. See [0017](0017-design-system-tokens.md).
- WorkManager appears only in the Sync app.
- Any other runtime library needs its own record first. The same pull
  request updates `android/gradle/libs.versions.toml` and
  `android/gradle/verification-metadata.xml` (hard rule 5 in
  [CLAUDE.md](../../CLAUDE.md)).
- Exact versions were pinned in Phase 0, step 3, in
  `android/gradle/libs.versions.toml`: Android Gradle Plugin 9.5.1 with
  Gradle 9.6.1 (AGP 9.5.1 needs at least 9.6.0), Kotlin 2.4.21, Compose
  BOM 2026.09.00, Robolectric 4.17, Roborazzi 1.78.0. The list and the
  reasons are in [build.md](../development/build.md).
- Settled in Phase 0, step 3 (section 17): Roborazzi renders with
  Robolectric 4.17's Android 17 image on JDK 21. Only one test JVM flag is
  still needed, `--add-exports=java.base/jdk.internal.access=ALL-UNNAMED`.
  `--add-opens=java.base/java.io=ALL-UNNAMED` is not. No newer stable
  Robolectric exists yet; 4.18 is a beta.
- Compose UI tests need Espresso 3.7.0 or later on the Android 17 image,
  and Lifecycle 2.11.0 or later for its lint checks to load. Both are set
  as version constraints, not as new dependencies.
