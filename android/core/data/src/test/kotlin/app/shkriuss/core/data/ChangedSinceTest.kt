package app.shkriuss.core.data

import android.database.sqlite.SQLiteDatabase
import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.data.sample.SampleDatabase
import app.shkriuss.core.data.sample.SampleNote
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Checks the "changed since" query pattern: every change is read exactly
 * once, in order, deleted records included, also when records share the
 * same `updatedAt`, and SQLite serves it from the index.
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
        // Four notes in the same millisecond, then two more later. With one
        // of the four deleted, the other three fill a page and a half, so
        // records with the same updatedAt are split across pages.
        val sameTime = List(4) { index -> create("Same time $index") }
        clock.advanceBy(10)
        val later = List(2) { index -> create("Later $index") }
        clock.advanceBy(10)
        val deleted = writer.markDeleted(sameTime[1].record.id)!!

        val read = readAllInPages(ChangeCursor.Start, pageSize = 2)

        val expected = listOf(sameTime[0], sameTime[2], sameTime[3]) + later + deleted
        assertEquals(expected, read)
    }

    @Test
    fun aChangeAfterTheLastPageIsReadFromTheLastCursor() = runBlocking {
        val notes = List(3) { index -> create("Note $index") }
        val firstRead = readAllInPages(ChangeCursor.Start, pageSize = 10)
        val cursor = ChangeCursor.of(firstRead.last().record)
        clock.advanceBy(10)

        val updated = writer.update(notes[0].record.id) { it.copy(title = "Changed") }!!

        assertEquals(notes, firstRead)
        assertEquals(listOf(updated), database.notes().changedSince(cursor, limit = 10))
    }

    @Test
    fun nothingChangedGivesAnEmptyPage() = runBlocking {
        create("Note")
        val cursor = ChangeCursor.of(readAllInPages(ChangeCursor.Start, pageSize = 10).last().record)

        assertEquals(emptyList<SampleNote>(), database.notes().changedSince(cursor, limit = 10))
    }

    @Test
    fun aLimitBelowOneIsRefused() {
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { database.notes().changedSince(ChangeCursor.Start, limit = 0) }
        }
    }

    @Test
    fun sqliteReadsTheChangeIndexAndDoesNotSort() {
        // A table that follows the record conventions. AndroidSQLiteDriver
        // cannot run EXPLAIN, so this uses the framework's SQLiteDatabase.
        val plan = SQLiteDatabase.create(null).use { db ->
            db.execSQL(
                "CREATE TABLE note (id TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, " +
                    "deletedAt INTEGER, title TEXT NOT NULL, PRIMARY KEY(id))",
            )
            db.execSQL("CREATE INDEX index_note_updatedAt_id ON note (updatedAt, id)")
            db.rawQuery("EXPLAIN QUERY PLAN SELECT * FROM note WHERE " + RecordSql.CHANGED_SINCE, arrayOf("0", "", "10"))
                .use { cursor -> buildList { while (cursor.moveToNext()) add(cursor.getString(3)) } }
        }.joinToString("\n")

        assertTrue(plan, plan.contains("INDEX index_note_updatedAt_id"))
        assertFalse(plan, plan.contains("TEMP B-TREE"))
    }

    private suspend fun create(title: String): SampleNote =
        writer.create { SampleNote(it, title = title, pinned = false) }

    private suspend fun readAllInPages(start: ChangeCursor, pageSize: Int): List<SampleNote> {
        val read = mutableListOf<SampleNote>()
        var cursor = start
        while (true) {
            val page = database.notes().changedSince(cursor, pageSize)
            read += page
            if (page.size < pageSize) return read
            cursor = ChangeCursor.of(page.last().record)
        }
    }
}
