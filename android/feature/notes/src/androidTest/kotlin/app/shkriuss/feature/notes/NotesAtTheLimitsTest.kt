package app.shkriuss.feature.notes

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.room3.useReaderConnection
import androidx.room3.withWriteTransaction
import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.backup.BackupSink
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestDevice
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.notes.data.AttachmentEntity
import app.shkriuss.feature.notes.data.NoteEntity
import app.shkriuss.feature.notes.data.NotesDatabase
import java.io.File
import java.io.InputStream
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Notes at its limits, on the heap a real Android gives an app
 * (docs/apps/notes/spec.md, "Limits and defaults"). It stores 5,000 notes,
 * of which so many hold 100,000 characters that their texts are larger
 * than the heap, and 100,000 file records with the longest names. Then
 * it does what Notes does with all of them: the list, a search, a
 * backup and the read of the move of the file keys. Last it marks some
 * of the long notes deleted and runs the sweep that wipes them. Wiping
 * every long note at once would need more room than the emulator has.
 *
 * Code that holds every text or every file record in memory at once runs
 * out of memory here, and the run fails. The unit tests cannot show that:
 * they run on the heap of the build's own machine.
 */
class NotesAtTheLimitsTest {
    private val context = TestDevice.context
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val clock = TestClock()
    private val ids = TestIdSource()
    private val streams = File(context.noBackupFilesDir, "limits-attachments")
    private lateinit var database: NotesDatabase

    @Before
    fun anEmptyDatabase() {
        context.deleteDatabase(NotesDatabase.FILE_NAME)
        database = NotesDatabase.open(context)
    }

    @After
    fun deleteTheDatabase() {
        scope.cancel()
        database.close()
        context.deleteDatabase(NotesDatabase.FILE_NAME)
        streams.deleteRecursively()
    }

    @Test
    fun withMoreTextThanTheHeapHoldsNotesStillListsSearchesBacksUpAndWipes() = runBlocking {
        val heap = Runtime.getRuntime().maxMemory()
        val room = context.filesDir.usableSpace
        TestDevice.note("Notes at its limits: a heap of ${heap / MEGA} MB, room for ${room / MEGA} MB")
        val long = longNotesFor(heap, room)
        TestDevice.note("Notes at its limits: $long notes of ${NoteLimits.MOST_BODY} characters")
        val repository = NotesRepository(database, clock, ids, NoteFileStore(streams))

        val noteIds = timed("stored") { store(long) }
        val longIds = noteIds.take(long)

        val models = ViewModelStore()
        val snackbars = NotesSnackbars(repository, {}, scope, Dispatchers.IO)
        val factory = viewModelFactory { initializer { NotesListViewModel(repository, snackbars, Dispatchers.IO) } }
        val list = ViewModelProvider.create(models, factory)[NotesListViewModel::class]
        timed("the list") {
            val all = list.shown("")
            assertEquals("Every note has its row", NOTES, all.size)
            assertTrue("Every row counts its files", all.all { it.fileCount == NoteLimits.MOST_FILES_PER_NOTE })
        }
        timed("a search in the texts") {
            list.search(WORD)
            assertEquals("The word stands at the end of every long text", long, list.shown(WORD).size)
        }
        timed("a search in the file names") {
            val name = fileName(NOTES - 1, 0).take(NAME_START)
            list.search(name)
            assertEquals("Only the files of the last note start with it", 1, list.shown(name).size)
        }
        models.clear()

        timed("a backup") {
            val sink = CountingSink()
            NotesBackupContent(database, repository, clock, ids).list(sink)
            assertEquals("Every note and every file record is in the backup", (NOTES + FILES).toLong(), sink.records)
            assertEquals("No stream is on this phone", FILES.toLong(), sink.leftOut)
            assertEquals(0L, sink.files)
        }
        timed("the read of the move of the file keys") {
            assertEquals("No key needs a new seal", 0, repository.filesToSealAgain(emptySet()) { false }.size)
        }
        timed("the wipe of $SWEPT long notes") {
            val writer = RecordWriter(database, database.notes(), clock, ids)
            longIds.take(SWEPT).chunked(BATCH).forEach { batch -> database.withWriteTransaction { batch.forEach { writer.markDeleted(it) } } }
            assertTrue("The sweep wipes them and their files", repository.sweep(NoOpenUndo))
            assertEquals(SWEPT.toLong(), count("SELECT COUNT(*) FROM note WHERE deletedAt IS NOT NULL"))
            assertEquals("No deleted note keeps its text", 0L, count("SELECT COUNT(*) FROM note WHERE deletedAt IS NOT NULL AND body != ''"))
            assertEquals("No file of a deleted note is still shown", (NOTES - SWEPT) * NoteLimits.MOST_FILES_PER_NOTE.toLong(), count("SELECT COUNT(*) FROM attachment WHERE deletedAt IS NULL"))
            assertEquals("No deleted file keeps its name", 0L, count("SELECT COUNT(*) FROM attachment WHERE deletedAt IS NOT NULL AND name != ''"))
        }
    }

