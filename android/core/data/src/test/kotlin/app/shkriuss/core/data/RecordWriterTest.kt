package app.shkriuss.core.data

import androidx.room3.withWriteTransaction
import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.data.sample.SampleDatabase
import app.shkriuss.core.data.sample.SampleNote
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
 * Checks that [RecordWriter] stamps every write, that deletes only mark,
 * and that its writes are transactions on the system SQLite driver.
 */
@RunWith(RobolectricTestRunner::class)
class RecordWriterTest {
    private val clock = TestClock()
    private val ids = TestIdSource()
    private lateinit var database: SampleDatabase
    private lateinit var writer: RecordWriter<SampleNote>

    @Before
    fun openDatabase() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        database = inMemoryTestDatabaseBuilder<SampleDatabase>(context).build()
        writer = RecordWriter(database, database.notes(), clock, ids)
    }

    @After
    fun closeDatabase() {
        database.close()
    }

    @Test
    fun createGivesANewIdAndSetsBothTimesToNow() = runBlocking {
        val note = writer.create { SampleNote(it, title = "Milk", pinned = false) }

        val expected = RecordFields(
            id = TestIdSource.idNumber(1),
            createdAt = clock.nowMillis,
            updatedAt = clock.nowMillis,
            deletedAt = null,
        )
        assertEquals(expected, note.record)
        assertEquals(note, database.notes().find(note.record.id))
    }

    @Test
    fun createIgnoresRecordFieldsSetByTheCaller() = runBlocking {
        val note = writer.create { fields ->
            SampleNote(fields.copy(id = "chosen", createdAt = 1, deletedAt = 2), title = "Milk", pinned = false)
        }

        assertEquals(TestIdSource.idNumber(1), note.record.id)
        assertEquals(clock.nowMillis, note.record.createdAt)
        assertNull(note.record.deletedAt)
        assertEquals(listOf(note), database.notes().all())
    }

    @Test
    fun updateMovesUpdatedAtAndKeepsIdAndCreatedAt() = runBlocking {
        val note = writer.create { SampleNote(it, title = "Milk", pinned = false) }
        clock.advanceBy(5_000)

        val updated = writer.update(note.record.id) { it.copy(title = "Oat milk") }

        assertEquals("Oat milk", updated?.title)
        assertEquals(note.record.copy(updatedAt = clock.nowMillis), updated?.record)
        assertEquals(updated, database.notes().find(note.record.id))
    }

    @Test
    fun updateIgnoresChangesToRecordFields() = runBlocking {
        val note = writer.create { SampleNote(it, title = "Milk", pinned = false) }
        clock.advanceBy(1_000)

        val updated = writer.update(note.record.id) { current ->
            current.copy(record = current.record.copy(createdAt = 0, deletedAt = 7), pinned = true)
        }

        assertEquals(note.record.copy(updatedAt = clock.nowMillis), updated?.record)
        assertEquals(true, updated?.pinned)
    }

    @Test
    fun updateThatChangesNothingWritesNothing() = runBlocking {
        val note = writer.create { SampleNote(it, title = "Milk", pinned = false) }
        clock.advanceBy(1_000)

        val updated = writer.update(note.record.id) { it.copy(title = "Milk") }

        assertEquals(note, updated)
        assertEquals(note, database.notes().find(note.record.id))
    }

    @Test
    fun updatedAtMovesForwardWhenTheClockIsSetBack() = runBlocking {
        val note = writer.create { SampleNote(it, title = "Milk", pinned = false) }
        clock.advanceBy(-60_000)

        val updated = writer.update(note.record.id) { it.copy(title = "Oat milk") }
        val deleted = writer.markDeleted(note.record.id)

        assertEquals(note.record.updatedAt + 1, updated?.record?.updatedAt)
        assertEquals(note.record.updatedAt + 2, deleted?.record?.updatedAt)
    }

    @Test
    fun markDeletedKeepsTheRowAndSetsDeletedAt() = runBlocking {
        val note = writer.create { SampleNote(it, title = "Milk", pinned = false) }
        clock.advanceBy(2_000)

        val deleted = writer.markDeleted(note.record.id)

        val expected = note.copy(record = note.record.copy(updatedAt = clock.nowMillis, deletedAt = clock.nowMillis))
        assertEquals(expected, deleted)
        assertEquals(listOf(expected), database.notes().all())
        assertEquals(emptyList<SampleNote>(), database.notes().live())
    }

    @Test
    fun aDeletedRecordIsNotChangedOrDeletedAgain() = runBlocking {
        val note = writer.create { SampleNote(it, title = "Milk", pinned = false) }
        val deleted = writer.markDeleted(note.record.id)
        clock.advanceBy(1_000)

        assertNull(writer.update(note.record.id) { it.copy(title = "Oat milk") })
        assertNull(writer.markDeleted(note.record.id))
        assertEquals(deleted, database.notes().find(note.record.id))
    }

    @Test
    fun restoreBringsBackADeletedRecord() = runBlocking {
        val note = writer.create { SampleNote(it, title = "Milk", pinned = false) }
        writer.markDeleted(note.record.id)
        clock.advanceBy(3_000)

        val restored = writer.restore(note.record.id)

        assertEquals(note.copy(record = note.record.copy(updatedAt = clock.nowMillis)), restored)
        assertEquals(listOf(restored), database.notes().live())
        assertNull("A record that is not deleted is not restored", writer.restore(note.record.id))
    }

    @Test
    fun aMissingRecordGivesNull() = runBlocking {
        assertNull(writer.update("missing") { it.copy(title = "Milk") })
        assertNull(writer.markDeleted("missing"))
        assertNull(writer.restore("missing"))
    }

    @Test
    fun writesInsideAFailedTransactionAreRolledBack() = runBlocking {
        val kept = writer.create { SampleNote(it, title = "Kept", pinned = false) }

        val failure = runCatching {
            database.withWriteTransaction {
                writer.create { SampleNote(it, title = "Rolled back", pinned = false) }
                writer.markDeleted(kept.record.id)
                error("Stop the transaction")
            }
        }

        assertTrue(failure.isFailure)
        assertEquals(listOf(kept), database.notes().all())
    }
}
