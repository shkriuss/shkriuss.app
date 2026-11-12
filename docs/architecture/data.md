# Data

How the apps store their records: Room on the system SQLite, the four
fields every record has, how every write stamps them, the "changed since"
query, and how schemas and migrations are kept and tested. Built in
Phase 1, step 3.

The code is in `android/core/data`. The test helpers are in
`android/core/testing`.

## At a glance

| Part | What | Where |
|---|---|---|
| Database library | Room 3.0.3 | `android/gradle/libs.versions.toml` |
| SQLite | The system SQLite, through `AndroidSQLiteDriver` (`androidx.sqlite` 2.7.1) | `systemSqliteDatabaseBuilder` |
| Room's code generator | Room's compiler, run by KSP 2.3.13 | `shkriuss.android.room` plugin |
| Record fields | `id`, `createdAt`, `updatedAt`, `deletedAt` | `RecordFields` |
| Writes | Stamped by `RecordWriter`. Deletes only mark. | `RecordWriter` |
| Changes since a point | `RecordDao.changedSince`, `ChangeCursor` | `ChangedSince.kt` |
| Schemas | One JSON file per database version, committed | `schemas/` in each module |
| Migration tests | `MigrationTestRule` | `core/testing` |

Decisions: [ADR 0004](../adr/0004-room-on-system-sqlite-no-sqlcipher.md)
(Room on the system SQLite),
[ADR 0026](../adr/0026-room-build-tools.md) (KSP, Room's Gradle plugin,
the committed schemas) and
[ADR 0027](../adr/0027-record-fields-and-stamping.md) (how the record
fields are stored and stamped).

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

Every table that stores records has these four columns. They are the
convention of ADR 0004, stored as decided in ADR 0027.

| Column | SQL type | What it holds | Changes |
|---|---|---|---|
| `id` | `TEXT NOT NULL`, the primary key | A random UUID (version 4), 36 characters, lower case | Never |
| `createdAt` | `INTEGER NOT NULL` | When the record was created, in milliseconds since 1970-01-01T00:00:00Z | Never |
| `updatedAt` | `INTEGER NOT NULL` | When the record last changed, deletion included, in the same unit | Only forward |
| `deletedAt` | `INTEGER`, may be null | When the record was deleted, or null | Set by a delete, cleared by a restore |

Each table also has an index on (`updatedAt`, `id`), in that order. It
serves the "changed since" query.

An entity embeds the four fields as `RecordFields` and implements `Record`:

```kotlin
@Entity(
    tableName = "intake",
    primaryKeys = ["id"],
    indices = [Index("updatedAt", "id")],
)
data class IntakeEntity(
    @Embedded override val record: RecordFields,
    val amountMl: Int,
) : Record<IntakeEntity> {
    override fun withRecord(record: RecordFields) = copy(record = record)
}
```

`MigrationTestRule.checkNewestFollowsRecordConventions()` fails the tests
of any database whose newest schema breaks these rules: a missing column,
a wrong type, a wrong primary key, or no change index.

## Writing records

All writes go through one `RecordWriter` per table. It takes the database,
the table's DAO, a `Clock` and an `IdSource` through its constructor.

1. `create { fields -> ... }` gives the record a new ID from the
   `IdSource`, and sets `createdAt` and `updatedAt` to now. `deletedAt` is
   null.
2. `update(id) { current -> changed }` reads the stored record, applies the
   change and writes it back, in one write transaction. `updatedAt` moves
   forward. If nothing changed, nothing is written.
3. `markDeleted(id)` sets `deletedAt` and `updatedAt` to now. The row
   stays. Deleting never removes a row.
4. `restore(id)` clears `deletedAt` of a deleted record, for example to
   undo a deletion. `updatedAt` moves forward.
5. A deleted record cannot be updated or deleted again until it is
   restored. `update`, `markDeleted` and `restore` return null when there
   is no record they can change.
6. The callers never set the record fields. `create` and `update` ignore
   any change a caller makes to them.
7. `updatedAt` always moves forward, even when the clock was set back. A
   write sets it to now, or to one millisecond after the record's last
   `updatedAt` if that is later.

### Rules for DAOs

A table's DAO extends `RecordDao`, which gives `RecordWriter` its
`rawInsert` and `rawUpdate`. The DAO adds `find` and `changedSince` for its
table, and any reads the feature needs:

```kotlin
@Dao
interface IntakeDao : RecordDao<IntakeEntity> {
    @Query("SELECT * FROM intake WHERE id = :id")
    override suspend fun find(id: String): IntakeEntity?

    @Query("SELECT * FROM intake WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterUpdatedAt: Long, afterId: String, limit: Int): List<IntakeEntity>

    @Query("SELECT * FROM intake WHERE deletedAt IS NULL ORDER BY createdAt DESC")
    fun observeLive(): Flow<List<IntakeEntity>>
}
```

