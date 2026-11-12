# 0027 How the record fields are stored and stamped

- Status: Proposed
- Date: 2026-11-12
- Source: Phase 1, step 3 in [PROMPTS.md](../development/PROMPTS.md). It
  adds detail to point 5 of
  [0004](0004-room-on-system-sqlite-no-sqlcipher.md). To be accepted by
  the owner in review.

## Context

- Every record has `id` (random UUID), `createdAt`, `updatedAt` and
  `deletedAt`. Synced records are never hard-deleted (0004, and section 5
  of the [plan](../plan/PLAN.md)).
- How the four fields are stored becomes part of every schema, every
  backup and, later, every change-set. Changing it later means a
  migration of every table.
- Sync will need to find what changed since a point
  ([PROMPTS.md](../development/PROMPTS.md), step 1.3). Conflicts are
  resolved per record, last writer wins, with deletion markers (plan
  section 7). The sync design itself comes in Phase 5.
- Tests must control the clock and the IDs (0012).

## Decision

1. `id` is `TEXT NOT NULL` and the only primary key column. It holds a
   version 4 UUID in its 36-character lower-case form.
2. `createdAt`, `updatedAt` and `deletedAt` are `INTEGER`, in milliseconds
   since 1970-01-01T00:00:00Z. `deletedAt` is null while the record is not
   deleted. The other three are `NOT NULL`.
3. Each record table has an index on (`updatedAt`, `id`).
4. Entities embed the fields as one class, `RecordFields`, so the columns
   have the same names in every table.
5. All writes go through `RecordWriter`, which stamps the fields:
   - Create sets a new ID and both times to now.
   - Update, delete and restore move `updatedAt` forward. It becomes now,
     or one millisecond after the record's last `updatedAt` if that is
     later. So it never moves backwards for a record.
   - Delete sets `deletedAt`, and the row stays. Restore clears it.
   - A change that changes nothing writes nothing.
6. The order of changes is `updatedAt`, then `id`. "Changed since" reads
   the records after a position in that order, deleted ones included.
7. Times come from a `Clock`, and IDs from an `IdSource`, both passed
   through constructors.

## Options rejected

- **IDs as 16 bytes (`BLOB`).** Smaller, but harder to read in a test
  failure or a backup check. Reason for the choice: plain text is easier
  to check from a phone.
- **`java.time.Instant` in the entities.** Every database would need a type
  converter, and the stored value would be the same number.
- **A separate local change counter column.** It would not depend on the
  clock, but it is a fifth field that the plan does not have, and it
  belongs to the sync design. Open for Phase 5.
- **SQLite triggers that refuse a `DELETE`.** Room does not know about
  triggers, so they are not in the schema files or the migration tests.

## Consequences

- Each table's DAO declares its own `find` and `changedSince` queries,
  because Room needs the table name written out. The shared SQL is in
  `RecordSql.CHANGED_SINCE`.
- A DAO must not declare `@Delete`, `@Upsert`, `DELETE` or `UPDATE`
  queries, or `OnConflictStrategy.REPLACE`. Review keeps this rule. No
  build check enforces it yet.
- The migration tests of every database check its newest schema against
  points 1 to 3.
- Open: a record changed while the device's clock was set back can sort
  before a position that a reader already passed. The sync design in
  Phase 5 must handle it.
- The details are in [data.md](../architecture/data.md).
