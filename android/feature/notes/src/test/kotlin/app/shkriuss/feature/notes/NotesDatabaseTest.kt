package app.shkriuss.feature.notes

import androidx.room3.useWriterConnection
import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.testing.MigrationTestRule
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.notes.data.NotesDatabase
import app.shkriuss.feature.notes.data.NotesMigrations
import app.shkriuss.feature.notes.data.checkpoint
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The schema of `notes.db`, from its committed schema files, and the two
 * settings a wipe needs: `secure_delete` on the connection that writes,
 * and the checkpoint that cuts the write-ahead file to zero
 * (docs/apps/notes/spec.md, "Removing a file, and the wipe", point 4).
 * Version 1 has no migration yet. When version 2 comes, a test for the
 * step 1 to 2 joins these, as in `SampleMigrationTest` of core/data.
 */
@RunWith(RobolectricTestRunner::class)
class NotesDatabaseTest {
    @get:Rule
    val migrations = MigrationTestRule(InstrumentationRegistry.getInstrumentation(), NotesDatabase::class)

    private val file: File = context.getDatabasePath(NotesDatabase.FILE_NAME)

    @After
    fun deleteTheFile() {
        context.deleteDatabase(NotesDatabase.FILE_NAME)
    }

    @Test
    fun theNewestSchemaFollowsTheRecordConventions() {
        migrations.checkNewestFollowsRecordConventions()
    }

    @Test
    fun everyVersionMigratesToTheNewest() {
        migrations.checkEveryVersionMigratesToNewest(NotesMigrations.All)
    }

    @Test
    fun theConnectionThatWritesHasSecureDeleteOn() = runBlocking {
        val database = NotesDatabase.open(context)
        try {
            NotesRepository(database, TestClock(THE_TIME), TestIdSource(), NoteFileStore(File(context.filesDir, "attachments"))).apply {
                save(reserveNoteId(), "Trip", "Passport")
            }
            val secureDelete = database.useWriterConnection { connection ->
                connection.usePrepared("PRAGMA secure_delete") { statement ->
                    check(statement.step())
                    statement.getLong(0)
                }
            }
            assertEquals(1L, secureDelete)
        } finally {
            database.close()
        }
    }

    @Test
    fun theCheckpointCutsTheWriteAheadFileToZero() = runBlocking {
        val database = NotesDatabase.open(context)
        try {
            val repository = NotesRepository(database, TestClock(THE_TIME), TestIdSource(), NoteFileStore(File(context.filesDir, "attachments")))
            repeat(5) { repository.save(repository.reserveNoteId(), "Trip $it", "Passport ".repeat(200)) }
            val wal = File(file.path + "-wal")
            assertTrue("The writes went into the write-ahead file", wal.length() > 0)

            assertTrue(database.checkpoint())

            assertEquals(0L, wal.length())
            assertEquals(5, repository.shownCount())
        } finally {
            database.close()
        }
    }
}
