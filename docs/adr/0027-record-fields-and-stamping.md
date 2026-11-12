# 0027 How the record fields are stored and stamped

- Status: Accepted
- Date: 2026-11-12
- Source: proposed in Phase 1, step 3 ([PROMPTS.md](../development/PROMPTS.md)),
  and the owner's decisions on
  [pull request 21](https://github.com/shkriuss/shkriuss.app/pull/21): the
  proposal accepted except its point 6, which the owner replaced with the
  change number, and the owner's answers on the same pull request that
  widened point 8. It adds detail to point 5 of
  [0004](0004-room-on-system-sqlite-no-sqlcipher.md).

## Context

- Every record has `id` (random UUID), `createdAt`, `updatedAt` and
  `deletedAt`. Synced records are never hard-deleted (0004, and section 5
  of the [plan](../plan/PLAN.md)).
- How the fields are stored becomes part of every schema, every backup
  and, later, every change-set. Changing it later means a migration of
  every table.
- Sync will need to find what changed since a point
  ([PROMPTS.md](../development/PROMPTS.md), step 1.3). Conflicts are
  resolved per record, last writer wins, with deletion markers (plan
  section 7). The sync design itself comes in Phase 5.
- The device's clock can be set back. A reader that finds changes by time
  could then miss one.
- Tests must control the clock and the IDs (0012).

## Decision

1. `id` is `TEXT NOT NULL` and the only primary key column. It holds a
   version 4 UUID in its 36-character lower-case form.
2. `createdAt`, `updatedAt` and `deletedAt` are `INTEGER`, in milliseconds
   since 1970-01-01T00:00:00Z. `deletedAt` is null while the record is not
   deleted. The other two are `NOT NULL`.
3. Each record table also has `changeNumber INTEGER NOT NULL`, with a
   unique index on it. There is no index on `updatedAt`. An app that needs
   one adds its own.
4. Entities embed the four fields of point 1 and 2 as one class,
   `RecordFields`, so the columns have the same names in every table. The
   change number is a column of its own, outside `RecordFields`.
5. All writes go through `RecordWriter`, which stamps the fields:
   - Create sets a new ID and both times to now.
   - Update, delete and restore move `updatedAt` forward. It becomes now,
     or one millisecond after the record's last `updatedAt` if that is
     later. So it never moves backwards for a record.
   - Delete sets `deletedAt`, and the row stays. Restore clears it.
   - A change that changes nothing writes nothing.
6. The change number:
   - Every write, create included, gets a change number inside the same
     write transaction.
   - It comes from one counter per database, the one-row table
     `change_counter`. It only goes up, and is never used twice, even
     after deleted records are purged. A number taken by a write that
     rolls back is free again: no reader ever saw it.
   - "Changed since" reads by change number, not by `updatedAt`.
     `updatedAt` stays for display and for last writer wins.
   - The change number is local. It is not part of a backup or of what
     sync sends. A restored or imported record gets a new one.
7. Times come from a `Clock`, and IDs from an `IdSource`, both passed
   through constructors.
8. A DAO only reads. A build check, `checkDaoRules`, fails when:
   - any DAO but `RecordDao` itself declares `@Insert` or `@Update`,
   - any DAO declares `@Delete`, `@Upsert`, `OnConflictStrategy.REPLACE`,
     or an `INSERT`, `DELETE`, `UPDATE` or `REPLACE` query,
   - any code but `RecordWriter` calls `rawInsert` or `rawUpdate`.

   One function per DAO may be marked `@PurgesDeletedRecords`, for a
   future purge of deleted records. There is no other exception. If a
   table that is not a record ever needs a write, the owner decides.
   Restoring a backup and importing from sync will get their own
   `RecordWriter` functions in their steps; they are no reason to allow
   direct writes.

## Options rejected

- **IDs as 16 bytes (`BLOB`).** Smaller, but harder to read in a test
  failure or a backup check. Plain text is easier to check from a phone.
- **`java.time.Instant` in the entities.** Every database would need a type
  converter, and the stored value would be the same number.
- **"Changed since" by `updatedAt`, then `id`.** This was the first
  proposal of point 6. The owner replaced it on pull request 21: a record
  changed while the clock was set back could sort before a position that
  a reader had already passed, and the reader would miss it.
- **The highest stored change number plus one.** It needs no counter
  table, but after a purge it would hand out a purged record's number
  again.
- **The change number inside `RecordFields`.** Backup and sync code would
  carry it along by accident. As its own column it stays out unless code
  names it.
- **SQLite triggers that refuse a `DELETE`.** Room does not know about
  triggers, so they are not in the schema files or the migration tests.
- **The `(updatedAt, id)` index of the first proposal.** It served only the
  first "changed since" query. The owner decided on pull request 21 not to
  keep it.
- **Allowing plain `@Insert` and `@Update` in feature DAOs.** They would
  skip the stamping and the change number. The owner decided on pull
  request 21 to refuse them.

## Consequences

- Every app database lists `ChangeCounter` among its entities. Every
  record table has the `changeNumber` column and its unique index.
- Each write runs two more statements on the counter row. That is small
  next to the write itself.
- Change numbers follow the order in which writes commit, because SQLite
  runs one write transaction at a time on a database file, also across
  processes. A reader that pages by change number therefore misses no
  write that commits while it reads. `ChangedSinceTest` checks this.
- A stored "last change number read", such as the one sync will keep,
  must live in the same database as the records. If the database file
  were ever made new, numbering would start again from 1.
- Each table's DAO declares its own `find` and `changedSince` queries,
  because Room needs the table name written out. The shared SQL is in
  `RecordSql.CHANGED_SINCE`.
- `checkDaoRules` reads compiled classes. It cannot see SQL that code runs
  outside a DAO, through a connection. `RecordWriter`'s counter SQL is the
  one such use today. It checks the modules that have a database, so a
  call to `rawInsert` or `rawUpdate` from an app module is not checked.
- The conventions check of `core/testing` checks points 1 to 3 and the
  counter table for every database's newest schema. The migration tests
  check that change numbers and the counter survive each migration.
- Open: when deletion markers may be purged is for the sync design
  (ADR 0009, Phase 5). `@PurgesDeletedRecords` is ready for it.
- The details are in [data.md](../architecture/data.md).
