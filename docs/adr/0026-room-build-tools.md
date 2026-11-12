# 0026 Room's build tools and committed schemas

- Status: Accepted
- Date: 2026-11-12
- Source: the owner's prompt for Phase 1, step 3
  ([PROMPTS.md](../development/PROMPTS.md)), in which the owner asked to
  add Room and what it needs to the version catalog, and to update the
  verification metadata and the keyring for it. It adds detail to
  [0004](0004-room-on-system-sqlite-no-sqlcipher.md).

## Context

- [0004](0004-room-on-system-sqlite-no-sqlcipher.md) decided on Room 3.0.3
  or newer with `AndroidSQLiteDriver`. Room needs more than its runtime
  library to work.
- Room 3 generates its code with Kotlin Symbol Processing (KSP) only. Its
  compiler ships no Java annotation processor.
- Room writes the schema of each database version to a JSON file. Its
  Gradle plugin copies that file into the module during every build,
  over the file that is committed.
- Hard rule 5 in [CLAUDE.md](../../CLAUDE.md) asks for a record before
  any new dependency.

## Decision

1. These are added to the version catalog:
   - `androidx.room3:room3-runtime` 3.0.3, the runtime.
   - `androidx.sqlite:sqlite-framework` 2.7.1, which holds
     `AndroidSQLiteDriver`. It is the version Room 3.0.3 asks for.
   - `androidx.room3:room3-compiler` 3.0.3, the code generator. Build
     time only.
   - `androidx.room3:room3-gradle-plugin` 3.0.3, which passes the schema
     folder to the compiler. Build time only.
   - `com.google.devtools.ksp:symbol-processing-gradle-plugin` 2.3.13,
     which runs the compiler. Build time only.
   - `androidx.room3:room3-testing` 3.0.3, for migration tests. Tests only.
2. A new convention plugin, `shkriuss.android.room`, applies KSP and
   Room's Gradle plugin to a module, and adds the runtime, the driver,
   the compiler and the test library. KSP's warnings are errors.
3. The schema files are committed in `schemas/` of each module that has a
   database. Room's copy into that folder is turned off. Instead:
   - `checkRoomSchemas` runs in `check` and fails if the code produces a
     schema that is not committed exactly as it is.
   - `recordRoomSchemas` writes the files, to commit them.
4. The bundled SQLite driver, `androidx.sqlite:sqlite-bundled`, is refused
   in every module. Resolving it fails the build.

## Options rejected

- **kapt or Java annotation processing.** Room 3 does not support them.
- **Room's own schema copy.** It changes committed files during the
  build. A schema change without a new version, or a file nobody
  committed, would pass CI. The migration tests would then test a schema
  that is not in the repository.
- **Passing the schema folder to KSP by hand, without Room's Gradle
  plugin.** Room 3's compiler takes the folder through the options
  `room.internal.schemaInput` and `room.internal.schemaOutput`, which its
  plugin sets. Setting them by hand would depend on Room's internals.

## Consequences

- KSP and Room's compiler run only on the build machine. Nothing from them
  is in an APK. Room's compiler uses `org.xerial:sqlite-jdbc`, which
  carries native SQLite libraries for the build machine, to check queries
  while it compiles. Hard rule 2 is about the apps, so this is allowed.
- Each new dependency is checked by dependency verification
  ([0020](0020-dependency-verification.md)). The new keys and checksums
  are in the same pull request.
- A schema change follows the steps in
  [data.md](../architecture/data.md#how-to-change-a-schema). CI fails
  until the new schema file is committed.
- KSP's version is no longer tied to Kotlin's. A Kotlin update does not
  force a KSP update, but both are checked in the monthly update (prompt
  R5 in [PROMPTS.md](../development/PROMPTS.md)).
- `CheckRoomSchemasTask.kt` and `AndroidRoomConventionPlugin.kt` in
  `build-logic` hold the check. Open: whether the owner adds them to
  [CODEOWNERS](../../.github/CODEOWNERS), like the other build checks.