1. Only `RecordWriter` calls `rawInsert` and `rawUpdate`.
2. A DAO never declares `@Delete`, `@Upsert`, a `DELETE` or `UPDATE`
   query, or `OnConflictStrategy.REPLACE`. They would skip the stamping.
   `@Delete`, `DELETE` and `REPLACE` would also remove rows for good.
3. Reads that show records to the user filter out deleted ones with
   `deletedAt IS NULL`.

These DAO rules are kept by review. The build does not check them (see
[Open](#open)).

### Clock and IDs

- `Clock` gives the current time in milliseconds. Apps pass
  `Clock.System`, the device's wall clock.
- `IdSource` gives new IDs. Apps pass `IdSource.RandomUuid`. Its random
  bits come from the platform's secure random source.
- Both are passed through constructors, never looked up (ADR 0012). Tests
  pass `TestClock`, which moves only when the test says, and
  `TestIdSource`, which hands out known IDs in order.

## Reading changes ("changed since")

The pattern that sync can use later to find what changed. It is not the
sync design, which comes in Phase 5 ([ADR 0009](../adr/0009-sync-protocol-and-server.md)).

1. The order of changes is: by `updatedAt`, then by `id`.
2. A `ChangeCursor` is a position in that order: an `updatedAt` and an
   `id`. `ChangeCursor.Start` is before every record.
3. `changedSince(cursor, limit)` returns up to `limit` records after the
   cursor, oldest change first. Deleted records are included, so a
   deletion is a change like any other.
4. To read every change in pages, start at `ChangeCursor.Start`. Continue
   from `ChangeCursor.of(lastRecordOfThePage.record)` until a page is
   shorter than the limit.
5. Records with the same `updatedAt` are ordered by `id`, so paging never
   skips or repeats one, even when many records change in the same
   millisecond.
6. A record that changes again moves to the end of the order. A reader
   finds it again, with its newest content.
7. The query reads the (`updatedAt`, `id`) index from the cursor on, and
   SQLite does not sort. `ChangedSinceTest` checks the query plan.

The SQL is in `RecordSql.CHANGED_SINCE`. Room needs each table's name
written in its own query, so each DAO joins it to its own `SELECT`.

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
   migrate, and check the rows.
5. Run `./gradlew check`.
6. Commit the new schema file with the change.

Never change the schema file of a version that was released. A migration
changes tables, not records: it leaves the record fields of every row as
they are.

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

Each test starts and ends with no database file.

### The example

`core/data` has a small database in its tests only, `SampleDatabase`. It
shows every rule on this page. Version 1 has notes with a title. Version 2
adds `pinned`, with the migration `SampleMigrations.From1To2`:

```kotlin
val From1To2: Migration = Migration(startVersion = 1, endVersion = 2) { connection ->
    connection.execSQL("ALTER TABLE sample_note ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
}
```

`SampleMigrationTest` is the model for every app's migration test:

- one test per version step that checks the rows and their record fields
  survive,
- a test that the app opens the migrated file with Room,
- `checkEveryVersionMigratesToNewest` and
  `checkNewestFollowsRecordConventions`, which need no change when a
  version is added.

Its schema files are in `android/core/data/schemas/`. It also checks that
a wrong migration and a missing step fail.

## Tests

| Test | Module | What it checks |
|---|---|---|
| `RecordWriterTest` | `core/data` | Stamping on create, update, delete and restore; deletes only mark; `updatedAt` moves forward when the clock is set back; a failed write transaction rolls back. |
| `ChangedSinceTest` | `core/data` | Paging reads every change once, in order, deleted records included, also with many changes in one millisecond; the query plan uses the index. |
| `SampleMigrationTest` | `core/data` | The example migration, Room opening the migrated file, every version migrating to the newest, the record conventions, and that a wrong migration and a missing step fail. |
| `RecordConventionsTest` | `core/testing` | The conventions check passes a good table and names each problem. |
| `TestSourcesTest` | `core/testing` | `TestIdSource` gives valid UUIDs in order; `TestClock` moves only when told. |

All of them run in `./gradlew check`, on the JVM with Robolectric. Their
SQLite is Robolectric's, not a phone's. No emulator test exists yet
([emulator-tests.md](../development/emulator-tests.md)).

## Open

- **The clock and the change order.** `updatedAt` comes from the device's
  clock. It never moves backwards for one record, but a record changed
  while the clock was set back can get an `updatedAt` below a cursor that
  a reader already passed. That reader would not see the change. How sync
  reads changes safely is for the sync design in Phase 5, step 1.
- **When deletion markers may be removed.** Deleted records stay stored.
  When, if ever, they may be purged is for the sync design (ADR 0009).
- **Migrations and sync.** How a migration on one device relates to
  records that arrive from a device on an older version is for the sync
  design.
- **Enforcing the DAO rules.** No build check stops a DAO from declaring
  `@Delete` or `REPLACE` yet. A lint check could, later.
