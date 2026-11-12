package app.shkriuss.core.data.sample

import androidx.room3.migration.Migration
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.execSQL
import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.data.ChangeCounter
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.core.data.systemSqliteDatabaseBuilder
import app.shkriuss.core.testing.MigrationTestRule
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.core.testing.changeNumberProblems
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The example migration test. Every app database has one like it: one test
 * per version step that checks the rows, their record fields and their
 * change numbers survive, and the checks at the end, which need no change
 * when a version is added.
 */
@RunWith(RobolectricTestRunner::class)
class SampleMigrationTest {
    @get:Rule
    val migrations = MigrationTestRule(InstrumentationRegistry.getInstrumentation(), SampleDatabase::class)

    @Test
    fun from1To2KeepsEveryNoteItsRecordFieldsAndItsChangeNumber() {
        migrations.createDatabase(1).use(::insertVersion1Rows)

        val (rows, problems, counter) = migrations.runMigrationsAndValidate(2, listOf(SampleMigrations.From1To2))
            .use { connection -> Triple(readNotes(connection), changeNumberProblems(connection), readCounter(connection)) }

        val expected = listOf(
            NoteRow(RecordFields(ID_LIVE, createdAt = 100, updatedAt = 200, deletedAt = null), 4, "Milk", pinned = 0),
            NoteRow(RecordFields(ID_DELETED, createdAt = 110, updatedAt = 300, deletedAt = 300), 6, "Bread", pinned = 0),
        )
        assertEquals(expected, rows)
        assertEquals(emptyList<String>(), problems)
        assertEquals("The migration leaves the counter as it was", 7L, counter)
    }

    @Test
    fun theAppOpensTheMigratedDatabaseWithRoomAndGoesOnCounting() {
        migrations.createDatabase(1).use(::insertVersion1Rows)
        val context = InstrumentationRegistry.getInstrumentation().targetContext

        val database = systemSqliteDatabaseBuilder<SampleDatabase>(context, migrations.databaseName)
            .addMigrations(*SampleMigrations.All.toTypedArray())
            .build()
        val writer = RecordWriter(database, database.notes(), TestClock(), TestIdSource())
        val (notes, next) = try {
            runBlocking {
                val before = database.notes().live()
                before to writer.create { fields, number -> SampleNote(fields, number, title = "Eggs", pinned = false) }
            }
        } finally {
            database.close()
        }

        val expected = SampleNote(RecordFields(ID_LIVE, 100, 200, null), changeNumber = 4, title = "Milk", pinned = false)
        assertEquals(listOf(expected), notes)
        assertEquals("The counter goes on from version 1's last number", 8L, next.changeNumber)
    }

    @Test
    fun aMigrationThatDoesNotMatchTheSchemaFails() {
        // Version 2 says `pinned` has the default 0. This one has none.
        val wrong = Migration(1, 2) { connection ->
            connection.execSQL("ALTER TABLE sample_note ADD COLUMN pinned INTEGER NOT NULL")
        }
        migrations.createDatabase(1).close()

        assertThrows(IllegalStateException::class.java) {
            migrations.runMigrationsAndValidate(2, listOf(wrong)).close()
        }
    }

    @Test
    fun aMissingStepIsFound() {
        assertThrows(IllegalStateException::class.java) {
            migrations.checkEveryVersionMigratesToNewest(emptyList())
        }
    }

    @Test
    fun everyVersionMigratesToTheNewest() {
        migrations.checkEveryVersionMigratesToNewest(SampleMigrations.All)
    }

    @Test
    fun theNewestSchemaFollowsTheRecordConventions() {
        migrations.checkNewestFollowsRecordConventions()
    }

    private data class NoteRow(val record: RecordFields, val changeNumber: Long, val title: String, val pinned: Long)

    /** Two notes and a tag, as version 1 stored them, and the counter after their writes. */
    private fun insertVersion1Rows(connection: SQLiteConnection) {
        connection.execSQL(
            "INSERT INTO sample_note (id, createdAt, updatedAt, deletedAt, changeNumber, title) VALUES " +
                "('$ID_LIVE', 100, 200, NULL, 4, 'Milk'), " +
                "('$ID_DELETED', 110, 300, 300, 6, 'Bread')",
        )
        connection.execSQL(
            "INSERT INTO sample_tag (id, createdAt, updatedAt, deletedAt, changeNumber, name) " +
                "VALUES ('$ID_TAG', 120, 120, NULL, 7, 'Shopping')",
        )
        connection.execSQL("INSERT INTO ${ChangeCounter.TABLE} (id, lastNumber) VALUES (1, 7)")
    }

    private fun readNotes(connection: SQLiteConnection): List<NoteRow> =
        connection.prepare(
            "SELECT id, createdAt, updatedAt, deletedAt, changeNumber, title, pinned FROM sample_note ORDER BY createdAt",
        ).use { statement ->
            buildList {
                while (statement.step()) {
                    val record = RecordFields(
                        id = statement.getText(0),
                        createdAt = statement.getLong(1),
                        updatedAt = statement.getLong(2),
                        deletedAt = if (statement.isNull(3)) null else statement.getLong(3),
                    )
                    add(NoteRow(record, statement.getLong(4), title = statement.getText(5), pinned = statement.getLong(6)))
                }
            }
        }

    private fun readCounter(connection: SQLiteConnection): Long =
        connection.prepare(ChangeCounter.READ_SQL).use { statement ->
            check(statement.step())
            statement.getLong(0)
        }

    private companion object {
        // Not the IDs a TestIdSource hands out, so new records do not clash.
        const val ID_LIVE = "11111111-1111-4111-8111-000000000001"
        const val ID_DELETED = "11111111-1111-4111-8111-000000000002"
        const val ID_TAG = "11111111-1111-4111-8111-000000000003"
    }
}
