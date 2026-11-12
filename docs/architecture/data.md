# Data

How the apps store their records: Room on the system SQLite, the fields
every record has, how every write stamps them, the change number and the
"changed since" query, and how schemas and migrations are kept and tested.
Built in Phase 1, step 3.

The code is in `android/core/data`. The test helpers are in
`android/core/testing`.

## At a glance

| Part | What | Where |
|---|---|---|
| Database library | Room 3.0.3 | `android/gradle/libs.versions.toml` |
| SQLite | The system SQLite, through `AndroidSQLiteDriver` (`androidx.sqlite` 2.7.1) | `systemSqliteDatabaseBuilder` |
| Room's code generator | Room's compiler, run by KSP 2.3.13 | `shkriuss.android.room` plugin |
| Record fields | `id`, `createdAt`, `updatedAt`, `deletedAt` | `RecordFields` |
| Change number | `changeNumber`, local, from one counter per database | `Record`, `ChangeCounter` |
| Writes | Stamped by `RecordWriter`. Deletes only mark. | `RecordWriter` |
| Changes since a point | `RecordDao.changedSince`, by change number | `ChangedSince.kt` |
| DAO rules | DAOs only read; only `RecordWriter` writes | `checkDaoRules` |
| Schemas | One JSON file per database version, committed | `schemas/` in each module |
| Migration tests | `MigrationTestRule` | `core/testing` |

Decisions: [ADR 0004](../adr/0004-room-on-system-sqlite-no-sqlcipher.md)
(Room on the system SQLite),
[ADR 0026](../adr/0026-room-build-tools.md) (KSP, Room's Gradle plugin,
the committed schemas) and
[ADR 0027](../adr/0027-record-fields-and-stamping.md) (how the record
fields and the change number are stored and stamped).

## The database

1. Every app database is a Room database on the system SQLite. The driver
   is `AndroidSQLiteDriver`. The app ships no SQLite and no native code.
2. Build every database with `systemSqliteDatabaseBuilder`:

   ```kotlin
   val database = systemSqliteDatabaseBuilder<WaterDatabase>(context, "water.db")
       .addMigrations(*WaterMigrations.All.toTypedArray())
       .build()
   ```

3. Room 3 also picks `AndroidSQLiteDriver` when no driver is set. The
   builder sets it anyway, so the choice is visible in the code.
