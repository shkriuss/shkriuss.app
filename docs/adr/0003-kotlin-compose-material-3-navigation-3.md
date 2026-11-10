# 0003 Kotlin, Compose, Material 3, Navigation 3

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 2 (decision 2), 3, 4 and 17

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

- **Java for new code.** Reason not recorded.
- **Kotlin Multiplatform.** Reason not recorded.
- **Cross-platform toolkits.** Reason not recorded.
- **XML views.** Reason not recorded.
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
- Open: exact versions are pinned in Phase 0.
- Open: Roborazzi rendering with the current Robolectric Android image. In
  a test, Robolectric 4.17 ran on its Android 17 image with JDK 21 only
  after adding the test JVM flags
  `--add-opens=java.base/java.io=ALL-UNNAMED` and
  `--add-exports=java.base/jdk.internal.access=ALL-UNNAMED`. Check whether
  both are still needed, and whether a newer release removes the need
  (section 17).
