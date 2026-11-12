package app.shkriuss.core.data.sample

import androidx.room3.migration.Migration
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.execSQL
import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.data.systemSqliteDatabaseBuilder
import app.shkriuss.core.testing.MigrationTestRule
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The example migration test. Every app database has one like it: one test
 * per version step that checks the rows survive, and the three checks at
 * the end, which need no change when a version is added.
 */
@RunWith(RobolectricTestRunner::class)
class SampleMigrationTest {
    @get:Rule
    val migrations = MigrationTestRule(InstrumentationRegistry.getInstrumentation(), SampleDatabase::class)

    @Test
    fun from1To2KeepsEveryNoteAndItsRecordFields() {
        migrations.createDatabase(1).use { connection ->
            connection.execSQL(
                "INSERT INTO sample_note (id, createdAt, updatedAt, deletedAt, title) VALUES " +
                    "('${ID_LIVE}', 100, 200, NULL, 'Milk'), " +
                    "('${ID_DELETED}', 110, 300, 300, 'Bread')",
            )
        }

        val rows = migrations.runMigrationsAndValidate(2, listOf(SampleMigrations.From1To2)).use(::readNotes)

        val expected = listOf(
            NoteRow(RecordFields(ID_LIVE, createdAt = 100, updatedAt = 200, deletedAt = null), "Milk", pinned = 0),
            NoteRow(RecordFields(ID_DELETED, createdAt = 110, updatedAt = 300, deletedAt = 300), "Bread", pinned = 0),
        )
        assertEquals(expected, rows)
    }

    @Test
    fun theAppOpensTheMigratedDatabaseWithRoom() {
        migrations.createDatabase(1).use { connection ->
            connection.execSQL(
                "INSERT INTO sample_note (id, createdAt, updatedAt, deletedAt, title) " +
                    "VALUES ('${ID_LIVE}', 100, 200, NULL, 'Milk')",
            )
        }
        val context = InstrumentationRegistry.getInstrumentation().targetContext

        val database = systemSqliteDatabaseBuilder<SampleDatabase>(context, migrations.databaseName)
            .addMigrations(*SampleMigrations.All.toTypedArray())
            .build()
        val notes = try {
            runBlocking { database.notes().live() }
        } finally {
            database.close()
        }

        val expected = SampleNote(RecordFields(ID_LIVE, 100, 200, null), title = "Milk", pinned = false)
        assertEquals(listOf(expected), notes)
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

    private data class NoteRow(val record: RecordFields, val title: String, val pinned: Long)

    private fun readNotes(connection: SQLiteConnection): List<NoteRow> =
        connection.prepare(
            "SELECT id, createdAt, updatedAt, deletedAt, title, pinned FROM sample_note ORDER BY createdAt",
        ).use { statement ->
            buildList {
                while (statement.step()) {
                    val record = RecordFields(
                        id = statement.getText(0),
                        createdAt = statement.getLong(1),
                        updatedAt = statement.getLong(2),
                        deletedAt = if (statement.isNull(3)) null else statement.getLong(3),
                    )
                    add(NoteRow(record, title = statement.getText(4), pinned = statement.getLong(5)))
                }
            }
        }

    private companion object {
        const val ID_LIVE = "00000000-0000-4000-8000-000000000001"
        const val ID_DELETED = "00000000-0000-4000-8000-000000000002"
    }
}
