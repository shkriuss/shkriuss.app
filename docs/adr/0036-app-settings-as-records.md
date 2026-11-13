# 0036 An app's settings are records

- Status: Proposed
- Date: 2026-11-13
- Source: Phase 2, step 2.1, the specification of Water
  ([spec.md](../apps/water/spec.md#table-settings)). Water is the first
  app with settings of its own, so point 4 of
  [0004](0004-room-on-system-sqlite-no-sqlcipher.md) is decided again
  here, as [0032](0032-app-lock-settings-in-android-preferences.md)
  asked. Claude proposes this in the pull request of that step. The
  owner added on 2026-11-13 that the sync design decides which settings
  are per device.

## Context

- Point 4 of [0004](0004-room-on-system-sqlite-no-sqlcipher.md) says
  settings use DataStore, until the first app builds its own settings
  and the point is decided again.
- DataStore is not in the version catalog. Adding it needs a decision
  record and changes to the owner-only
  `android/gradle/verification-metadata.xml` (hard rules 5 and 6 in
  [CLAUDE.md](../../CLAUDE.md)).
- A backup holds records and files only. "A setting that must come back
  with a restore is stored as a record"
  ([backup-format.md](../architecture/backup-format.md#what-an-app-puts-in)).
- Water's settings are part of the user's data: the daily goal, the
  unit, the quick amounts, and when to remind. The user expects them back
  after a restore on a new phone.
- Some state belongs to one phone only. `core/notify` keeps its alarms
  and `core/security` keeps the app lock's settings in small files of
  Android's preferences
  ([0030](0030-how-core-notify-keeps-alarms.md),
  [0032](0032-app-lock-settings-in-android-preferences.md)).

## Decision

1. **Settings that are part of the user's data are records** in the
   app's Room database: a table with the four record fields and a change
   number, written through `RecordWriter`. They are in every backup, and
   later in sync.
2. **The record in use.** When an app keeps its settings in one record,
   the one in use is the record that is not deleted and has the latest
   `updatedAt`. Until the first change, the defaults in the code count.
   So a second settings record, from a restore or from sync, needs no
   special case.
3. **State of one phone stays on that phone**, in a small file of
   Android's preferences in the app's private storage, as 0030 and 0032
   do: for example when the last reminder was shown. It holds no user
   content, is in no backup and is never synced.
4. **No DataStore.** Point 4 of 0004 is decided by this record.
5. **Which settings are per device under sync** is for the sync design
   (step 5.1). For example, Water's reminder settings are a record, so
   with sync they would reach every device, and every device would
   remind.

## Options rejected

- **DataStore for all settings.** A new dependency and owner-only
  changes. A DataStore file is not in a backup, so the settings would
  not come back with a restore.
- **Android's preferences file for all settings.** The same: not in a
  backup, and not synced.

## Consequences

- An app's settings follow the record rules: a schema version, a
  migration and a migration test for each change, and a type in the
  backup with the app's data version.
- A restore brings the settings back, with the restore rule: the newest
  edit wins.
- On acceptance, the status of
  [0004](0004-room-on-system-sqlite-no-sqlcipher.md) says that point 4 is
  superseded by this record, and the consequences of
  [0032](0032-app-lock-settings-in-android-preferences.md) point here.
- Step 5.1 decides which settings sync and which stay per device.
- Water is the first app that follows this record
  ([spec.md](../apps/water/spec.md#table-settings)).
