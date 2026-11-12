package app.shkriuss.core.data

import android.database.sqlite.SQLiteDatabase
import androidx.room3.withWriteTransaction
import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.data.sample.SampleDatabase
import app.shkriuss.core.data.sample.SampleNote
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Checks the "changed since" query pattern: every change is read exactly
 * once, in change number order, deleted records included; a clock set
 * back hides nothing; a write that commits while a reader is paging is
 * read after it; and SQLite serves the query from the index.
 */
@RunWith(RobolectricTestRunner::class)
class ChangedSinceTest {
    private val clock = TestClock()
    private lateinit var database: SampleDatabase
    private lateinit var writer: RecordWriter<SampleNote>

    @Before
    fun openDatabase() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        database = inMemoryTestDatabaseBuilder<SampleDatabase>(context).build()
        writer = RecordWriter(database, database.notes(), clock, TestIdSource())
    }

    @After
    fun closeDatabase() {
        database.close()
    }

    @Test
    fun pagesReadEveryChangeOnceInOrderWithDeletedRecords() = runBlocking {
        // Notes in the same millisecond get different change numbers.
        val notes = List(5) { index -> create(writer, "Note $index") }
        val deleted = writer.markDeleted(notes[1].record.id)!!

        val read = readAllInPages(database, after = BEFORE_FIRST_CHANGE, pageSize = 2)

        val expected = listOf(notes[0], notes[2], notes[3], notes[4], deleted)
        assertEquals(expected, read)
    }

    @Test
    fun aChangeAfterTheLastPageIsReadFromTheLastChangeNumber() = runBlocking {
        val notes = List(3) { index -> create(writer, "Note $index") }
        val firstRead = readAllInPages(database, after = BEFORE_FIRST_CHANGE, pageSize = 10)
        clock.advanceBy(10)

        val updated = writer.update(notes[0].record.id) { it.copy(title = "Changed") }!!

        assertEquals(notes, firstRead)
        assertEquals(listOf(updated), database.notes().changedSince(firstRead.last().changeNumber, limit = 10))
    }

    @Test
    fun aClockSetBackHidesNoChange() = runBlocking {
        val early = create(writer, "Early")
        clock.advanceBy(3_600_000)
        val late = create(writer, "Late")
        val read = readAllInPages(database, after = BEFORE_FIRST_CHANGE, pageSize = 10)
        // The clock goes back two hours, to before both notes.
        clock.advanceBy(-7_200_000)

        val changed = writer.update(early.record.id) { it.copy(title = "Early, changed") }!!

        assertEquals(listOf(early, late), read)
        assertTrue(
            "By updatedAt the change would sort before what the reader already read",
            changed.record.updatedAt < late.record.updatedAt,
        )
        assertEquals(listOf(changed), database.notes().changedSince(read.last().changeNumber, limit = 10))
    }

    @Test
    fun aWriteThatCommitsWhileAReaderIsPagingIsReadAfterIt() {
        // A database file, so the reader and the writer use separate
        // connections at the same time, as in an app.
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase(PAGING_FILE)
        val fileDatabase = systemSqliteDatabaseBuilder<SampleDatabase>(context, PAGING_FILE).build()
        val fileWriter = RecordWriter(fileDatabase, fileDatabase.notes(), clock, TestIdSource())
        try {
            runBlocking {
                val committed = List(4) { index -> create(fileWriter, "Note $index") }
                val firstPage = fileDatabase.notes().changedSince(BEFORE_FIRST_CHANGE, limit = 2)

                // A write takes its change number, then waits before it commits.
                val numbered = CompletableDeferred<SampleNote>()
                val mayCommit = CompletableDeferred<Unit>()
                val write = async(Dispatchers.IO) {
                    fileDatabase.withWriteTransaction {
                        val note = create(fileWriter, "Written while reading")
                        numbered.complete(note)
                        mayCommit.await()
                        note
                    }
                }
                val late = numbered.await()

                // The reader goes on while the write is open, and then after it.
                val restWhileOpen = readAllInPages(fileDatabase, after = firstPage.last().changeNumber, pageSize = 2)
                mayCommit.complete(Unit)
                write.await()
                val afterCommit = readAllInPages(fileDatabase, after = restWhileOpen.last().changeNumber, pageSize = 2)

                assertEquals(committed, firstPage + restWhileOpen)
                assertEquals(listOf(late), afterCommit)
                assertTrue(late.changeNumber > committed.maxOf { it.changeNumber })
            }
        } finally {
            fileDatabase.close()
            context.deleteDatabase(PAGING_FILE)
        }
    }

    @Test
    fun sqliteReadsTheChangeIndexAndDoesNotSort() {
        // A table that follows the record conventions. AndroidSQLiteDriver
        // cannot run EXPLAIN, so this uses the framework's SQLiteDatabase.
        val plan = SQLiteDatabase.create(null).use { db ->
            db.execSQL(
                "CREATE TABLE note (id TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, " +
                    "deletedAt INTEGER, changeNumber INTEGER NOT NULL, title TEXT NOT NULL, PRIMARY KEY(id))",
            )
            db.execSQL("CREATE UNIQUE INDEX index_note_changeNumber ON note (changeNumber)")
            db.rawQuery("EXPLAIN QUERY PLAN SELECT * FROM note WHERE " + RecordSql.CHANGED_SINCE, arrayOf("0", "10"))
                .use { cursor -> buildList { while (cursor.moveToNext()) add(cursor.getString(3)) } }
        }.joinToString("\n")

        assertTrue(plan, plan.contains("INDEX index_note_changeNumber"))
        assertFalse(plan, plan.contains("TEMP B-TREE"))
    }

    private suspend fun create(writer: RecordWriter<SampleNote>, title: String): SampleNote =
        writer.create { fields, number -> SampleNote(fields, number, title = title, pinned = false) }

    private suspend fun readAllInPages(database: SampleDatabase, after: Long, pageSize: Int): List<SampleNote> {
        val read = mutableListOf<SampleNote>()
        var cursor = after
        while (true) {
            val page = database.notes().changedSince(cursor, pageSize)
            read += page
            if (page.size < pageSize) return read
            cursor = page.last().changeNumber
        }
    }

    private companion object {
        const val PAGING_FILE = "changed-since-paging.db"
    }
}
