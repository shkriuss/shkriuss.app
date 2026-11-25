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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
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

    @Test
    fun takeFromBackupRefusesATimeThatNoRecordCanHoldAndWritesNothing() = runBlocking {
        val id = TestIdSource.idNumber(50)
        val wrong = listOf(
            RecordFields(id, createdAt = -1, updatedAt = 1_000, deletedAt = null),
            RecordFields(id, createdAt = RecordTimes.LAST_MILLIS + 1, updatedAt = 1_000, deletedAt = null),
            RecordFields(id, createdAt = 1_000, updatedAt = -1, deletedAt = null),
            RecordFields(id, createdAt = 1_000, updatedAt = RecordTimes.LAST_MILLIS + 1, deletedAt = null),
            RecordFields(id, createdAt = 1_000, updatedAt = Long.MAX_VALUE, deletedAt = null),
            RecordFields(id, createdAt = 1_000, updatedAt = 2_000, deletedAt = -1),
            RecordFields(id, createdAt = 1_000, updatedAt = 2_000, deletedAt = RecordTimes.LAST_MILLIS + 1),
        )

        wrong.forEach { fields ->
            assertFalse(fields.toString(), fields.timesAreWithinLimits)
            assertThrows(fields.toString(), IllegalArgumentException::class.java) {
                runBlocking { notes.takeFromBackup(SampleNote(fields, changeNumber = 0, title = "Milk", pinned = false)) }
            }
        }

        assertEquals(emptyList<SampleNote>(), database.notes().all())
    }

    @Test
    fun takeFromBackupTakesTheFirstAndTheLastTimeARecordCanHold() = runBlocking {
        val first = RecordFields(TestIdSource.idNumber(50), createdAt = 0, updatedAt = 0, deletedAt = 0)
        val last = RecordTimes.LAST_MILLIS
        val latest = RecordFields(TestIdSource.idNumber(51), createdAt = last, updatedAt = last, deletedAt = last)

        assertEquals(BackupTake.TAKEN, notes.takeFromBackup(SampleNote(first, changeNumber = 0, title = "Milk", pinned = false)))
        assertEquals(BackupTake.TAKEN, notes.takeFromBackup(SampleNote(latest, changeNumber = 0, title = "Bread", pinned = false)))

        assertEquals("9999-12-31T23:59:59.999Z", java.time.Instant.ofEpochMilli(last).toString())
    }

    @Test
    fun updatedAtStopsAtTheLastTimeARecordCanHoldSoADeletionStaysTheNewestEdit() = runBlocking {
        val last = RecordTimes.LAST_MILLIS
        val fromBackup = SampleNote(
            RecordFields(TestIdSource.idNumber(50), createdAt = 1_000, updatedAt = last, deletedAt = null),
            changeNumber = 0,
            title = "Milk",
            pinned = false,
        )
        notes.takeFromBackup(fromBackup)

        val changed = notes.update(fromBackup.record.id) { it.copy(title = "Bread") }
        val deleted = notes.markDeleted(fromBackup.record.id)

        assertEquals(last, changed?.record?.updatedAt)
        assertEquals(RecordFields(fromBackup.record.id, createdAt = 1_000, updatedAt = last, deletedAt = last), deleted?.record)
        assertEquals("the same backup again does not bring it back", BackupTake.SAME, notes.takeFromBackup(fromBackup))
        assertTrue(database.notes().find(fromBackup.record.id)!!.record.isDeleted)
    }

    @Test
    fun aStoredTimeAtTheEndOfA64BitNumberNeverMovesBack() = runBlocking {
        val stored = createNote("Milk")
        // What an older restore could have left. No write of RecordWriter stores such a time.
        database.useWriterConnection {
            it.executeSQL("UPDATE sample_note SET updatedAt = ${Long.MAX_VALUE} WHERE id = '${stored.record.id}'")
        }

        val changed = notes.update(stored.record.id) { it.copy(title = "Bread") }
        val deleted = notes.markDeleted(stored.record.id)

        assertEquals(Long.MAX_VALUE, changed?.record?.updatedAt)
        assertEquals(Long.MAX_VALUE, deleted?.record?.updatedAt)
        assertEquals(Long.MAX_VALUE, deleted?.record?.deletedAt)
    }

    @Test
    fun wipeClearsTheContentOfADeletedRecordAndKeepsAllFourRecordFields() = runBlocking {
        val note = createNote("Diary", pinned = true)
        clock.advanceBy(1_000)
        val deleted = checkNotNull(notes.markDeleted(note.record.id))
        clock.advanceBy(60_000)

        val wiped = notes.wipe(note.record.id) { it.copy(title = "", pinned = false) }

        assertEquals("", wiped?.title)
        assertEquals(false, wiped?.pinned)
        assertEquals("No time moved, updatedAt neither", deleted.record, wiped?.record)
        assertEquals(3L, wiped?.changeNumber)
        assertEquals(wiped, database.notes().find(note.record.id))
    }

    @Test
    fun wipeIgnoresChangesToRecordFieldsAndChangeNumber() = runBlocking {
        val note = createNote("Diary")
        val deleted = checkNotNull(notes.markDeleted(note.record.id))

        val wiped = notes.wipe(note.record.id) { current ->
            current.copy(record = current.record.copy(updatedAt = 1, deletedAt = null), changeNumber = 50, title = "")
        }

        assertEquals(deleted.record, wiped?.record)
        assertEquals(3L, wiped?.changeNumber)
    }

    @Test
    fun wipeWritesNothingForARecordThatIsMissingNotDeletedOrWipedAlready() = runBlocking {
        val shown = createNote("Shown")
        val gone = createNote("Gone")
        checkNotNull(notes.markDeleted(gone.record.id))
        val wiped = checkNotNull(notes.wipe(gone.record.id) { it.copy(title = "") })

        assertNull(notes.wipe("missing") { it.copy(title = "") })
        assertNull("A record that is not deleted keeps its content", notes.wipe(shown.record.id) { it.copy(title = "") })
        assertNull("Wiped already", notes.wipe(gone.record.id) { it.copy(title = "") })

        assertEquals(shown, database.notes().find(shown.record.id))
        assertEquals(wiped, database.notes().find(gone.record.id))
        assertEquals("The writes that did nothing took no change number", 5L, createNote("Next").changeNumber)
    }

    @Test
    fun aWipeDoesNotChangeWhichEditWinsInARestore() = runBlocking {
        val note = createNote("Diary")
        clock.advanceBy(1_000)
        val deleted = checkNotNull(notes.markDeleted(note.record.id))
        checkNotNull(notes.wipe(note.record.id) { it.copy(title = "") })

        assertEquals("The edit before the deletion is older", BackupTake.STORED_IS_NEWER, notes.takeFromBackup(note))
        assertEquals("The deletion itself is the same edit", BackupTake.SAME, notes.takeFromBackup(deleted))
        val later = note.copy(record = note.record.copy(updatedAt = deleted.record.updatedAt + 1), title = "Edited elsewhere")
        assertEquals("A later edit made elsewhere wins", BackupTake.TAKEN, notes.takeFromBackup(later))
        assertEquals("Edited elsewhere", database.notes().find(note.record.id)?.title)
    }

    @Test
    fun sealFileKeyAgainKeepsAllFourRecordFieldsAlsoOfADeletedRecord() = runBlocking {
        // The title stands in for the wrapped file key of a table that holds one.
        val shown = createNote("old key")
        val gone = createNote("old key")
        val deleted = checkNotNull(notes.markDeleted(gone.record.id))
        clock.advanceBy(60_000)

        val sealedShown = notes.sealFileKeyAgain(shown.record.id) { it.copy(title = "new key") }
        val sealedGone = notes.sealFileKeyAgain(gone.record.id) { it.copy(title = "new key") }

        assertEquals("new key", sealedShown?.title)
        assertEquals(shown.record, sealedShown?.record)
        assertEquals(4L, sealedShown?.changeNumber)
        assertEquals("new key", sealedGone?.title)
        assertEquals("Still deleted, and no time moved", deleted.record, sealedGone?.record)
        assertEquals(5L, sealedGone?.changeNumber)
        assertEquals(sealedGone, database.notes().find(gone.record.id))
    }

    @Test
    fun sealFileKeyAgainIgnoresChangesToRecordFieldsAndChangeNumber() = runBlocking {
        val note = createNote("old key")

        val sealed = notes.sealFileKeyAgain(note.record.id) { current ->
            current.copy(record = current.record.copy(updatedAt = 7, deletedAt = 7), changeNumber = 50, title = "new key")
        }

        assertEquals(note.record, sealed?.record)
        assertEquals(2L, sealed?.changeNumber)
    }

    @Test
    fun sealFileKeyAgainWritesNothingWhenThereIsNothingToSeal() = runBlocking {
        val note = createNote("key")

        assertNull(notes.sealFileKeyAgain("missing") { it.copy(title = "new key") })
        assertNull("Nothing to seal", notes.sealFileKeyAgain(note.record.id) { null })
        assertNull("Nothing changed", notes.sealFileKeyAgain(note.record.id) { it.copy(title = "key") })

        assertEquals(note, database.notes().find(note.record.id))
        assertEquals("The writes that did nothing took no change number", 2L, createNote("Next").changeNumber)
    }

    @Test
    fun aReservedIdIsTheNextOfTheIdSourceAndCreateStoresTheRecordUnderIt() = runBlocking {
        val reserved = notes.reserveId()

        assertEquals(TestIdSource.idNumber(1), reserved)
        assertEquals(setOf(reserved), notes.reservedIds())
        assertEquals("Another create takes the next ID", TestIdSource.idNumber(2), createNote("Other").record.id)

        val note = notes.create(reserved) { fields, number -> SampleNote(fields, number, title = "File", pinned = false) }

        val expected = RecordFields(id = reserved, createdAt = clock.nowMillis, updatedAt = clock.nowMillis, deletedAt = null)
        assertEquals(expected, note.record)
        assertEquals(2L, note.changeNumber)
        assertEquals(note, database.notes().find(reserved))
        assertEquals("It stays reserved until it is released", setOf(reserved), notes.reservedIds())
        notes.release(reserved)
        assertEquals(emptySet<String>(), notes.reservedIds())
    }

    @Test
    fun createTakesOnlyAnIdThatThisWriterReservedAndThatIsNotStored() = runBlocking {
        val note = createNote("Stored")
        val released = notes.reserveId().also { notes.release(it) }
        val ofTheOtherWriter = tags.reserveId()
        val reserved = notes.reserveId()
        notes.create(reserved) { fields, number -> SampleNote(fields, number, title = "File", pinned = false) }

        assertThrows(IllegalArgumentException::class.java) { runBlocking { createReserved("never reserved") } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { createReserved(note.record.id) } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { createReserved(released) } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { createReserved(ofTheOtherWriter) } }
        assertThrows("Stored already", IllegalStateException::class.java) { runBlocking { createReserved(reserved) } }

        assertEquals(listOf("Stored", "File"), database.notes().all().map { it.title })
        assertEquals("The refused creates took no change number", 3L, createNote("Next").changeNumber)
    }

    @Test
    fun aCreateWithAReservedIdRollsBackWithItsTransactionAndTheIdStaysReserved() = runBlocking {
        val reserved = notes.reserveId()

        val failure = runCatching {
            database.withWriteTransaction {
                createReserved(reserved)
                error("Stop the transaction")
            }
        }

        assertTrue(failure.isFailure)
        assertNull(database.notes().find(reserved))
        assertEquals(setOf(reserved), notes.reservedIds())
        assertEquals(reserved, createReserved(reserved).record.id)
    }

    private suspend fun createNote(title: String, pinned: Boolean = false): SampleNote =
        notes.create { fields, number -> SampleNote(fields, number, title = title, pinned = pinned) }

    private suspend fun createReserved(id: String): SampleNote =
        notes.create(id) { fields, number -> SampleNote(fields, number, title = "File", pinned = false) }
}
