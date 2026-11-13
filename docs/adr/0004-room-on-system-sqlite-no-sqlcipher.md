# 0004 Room on system SQLite, no SQLCipher

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 2 (decisions 3 and 7), 3, 5
  and 17, and the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4)

## Context

- Every app works fully with no account and no network (section 1). Its
  data lives on the device.
- Grammar is the only app with native code (decision 7, and
  [0011](0011-no-native-code-grammar-exception.md)).

## Decision

1. Databases use Room 3.0.3 or newer with `AndroidSQLiteDriver`. That is
   the system SQLite, with no bundled native code.
2. Database rows rely on Android's file-based encryption.
3. Files, attachments, backups and sync data are encrypted by the app. See
   [0006](0006-tink-and-key-hierarchy.md).
4. Settings use DataStore. The settings of the app lock are an
   exception, in Android's preferences file, until the first app builds
   its own settings and this point is decided again
   ([0032](0032-app-lock-settings-in-android-preferences.md)).
5. Every record has `id` (random UUID), `createdAt`, `updatedAt` and
   `deletedAt`. Synced records are never hard-deleted.
6. The database schema carries a version number, a migration path and
   tests.

## Options rejected

- **SQLCipher.** It is a C library loaded through JNI. The cost is
  accepted: the app lock is an access gate for database rows, not
  encryption.
- **The bundled SQLite driver.** It ships its own SQLite and calls it
  through JNI.

## Consequences

- The app adds no encryption of its own to database rows. Their protection
  is Android's file-based encryption.
- The optional app lock can only gate access to database rows. The user
  guide must say so honestly (step 1.7 in
  [PROMPTS.md](../development/PROMPTS.md)).
- A delete only sets `deletedAt`.
- A schema change bumps the version, adds a migration and a migration test,
  and commits the exported schema JSON ("Changing formats" in
  [CLAUDE.md](../../CLAUDE.md)).
- Room 3 transactions with `AndroidSQLiteDriver`, open in section 17, were
  confirmed in Phase 1, step 3: DAO calls inside a write transaction run
  in it, and a failure rolls all of them back (`RecordWriterTest` in
  `core/data`).
- Room's build tools and the committed schema files are in
  [0026](0026-room-build-tools.md). How the four record fields are stored
  and stamped is in [0027](0027-record-fields-and-stamping.md). Both are
  described in [data.md](../architecture/data.md).