4. The build refuses the bundled SQLite driver (`androidx.sqlite:sqlite-bundled`)
   in every module, with a message that names hard rule 2. The APK rules
   check would also find its native library in an APK
   ([build.md](../development/build.md#apk-rules-check)).
5. The database file is protected by Android's file-based encryption. The
   app adds no encryption to rows (ADR 0004).
6. Room checks, when it opens a database, that a migration exists for every
   version step. If one is missing, it stops. Never call
   `fallbackToDestructiveMigration`: it deletes every record.
7. Write transactions work with `AndroidSQLiteDriver`. DAO calls inside
   `withWriteTransaction` run in that transaction, and a failure rolls all
   of them back. `RecordWriterTest` checks this. It was open in ADR 0004.

## Record fields

Every table that stores records has these columns (ADR 0027).

| Column | SQL type | What it holds | Changes | In a backup and in sync |
|---|---|---|---|---|
| `id` | `TEXT NOT NULL`, the primary key | A random UUID (version 4), 36 characters, lower case | Never | Yes |
| `createdAt` | `INTEGER NOT NULL` | When the record was created, in milliseconds since 1970-01-01T00:00:00Z | Never | Yes |
| `updatedAt` | `INTEGER NOT NULL` | When the record last changed, deletion included, in the same unit | Only forward | Yes |
| `deletedAt` | `INTEGER`, may be null | When the record was deleted, or null | Set by a delete, cleared by a restore | Yes |
| `changeNumber` | `INTEGER NOT NULL`, with a unique index | The record's place in the order of changes in this database | On every write, to a new, higher number | No |

The first four are `RecordFields`. They travel with the record. The change
number is a column of its own, so it stays on the device.

There is no index on `updatedAt`. An app that needs one, for example to
sort by the last change, adds its own.

Each database also has one table that is not a record table:
`change_counter`, with one row that holds the last change number handed
out (`ChangeCounter`).

An entity embeds `RecordFields`, has a `changeNumber` and implements
`Record`:

```kotlin
@Entity(
    tableName = "intake",
    primaryKeys = ["id"],
    indices = [Index("changeNumber", unique = true)],
)
data class IntakeEntity(
    @Embedded override val record: RecordFields,
    override val changeNumber: Long,
    val amountMl: Int,
) : Record<IntakeEntity> {
    override fun withRecord(record: RecordFields, changeNumber: Long) =
        copy(record = record, changeNumber = changeNumber)
}
```

The database lists `ChangeCounter` among its entities:

```kotlin
@Database(entities = [IntakeEntity::class, ChangeCounter::class], version = 1)
abstract class WaterDatabase : RoomDatabase() { /* ... */ }
```

`MigrationTestRule.checkNewestFollowsRecordConventions()` fails the tests
of any database whose newest schema breaks these rules: a missing column,
a wrong type, a wrong primary key, no unique index on `changeNumber`, or
no `change_counter` table.

## Writing records

All writes go through one `RecordWriter` per table. It takes the database,
the table's DAO, a `Clock` and an `IdSource` through its constructor.

1. `create { fields, changeNumber -> ... }` gives the record a new ID from
   the `IdSource`, and sets `createdAt` and `updatedAt` to now.
   `deletedAt` is null.
2. `update(id) { current -> changed }` reads the stored record, applies the
   change and writes it back. `updatedAt` moves forward. If nothing
   changed, nothing is written.
3. `markDeleted(id)` sets `deletedAt` and `updatedAt` to now. The row
   stays. Deleting never removes a row.
4. `restore(id)` clears `deletedAt` of a deleted record, for example to
   undo a deletion. `updatedAt` moves forward.
5. A deleted record cannot be updated or deleted again until it is
   restored. `update`, `markDeleted` and `restore` return null when there
   is no record they can change.
6. Each of these writes is one write transaction, and takes the next
   change number in it (see below).
7. The callers never set the record fields or the change number. `create`
   and `update` ignore any change a caller makes to them.
8. `updatedAt` always moves forward, even when the clock was set back. A
   write sets it to now, or to one millisecond after the record's last
   `updatedAt` if that is later.
9. `takeFromBackup(record)` takes one record of a backup. It is the one
   write that keeps the record fields it is given, because that record
   was stamped when it was first written. See below.

### Records from a backup

`takeFromBackup` is the only way a record of a backup is written
([ADR 0008](../adr/0008-backup-file-format.md),
[backup-format.md](backup-format.md#the-restore-rule)). The rule is: the
newest edit wins.

| Answer (`BackupTake`) | When | What is written |
|---|---|---|
| `TAKEN` | No record with this ID is stored, or the stored one has an older `updatedAt` | The record of the backup |
| `SAME` | The stored record has the same `updatedAt` | Nothing |
| `STORED_IS_NEWER` | The stored record has a later `updatedAt` | Nothing |

1. The record keeps its `id`, `createdAt`, `updatedAt` and `deletedAt`.
   The clock and the ID source are not used.
2. The change number that comes with the record is ignored. The record
   gets the next one of this database, and only when it is written.
3. A deleted record is taken like any other. So a record that was deleted
   after the backup stays deleted, and a deletion in the backup that is
   newer deletes the stored record.
4. Taking the same records twice writes nothing the second time.
5. An app takes all records of a backup inside one write transaction.
   The calls join it, and a failure rolls all of them back.
6. It is the function for backups. Sync gets its own, because there the
   same `updatedAt` must end the same on every device.

### Clock and IDs

- `Clock` gives the current time in milliseconds. Apps pass
  `Clock.System`, the device's wall clock.
- `IdSource` gives new IDs. Apps pass `IdSource.RandomUuid`. Its random
  bits come from the platform's secure random source.
- Both are passed through constructors, never looked up (ADR 0012). Tests
  pass `TestClock`, which moves only when the test says, and
  `TestIdSource`, which hands out known IDs in order.

## The change number

1. Every write, create included, gets a change number inside its own write
   transaction. `RecordWriter` raises the counter in `change_counter` by
   one and gives the new value to the record.
2. There is one counter per database, shared by all its record tables.
3. It only goes up. It never goes down, so a number is never used twice,
   even after deleted records are purged one day.
4. A number taken by a write that rolls back is free again. No reader ever
   saw it, because the write never committed.
5. SQLite runs one write transaction at a time on a database file, also
   across processes. So numbers follow the order in which writes commit.
6. The change number does not depend on the clock. `updatedAt` stays for
   display and for last writer wins.
7. It is local. It is not part of a backup or of what sync sends. A
   record restored from a backup or received by sync gets a new number
   when it is written here.
8. A stored "last change number read", such as the one sync will keep,
   belongs in the same database as the records. If the database file were
   ever made new, numbering would start again from 1.

## Reading changes ("changed since")

The pattern that sync can use later to find what changed. It is not the
sync design, which comes in Phase 5 ([ADR 0009](../adr/0009-sync-protocol-and-server.md)).

1. `changedSince(afterChangeNumber, limit)` returns up to `limit` records
   whose change number is above `afterChangeNumber`, lowest first.
   Deleted records are included, so a deletion is a change like any other.
2. To read every change in pages, start at `BEFORE_FIRST_CHANGE` (0).
   Continue from the change number of the last record of each page, until
   a page is shorter than the limit.
3. Change numbers are unique, so paging never skips or repeats a record,
   even when many records change in the same millisecond.
4. A record that changes again gets a higher number and moves to the end
   of the order. A reader finds it again, with its newest content.
5. A clock set back hides nothing. `ChangedSinceTest` changes a record
   after the clock went back two hours, and the reader still finds it.
6. A write that commits while a reader is paging is read after it. The
   write took its number inside its transaction, and no other write could
   commit meanwhile, so its number is above all the reader has seen.
   `ChangedSinceTest` holds a write open while a reader pages through a
   database file, then lets it commit.
7. The query reads the unique `changeNumber` index from the cursor on, and
   SQLite does not sort. `ChangedSinceTest` checks the query plan.

The SQL is in `RecordSql.CHANGED_SINCE`. Room needs each table's name
written in its own query, so each DAO joins it to its own `SELECT`.

## Rules for DAOs

A table's DAO extends `RecordDao`, which gives `RecordWriter` its
`rawInsert` and `rawUpdate`. The DAO adds `find` and `changedSince` for its
table, and any reads the feature needs:

```kotlin
@Dao
interface IntakeDao : RecordDao<IntakeEntity> {
    @Query("SELECT * FROM intake WHERE id = :id")
    override suspend fun find(id: String): IntakeEntity?

    @Query("SELECT * FROM intake WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<IntakeEntity>

    @Query("SELECT * FROM intake WHERE deletedAt IS NULL ORDER BY createdAt DESC")
    fun observeLive(): Flow<List<IntakeEntity>>
}
```

1. A DAO only reads. It never declares `@Insert`, `@Update`, `@Delete` or
   `@Upsert`, `OnConflictStrategy.REPLACE`, or an `INSERT`, `UPDATE`,
   `DELETE`, `INSERT OR REPLACE` or `REPLACE INTO` query. They would skip
   the stamping and the change number, and some would remove rows for
   good.
2. Only `RecordDao` itself declares the two writes, `rawInsert` and
   `rawUpdate`, and only `RecordWriter` calls them.
3. `checkDaoRules`, part of `check`, fails the build if any class of a
   module with a database breaks rule 1 or 2, in main or test code
   ([build.md](../development/build.md#dao-rules-check)).
4. The one exception is a future purge of deleted records: one function
   per DAO may be marked `@PurgesDeletedRecords`, if it is
   `DELETE FROM <table> WHERE deletedAt IS NOT NULL`, optionally followed
   by `AND` and more conditions, with no `OR`. When a purge is allowed at
   all is for the sync design. A purge never touches the counter.
5. There is no other exception. If a table that is not a record ever
   needs a write, stop and ask the owner. Restoring a backup has its own
   `RecordWriter` function, `takeFromBackup`
   ([Records from a backup](#records-from-a-backup)). Importing from sync
   will get its own in its step.
6. Reads that show records to the user filter out deleted ones with
   `deletedAt IS NULL`.

### What the check cannot see

`checkDaoRules` reads the compiled classes. It cannot see:

- **SQL that code runs outside a DAO**, through a connection, for example
  with `useWriterConnection` and `executeSQL`. `RecordWriter` does this
  for the change counter, which is not a record. Review keeps every other
  such use out.
- **Calls from modules without a database.** It runs in modules with the
  `shkriuss.android.room` plugin. A call to `rawInsert` or `rawUpdate`
  from an app module would not be found.

## Schemas and migrations

### Where schemas are kept

1. Each database version has one schema file, written by Room:
   `schemas/<database class>/<version>.json` in the module that holds the
   database. These files are committed.
2. `checkRoomSchemas` runs in `check`. It fails if the code produces a
   schema that is not committed exactly as it is: a new version whose file
   is missing, or a change to a database without a new version.
3. `recordRoomSchemas` writes the files the code produces into `schemas/`.
4. Room's own Gradle plugin would copy new schema files over the
   committed ones during every build. That copy is turned off, so a
   forgotten file cannot pass CI ([ADR 0026](../adr/0026-room-build-tools.md)).
5. Unit tests read the committed schema files, so a migration test always
   starts from what was really committed.

### How to change a schema

Claude does this in the cloud environment, in the same pull request as the
change ("Changing formats" in [CLAUDE.md](../../CLAUDE.md)):

1. Change the entities, and add 1 to `version` in `@Database`.
2. Add a migration for the step to the database's `Migrations` object, and
   to its list `All`.
3. Run `./gradlew recordRoomSchemas` from `android/`. It writes the new
   schema file.
4. Add a migration test for the step: create the old version with rows,
   migrate, and check the rows, their record fields and their change
   numbers.
5. Run `./gradlew check`.
6. Commit the new schema file with the change.

Never change the schema file of a version that was released. A migration
changes tables, not records: it leaves the record fields, the change
numbers and the counter as they are. A new record table starts with the
`changeNumber` column and its index.

### Migration tests

`MigrationTestRule` in `core/testing` wraps Room's `MigrationTestHelper` on
`AndroidSQLiteDriver`. It runs in Robolectric unit tests.

1. `createDatabase(version)` creates the database at an old version from
   its committed schema file. Insert rows with SQL, then close it.
2. `runMigrationsAndValidate(version, migrations)` runs the migrations and
   fails unless the result matches the committed schema of `version`
   exactly. It returns a connection to check the rows.
3. `checkEveryVersionMigratesToNewest(migrations)` creates every older
   committed version and migrates it to the newest. It finds a missing
   step anywhere in the chain.
4. `checkNewestFollowsRecordConventions()` checks the newest schema
   against the record fields above.
5. `changeNumberProblems(connection)` checks the stored change numbers:
   each from 1 up to the counter, and none shared by two records in any
   table. Run it on the migrated connection.

Each test starts and ends with no database file.

### The example

`core/data` has a small database in its tests only, `SampleDatabase`. It
shows every rule on this page. Version 1 has notes with a title and tags
with a name, two record tables that share one counter. Version 2 adds
`pinned` to notes, with the migration `SampleMigrations.From1To2`:

```kotlin
val From1To2: Migration = Migration(startVersion = 1, endVersion = 2) { connection ->
    connection.execSQL("ALTER TABLE sample_note ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
}
```

`SampleMigrationTest` is the model for every app's migration test:

- one test per version step that checks the rows, their record fields,
  their change numbers and the counter survive,
- a test that the app opens the migrated file with Room and goes on
  counting from the last number,
- `checkEveryVersionMigratesToNewest` and
  `checkNewestFollowsRecordConventions`, which need no change when a
  version is added.

Its schema files are in `android/core/data/schemas/`. It also checks that
a wrong migration and a missing step fail.

## Tests

| Test | Module | What it checks |
|---|---|---|
| `RecordWriterTest` | `core/data` | Stamping on create, update, delete and restore; deletes only mark; `updatedAt` moves forward when the clock is set back; every write gets a new change number, across the tables of a database; a number is not used again after a purge; a failed write transaction rolls back, its numbers with it. For `takeFromBackup`: each of its three answers, the record fields kept, a change number only for a write, a deletion as an edit like any other, the same records taken twice, and several calls that roll back together. |
| `ChangedSinceTest` | `core/data` | Paging reads every change once, in order, deleted records included; a clock set back hides no change; a write that commits while a reader is paging is read after it; the query plan uses the index. |
| `SampleMigrationTest` | `core/data` | The example migration with its change numbers and counter, Room opening the migrated file and counting on, every version migrating to the newest, the record conventions, and that a wrong migration and a missing step fail. |
| `RecordConventionsTest` | `core/testing` | The conventions check passes a good database and names each problem; the change number check finds shared and too high numbers. |
| `TestSourcesTest` | `core/testing` | `TestIdSource` gives valid UUIDs in order; `TestClock` moves only when told. |

All of them run in `./gradlew check`, on the JVM with Robolectric. Their
SQLite is Robolectric's, not a phone's. None of them runs on an emulator
yet ([emulator-tests.md](../development/emulator-tests.md)).

## Open

- **When deletion markers may be removed.** Deleted records stay stored.
  When, if ever, they may be purged is for the sync design (ADR 0009).
  `@PurgesDeletedRecords` is ready for that one query.
- **Migrations and sync.** How a migration on one device relates to
  records that arrive from a device on an older version is for the sync
  design.
