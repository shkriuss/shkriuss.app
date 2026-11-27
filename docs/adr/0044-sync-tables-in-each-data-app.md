# 0044 Sync's own tables in each data app

- Status: Accepted
- Date: 2026-11-27
- Source: the owner's choices for Phase 5, step 3, the build of
  `core/sync-client` ([PROMPTS.md](../development/PROMPTS.md)), on
  2026-11-27: "Like the change counter (Recommended)". The details are
  Claude's, in the pull request of that step.

## Context

- A data app keeps what sync needs in its own database, beside its
  records: the cursor, Known, the key ID it syncs with, the send mark,
  **Just taken**, **To send**, the skipped records, the comparison of
  everything and the streams
  ([sync-protocol.md](../architecture/sync-protocol.md#what-a-data-app-keeps-for-sync)).
  It is written in the same transactions as the records, so that a
  cursor and the records it stands for are never apart.
- None of it is a record. It is never backed up and never synced.
- A DAO only reads. `checkDaoRules`, an owner-only build check, fails a
  DAO that writes. If a table that is not a record ever needs a write,
  the owner decides ([0027](0027-record-fields-and-stamping.md),
  point 8; [data.md](../architecture/data.md#rules-for-daos), point 5).
- `RecordWriter` already writes one table that is not a record, the
  change counter, with SQL on the connection of its transaction, outside
  any DAO.

## Decision

1. Sync's state is in seven small tables whose names start with
   `sync_`: `sync_state`, `sync_send`, `sync_taken`, `sync_seen`,
   `sync_damaged`, `sync_batch` and `sync_stream`. `core/sync-client`
   defines them as Room entities. Every data app that syncs lists all
   seven among the entities of its database, as it lists the change
   counter.
2. Only one class writes them: `SyncStore` in `core/sync-client`, with
   the SQL of `SyncSql`, on the connection of the transaction its call
   holds, as `RecordWriter` raises the change counter. No DAO reads or
   writes them.
3. That SQL writes no other table. It reads only the change counter
   beside them. A unit test, `SyncSqlTest`, fails when a statement of
   `SyncSql` writes a table whose name does not start with `sync_`.
4. `checkDaoRules` stays as it is.

## Options rejected

- **A DAO that may write the `sync_` tables.** Room would check its SQL
  when the code compiles. But `checkDaoRules` would get its first
  exception, a weaker build check, in an owner-only file.
- **One table for everything.** **To send**, **Just taken**, the IDs a
  comparison has seen and the streams are lists that can hold a row for
  every record. One table would mix rows of different kinds.

## Consequences

- An app that turns sync on adds the seven entities to its database: a
  new schema version, a migration that creates the tables, a migration
  test and the exported schema.
- Room does not check the SQL of `SyncSql` when the code compiles. The
  tests of `core/sync-client` run every statement on the system SQLite.
- `SyncStore` is the second place, after `RecordWriter`, where SQL runs
  outside a DAO. `checkDaoRules` cannot see it. Review keeps every other
  such use out ([data.md](../architecture/data.md#what-the-check-cannot-see)).