    /**
     * How many notes get a text of 100,000 characters: so many that the
     * texts are a tenth larger than the heap could hold at one byte a
     * character, or every note. The test fails if even every note has
     * less text than the heap holds, or if the emulator has too little
     * [room] for it: with less text it would pass and show nothing.
     */
    private fun longNotesFor(heap: Long, room: Long): Int {
        val long = minOf(heap / NoteLimits.MOST_BODY * 11 / 10 + 1, NOTES.toLong())
        assertTrue("A heap of ${heap / MEGA} MB holds every text that $NOTES notes can have, so this test can show nothing here", long * NoteLimits.MOST_BODY > heap)
        val needed = long * ROOM_PER_LONG_NOTE + ROOM_FOR_THE_REST
        assertTrue("The emulator has room for ${room / MEGA} MB, and the test needs ${needed / MEGA} MB for $long long notes", room >= needed)
        return long.toInt()
    }

    /** Stores [NOTES] notes, the first [long] of them with the longest text, each with 20 files. Returns their `id`s in that order. */
    private suspend fun store(long: Int): List<String> {
        val notes = RecordWriter(database, database.notes(), clock, ids)
        val files = RecordWriter(database, database.attachments(), clock, ids)
        val noteIds = ArrayList<String>(NOTES)
        (0 until NOTES).chunked(BATCH).forEach { batch ->
            database.withWriteTransaction {
                batch.forEach { number ->
                    val text = if (number < long) LONG_TEXT else "Short"
                    noteIds += notes.create { fields, change -> NoteEntity(fields, change, "Note $number", text, false, 0) }.record.id
                }
            }
        }
        noteIds.withIndex().chunked(BATCH).forEach { batch ->
            database.withWriteTransaction {
                batch.forEach { (number, noteId) ->
                    repeat(NoteLimits.MOST_FILES_PER_NOTE) { file ->
                        files.create { fields, change -> AttachmentEntity(fields, change, noteId, fileName(number, file), "image/jpeg", FILE_BYTES, KEY) }
                    }
                }
            }
        }
        return noteIds
    }

    /** The rows the list shows for the search [query], once it shows them. */
    private suspend fun NotesListViewModel.shown(query: String): List<NoteRowState> = withTimeout(WAIT_MILLIS) {
        val shown = state.first { (it.list as? NotesListState.Shown)?.query == query }.list as NotesListState.Shown
        shown.pinned + shown.others
    }

    private suspend fun count(sql: String): Long = database.useReaderConnection { connection ->
        connection.usePrepared(sql) { statement ->
            check(statement.step())
            statement.getLong(0)
        }
    }

    /** Runs [step] and writes down how long it took. A step that runs out of memory ends the run before its line. */
    private suspend fun <T> timed(name: String, step: suspend () -> T): T {
        val start = System.nanoTime()
        val result = step()
        TestDevice.note("Notes at its limits: $name, ${(System.nanoTime() - start) / NANOS_PER_SECOND} s")
        return result
    }

    /** A backup that counts what it is given and keeps none of it. */
    private class CountingSink : BackupSink {
        var records = 0L
        var files = 0L
        var leftOut = 0L

        override suspend fun record(record: BackupRecord) {
            records++
        }

        override suspend fun file(id: String, length: Long, content: InputStream) {
            files++
        }

        override fun filesLeftOut(count: Long) {
            leftOut += count
        }
    }

    /** No Undo is open: the sweep may wipe every deleted record. */
    private object NoOpenUndo : UndoTurns {
        override suspend fun <T> inTurn(action: suspend (openUndo: Set<String>) -> T): T = action(emptySet())
    }

    private companion object {
        const val NOTES = NoteLimits.MOST_NOTES
        const val FILES = NOTES * NoteLimits.MOST_FILES_PER_NOTE
        const val BATCH = 50
        const val WORD = "needle"
        const val FILE_BYTES = 1_000L
        const val MEGA = 1_000_000L
        const val NANOS_PER_SECOND = 1_000_000_000L

        /** Fifteen minutes: the emulator reads and writes hundreds of megabytes. */
        const val WAIT_MILLIS = 15 * 60 * 1_000L

        /** How many of the long notes are marked deleted for the sweep. */
        const val SWEPT = 200

        /** The room one long note takes in the database: its text, and a tenth more. */
        const val ROOM_PER_LONG_NOTE = NoteLimits.MOST_BODY * 11L / 10

        /** The room for the file records, the short notes, the write-ahead file while [SWEPT] notes are wiped, and a margin. */
        const val ROOM_FOR_THE_REST = 150 * MEGA

        /** 999 lines of 100 characters, and a last line of 100 that starts with [WORD]: 100,000 characters. */
        val LONG_TEXT: String = ("x".repeat(99) + "\n").repeat(999) + WORD.padEnd(100, 'x')

        /** A wrapped key of the shortest form: the five bytes that every blob of kind 4 starts with, then zeros. */
        val KEY: ByteArray = NoteLimits.WRAPPED_KEY_START + ByteArray(NoteLimits.WRAPPED_KEY_LENGTH.first - NoteLimits.WRAPPED_KEY_START.size)

        /** How much of a name is the same for every file of one note. */
        const val NAME_START = 12

        /** The name of the file [file] of the note [note], 255 characters long: "t0004999-00-yyy….jpg". */
        fun fileName(note: Int, file: Int): String = "t%07d-%02d-".format(note, file).padEnd(NoteLimits.MOST_NAME - 4, 'y') + ".jpg"
    }
}
