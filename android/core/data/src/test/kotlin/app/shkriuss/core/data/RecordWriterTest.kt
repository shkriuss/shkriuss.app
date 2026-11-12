package app.shkriuss.core.data

import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import androidx.room3.withWriteTransaction
import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.data.sample.SampleDatabase
import app.shkriuss.core.data.sample.SampleNote
import app.shkriuss.core.data.sample.SampleTag
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Checks that [RecordWriter] stamps every write, gives every write a new
 * change number, only marks deletes, and writes in transactions on the
 * system SQLite driver.
 */
@RunWith(RobolectricTestRunner::class)
class RecordWriterTest {
    private val clock = TestClock()
    private val ids = TestIdSource()
    private lateinit var database: SampleDatabase
    private lateinit var notes: RecordWriter<SampleNote>
    private lateinit var tags: RecordWriter<SampleTag>

    @Before
    fun openDatabase() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        database = inMemoryTestDatabaseBuilder<SampleDatabase>(context).build()
        notes = RecordWriter(database, database.notes(), clock, ids)
        tags = RecordWriter(database, database.tags(), clock, ids)
    }

    @After
    fun closeDatabase() {
        database.close()
    }

    @Test
    fun createGivesANewIdBothTimesAndTheFirstChangeNumber() = runBlocking {
        val note = createNote("Milk")

        val expected = RecordFields(
            id = TestIdSource.idNumber(1),
            createdAt = clock.nowMillis,
            updatedAt = clock.nowMillis,
            deletedAt = null,
        )
        assertEquals(expected, note.record)
        assertEquals(1L, note.changeNumber)
        assertEquals(note, database.notes().find(note.record.id))
    }

    @Test
    fun createIgnoresRecordFieldsAndChangeNumberSetByTheCaller() = runBlocking {
        val note = notes.create { fields, _ ->
            SampleNote(fields.copy(id = "chosen", createdAt = 1, deletedAt = 2), changeNumber = 99, title = "Milk", pinned = false)
        }

        assertEquals(TestIdSource.idNumber(1), note.record.id)
        assertEquals(clock.nowMillis, note.record.createdAt)
        assertNull(note.record.deletedAt)
        assertEquals(1L, note.changeNumber)
        assertEquals(listOf(note), database.notes().all())
    }

    @Test
    fun updateMovesUpdatedAtAndTheChangeNumberAndKeepsIdAndCreatedAt() = runBlocking {
        val note = createNote("Milk")
        clock.advanceBy(5_000)

        val updated = notes.update(note.record.id) { it.copy(title = "Oat milk") }

        assertEquals("Oat milk", updated?.title)
        assertEquals(note.record.copy(updatedAt = clock.nowMillis), updated?.record)
        assertEquals(2L, updated?.changeNumber)
        assertEquals(updated, database.notes().find(note.record.id))
    }

    @Test
    fun updateIgnoresChangesToRecordFieldsAndChangeNumber() = runBlocking {
        val note = createNote("Milk")
        clock.advanceBy(1_000)

        val updated = notes.update(note.record.id) { current ->
            current.copy(record = current.record.copy(createdAt = 0, deletedAt = 7), changeNumber = 50, pinned = true)
        }

        assertEquals(note.record.copy(updatedAt = clock.nowMillis), updated?.record)
        assertEquals(2L, updated?.changeNumber)
        assertEquals(true, updated?.pinned)
    }

    @Test
    fun updateThatChangesNothingWritesNothing() = runBlocking {
        val note = createNote("Milk")
        clock.advanceBy(1_000)

        val updated = notes.update(note.record.id) { it.copy(title = "Milk") }

        assertEquals(note, updated)
        assertEquals(note, database.notes().find(note.record.id))
        assertEquals("The unused write took no change number", 2L, createNote("Bread").changeNumber)
    }

    @Test
    fun updatedAtMovesForwardWhenTheClockIsSetBack() = runBlocking {
        val note = createNote("Milk")
        clock.advanceBy(-60_000)

        val updated = notes.update(note.record.id) { it.copy(title = "Oat milk") }
        val deleted = notes.markDeleted(note.record.id)

        assertEquals(note.record.updatedAt + 1, updated?.record?.updatedAt)
        assertEquals(note.record.updatedAt + 2, deleted?.record?.updatedAt)
    }

    @Test
    fun markDeletedKeepsTheRowAndSetsDeletedAt() = runBlocking {
        val note = createNote("Milk")
        clock.advanceBy(2_000)

        val deleted = notes.markDeleted(note.record.id)

        val expected = note.copy(
            record = note.record.copy(updatedAt = clock.nowMillis, deletedAt = clock.nowMillis),
            changeNumber = 2,
        )
        assertEquals(expected, deleted)
        assertEquals(listOf(expected), database.notes().all())
        assertEquals(emptyList<SampleNote>(), database.notes().live())
    }

    @Test
    fun aDeletedRecordIsNotChangedOrDeletedAgain() = runBlocking {
        val note = createNote("Milk")
        val deleted = notes.markDeleted(note.record.id)
        clock.advanceBy(1_000)

        assertNull(notes.update(note.record.id) { it.copy(title = "Oat milk") })
        assertNull(notes.markDeleted(note.record.id))
        assertEquals(deleted, database.notes().find(note.record.id))
    }

    @Test
    fun restoreBringsBackADeletedRecordWithANewChangeNumber() = runBlocking {
        val note = createNote("Milk")
        notes.markDeleted(note.record.id)
        clock.advanceBy(3_000)

        val restored = notes.restore(note.record.id)

        assertEquals(note.copy(record = note.record.copy(updatedAt = clock.nowMillis), changeNumber = 3), restored)
        assertEquals(listOf(restored), database.notes().live())
        assertNull("A record that is not deleted is not restored", notes.restore(note.record.id))
    }

    @Test
    fun aMissingRecordGivesNull() = runBlocking {
        assertNull(notes.update("missing") { it.copy(title = "Milk") })
        assertNull(notes.markDeleted("missing"))
        assertNull(notes.restore("missing"))
    }

    @Test
    fun changeNumbersGoUpAcrossEveryTableOfTheDatabase() = runBlocking {
        val note = createNote("Milk")
        val tag = tags.create { fields, number -> SampleTag(fields, number, name = "Shopping") }
        val updatedNote = notes.update(note.record.id) { it.copy(title = "Oat milk") }!!
        val deletedTag = tags.markDeleted(tag.record.id)!!

        val numbers = listOf(note.changeNumber, tag.changeNumber, updatedNote.changeNumber, deletedTag.changeNumber)

        assertEquals(listOf(1L, 2L, 3L, 4L), numbers)
    }

    @Test
    fun aChangeNumberIsNeverUsedAgainAfterRecordsArePurged() = runBlocking {
        val kept = createNote("Kept")
        val purged = List(2) { index -> createNote("Purged $index") }
        purged.forEach { notes.markDeleted(it.record.id) }
        // What a future purge would do: remove deleted rows for good.
        database.useWriterConnection { it.executeSQL("DELETE FROM sample_note WHERE deletedAt IS NOT NULL") }

        val next = createNote("Next")

        assertEquals(listOf(kept, next), database.notes().all())
        assertEquals("1 to 3 for the creates, 4 and 5 for the deletes", 6L, next.changeNumber)
    }

    @Test
    fun writesInsideAFailedTransactionAreRolledBackWithTheirChangeNumbers() = runBlocking {
        val kept = createNote("Kept")

        val failure = runCatching {
            database.withWriteTransaction {
                createNote("Rolled back")
                notes.markDeleted(kept.record.id)
                error("Stop the transaction")
            }
        }

        assertTrue(failure.isFailure)
        assertEquals(listOf(kept), database.notes().all())
        assertEquals("Numbers of writes that never happened are free", 2L, createNote("Next").changeNumber)
    }

    @Test
    fun takeFromBackupStoresARecordThatIsNotStoredWithItsOwnFieldsAndANewChangeNumber() = runBlocking {
        createNote("Already here")
        val fields = RecordFields(id = TestIdSource.idNumber(77), createdAt = 1_000, updatedAt = 2_000, deletedAt = null)
        val fromBackup = SampleNote(fields, changeNumber = 999, title = "From the backup", pinned = true)

        val take = notes.takeFromBackup(fromBackup)

        assertEquals(BackupTake.TAKEN, take)
        val stored = database.notes().find(fields.id)
        assertEquals("the fields are the ones of the backup, not now", fields, stored?.record)
        assertEquals("the change number is the next one, not the one that came along", 2L, stored?.changeNumber)
        assertEquals(fromBackup.copy(changeNumber = 2), stored)
    }

    @Test
    fun takeFromBackupReplacesAStoredRecordThatIsOlder() = runBlocking {
        val note = createNote("Milk")
        val newer = note.record.copy(createdAt = note.record.createdAt - 10, updatedAt = note.record.updatedAt + 5_000)
        val fromBackup = SampleNote(newer, changeNumber = 0, title = "Oat milk", pinned = true)

        val take = notes.takeFromBackup(fromBackup)

        assertEquals(BackupTake.TAKEN, take)
        assertEquals(listOf(fromBackup.copy(changeNumber = 2)), database.notes().all())
    }

    @Test
    fun takeFromBackupWritesNothingWhenTheStoredRecordIsAsNewOrNewer() = runBlocking {
        val note = createNote("Milk")
        val same = SampleNote(note.record, changeNumber = 0, title = "Other words, same time", pinned = true)
        val older = SampleNote(note.record.copy(updatedAt = note.record.updatedAt - 1), changeNumber = 0, title = "Older", pinned = true)

        assertEquals(BackupTake.SAME, notes.takeFromBackup(same))
        assertEquals(BackupTake.STORED_IS_NEWER, notes.takeFromBackup(older))

        assertEquals(listOf(note), database.notes().all())
        assertEquals("no change number was taken", 2L, createNote("Bread").changeNumber)
    }

    @Test
    fun takeFromBackupTreatsADeletionAsAnEditLikeAnyOther() = runBlocking {
        val deletedLater = createNote("Deleted after the backup")
        val deletedInBackup = createNote("Deleted in the backup")
        val before = deletedLater.record
        clock.advanceBy(10_000)
        val stillDeleted = notes.markDeleted(deletedLater.record.id)

        // The backup holds the first note as it was before its deletion, and the second one deleted later still.
        val live = SampleNote(before, changeNumber = 0, title = "Deleted after the backup", pinned = false)
        val newerDeletion = deletedInBackup.record.copy(updatedAt = clock.nowMillis + 1, deletedAt = clock.nowMillis + 1)
        val deleted = SampleNote(newerDeletion, changeNumber = 0, title = "Deleted in the backup", pinned = false)

        assertEquals("a restore cannot undo a later deletion", BackupTake.STORED_IS_NEWER, notes.takeFromBackup(live))
        assertEquals(BackupTake.TAKEN, notes.takeFromBackup(deleted))

        assertEquals(stillDeleted, database.notes().find(deletedLater.record.id))
        assertEquals(newerDeletion, database.notes().find(deletedInBackup.record.id)?.record)
        assertEquals(emptyList<SampleNote>(), database.notes().live())
    }

    @Test
    fun takingTheSameRecordsTwiceWritesNothingTheSecondTime() = runBlocking {
        val records = List(3) { index ->
            val fields = RecordFields(TestIdSource.idNumber(50L + index), createdAt = 1_000, updatedAt = 2_000, deletedAt = null)
            SampleNote(fields, changeNumber = 0, title = "Note $index", pinned = false)
        }

        val first = records.map { notes.takeFromBackup(it) }
        val stored = database.notes().all()
        val second = records.map { notes.takeFromBackup(it) }

        assertEquals(List(3) { BackupTake.TAKEN }, first)
        assertEquals(List(3) { BackupTake.SAME }, second)
        assertEquals(stored, database.notes().all())
        assertEquals(listOf(1L, 2L, 3L), stored.map { it.changeNumber })
    }

    @Test
    fun recordsTakenInOneTransactionRollBackTogether() = runBlocking {
        val kept = createNote("Kept")
        val fields = RecordFields(TestIdSource.idNumber(60), createdAt = 1_000, updatedAt = 2_000, deletedAt = null)
        val newer = kept.record.copy(updatedAt = kept.record.updatedAt + 1)

        val failure = runCatching {
            database.withWriteTransaction {
                notes.takeFromBackup(SampleNote(fields, changeNumber = 0, title = "New", pinned = false))
                notes.takeFromBackup(SampleNote(newer, changeNumber = 0, title = "Replaced", pinned = false))
                error("Stop the transaction")
            }
        }

        assertTrue(failure.isFailure)
        assertEquals(listOf(kept), database.notes().all())
        assertEquals("the numbers of writes that never happened are free", 2L, createNote("Next").changeNumber)
    }

    private suspend fun createNote(title: String): SampleNote =
        notes.create { fields, number -> SampleNote(fields, number, title = title, pinned = false) }
}
