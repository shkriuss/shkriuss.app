---
paths:
  - "android/**"
---

# Rules for `android/`

These add to CLAUDE.md. They never replace it.

- Run Gradle from `android/`. Before you push, run `./gradlew check` and
  `./gradlew verifyRoborazziDebug`.
- All module build config lives in `build-logic/` convention plugins.
- Repositories are `google()` and `mavenCentral()` only. No project
  repositories. Never add the cloud-only Maven mirror to the project.
- A dependency change updates `gradle/libs.versions.toml` and
  `gradle/verification-metadata.xml` together, and a new dependency needs an
  ADR. Stay within the stack that the version catalog holds and the
  decision records in `docs/adr/` decided.
- `gradle/verification-metadata.xml` and `gradle/wrapper/` are owner-only.
  Change them only when the owner asks for exactly that change.
- Min SDK 35. Target and compile SDK 37.
- Room runs on the system SQLite through `AndroidSQLiteDriver`. No bundled
  SQLite, no SQLCipher, no EncryptedSharedPreferences.
- Only `app/sync` declares `android.permission.INTERNET`. A new permission
  updates `docs/security/permissions.md` in the same pull request.
- Native code only in `app/grammar`, under its ADR.
- A database schema change bumps the version, adds a migration and its test,
  and commits the exported schema JSON.
- A new or changed screen needs screenshot tests in the four standard
  configurations: phone light at font scale 1.0, phone dark at 2.0, tablet
  light at 2.0, tablet dark at 1.0.
- Never log user content.
