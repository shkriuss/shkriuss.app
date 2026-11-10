# 0004 Room on system SQLite, no SQLCipher

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 2 (decisions 3 and 7), 3, 5
  and 17

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
4. Settings use DataStore.
5. Every record has `id` (random UUID), `createdAt`, `updatedAt` and
   `deletedAt`. Synced records are never hard-deleted.
6. The database schema carries a version number, a migration path and
   tests.

## Options rejected

- **SQLCipher.** Reason not recorded.
- **The bundled SQLite driver.** Reason not recorded. Note: section 3
  describes the chosen driver as "system SQLite, no bundled native code".

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
- Open: Room 3 transactions with `AndroidSQLiteDriver` are to be confirmed
  in Phase 0 (section 17).
