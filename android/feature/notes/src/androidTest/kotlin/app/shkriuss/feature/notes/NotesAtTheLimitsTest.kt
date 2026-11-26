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
 * (docs/apps/notes/spec.md, "Limits and defaults"). Each test stores 5,000
 * notes and their file records, with more in them than the heap holds.
 * Then it does what Notes does with all of them: the list, a search, a
 * backup and the read of the move of the file keys. Last it marks some
 * notes deleted and runs the sweep that wipes them.
 *
 * - One test stores more text than the heap holds: so many of the notes
 *   have 100,000 characters. Each note has 20 files with the longest
 *   names.
 * - The other stores more file keys than the heap holds: each note has so
 *   many files, each with the longest key. A restore can bring a note
 *   more than 20 files.
 *
 * Code that holds every text, or every file record, in memory at once
 * runs out of memory here, and the run fails. The unit tests cannot show
 * that: they run on the heap of the build's own machine. One database
 * with both, and wiping every note at once, would need more room than
 * the emulator has.
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
        TestDevice.note("$TEXTS: a heap of ${heap / MEGA} MB, room for ${room / MEGA} MB")
        val long = longNotesFor(heap, room)
        TestDevice.note("$TEXTS: $long notes of ${NoteLimits.MOST_BODY} characters")

        notesDoesItsWork(TEXTS, Stored(long, NoteLimits.MOST_FILES_PER_NOTE, NoteLimits.MOST_NAME, SHORTEST_KEY))
    }

    @Test
    fun withMoreFileKeysThanTheHeapHoldsNotesStillListsSearchesBacksUpAndWipes() = runBlocking {
        val heap = Runtime.getRuntime().maxMemory()
        val room = context.filesDir.usableSpace
        TestDevice.note("$KEYS: a heap of ${heap / MEGA} MB, room for ${room / MEGA} MB")
        val files = filesPerNoteFor(heap, room)
        TestDevice.note("$KEYS: $files files for each note, each with a key of ${LONGEST_KEY.size} bytes")

        notesDoesItsWork(KEYS, Stored(1, files, SHORT_NAME, LONGEST_KEY))
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

    /**
     * How many files each note gets: so many that the keys of all file
     * records are at least a tenth larger than the heap. The test fails
     * if the emulator has too little [room] for them: with fewer it would
     * pass and show nothing.
     */
    private fun filesPerNoteFor(heap: Long, room: Long): Int {
        val files = heap / LONGEST_KEY.size * 11 / 10 / NOTES + 1
        val needed = files * NOTES * ROOM_PER_LONG_KEY + ROOM_FOR_THE_REST
        assertTrue("The emulator has room for ${room / MEGA} MB, and the test needs ${needed / MEGA} MB for ${files * NOTES} file records", room >= needed)
        return files.toInt()
    }

    /** Stores what [stored] says. Then every step of Notes that reads all notes or all file records, each timed under the name of the test, [test]. */
    private suspend fun notesDoesItsWork(test: String, stored: Stored) {
        val files = NOTES.toLong() * stored.filesPerNote
        val repository = NotesRepository(database, clock, ids, NoteFileStore(streams))

        val noteIds = timed(test, "stored") { store(stored) }

        val models = ViewModelStore()
        val snackbars = NotesSnackbars(repository, {}, scope, Dispatchers.IO)
        val factory = viewModelFactory { initializer { NotesListViewModel(repository, snackbars, Dispatchers.IO) } }
        val list = ViewModelProvider.create(models, factory)[NotesListViewModel::class]
        timed(test, "the list") {
            val all = list.shown("")
            assertEquals("Every note has its row", NOTES, all.size)
            assertTrue("Every row counts its files", all.all { it.fileCount == stored.filesPerNote })
        }
        timed(test, "a search in the texts") {
            list.search(WORD)
            assertEquals("The word stands at the end of every long text", stored.long, list.shown(WORD).size)
        }
        timed(test, "a search in the file names") {
            val name = fileName(NOTES - 1, 0, stored.nameLength).take(NAME_START)
            list.search(name)
            assertEquals("Only the files of the last note start with it", 1, list.shown(name).size)
        }
        models.clear()

        timed(test, "a backup") {
            val sink = CountingSink()
            NotesBackupContent(database, repository, clock, ids).list(sink)
            assertEquals("Every note and every file record is in the backup", NOTES + files, sink.records)
            assertEquals("No stream is on this phone", files, sink.leftOut)
            assertEquals(0L, sink.files)
        }
        timed(test, "the read of the move of the file keys") {
            assertEquals("No key needs a new seal", 0, repository.filesToSealAgain(emptySet()) { false }.size)
        }
        timed(test, "the wipe of $SWEPT notes") {
            val writer = RecordWriter(database, database.notes(), clock, ids)
            noteIds.take(SWEPT).chunked(BATCH).forEach { batch -> database.withWriteTransaction { batch.forEach { writer.markDeleted(it) } } }
            assertTrue("The sweep wipes them and their files", repository.sweep(NoOpenUndo))
            assertEquals(SWEPT.toLong(), count("SELECT COUNT(*) FROM note WHERE deletedAt IS NOT NULL"))
            assertEquals("No deleted note keeps its text", 0L, count("SELECT COUNT(*) FROM note WHERE deletedAt IS NOT NULL AND body != ''"))
            assertEquals("No file of a deleted note is still shown", (NOTES - SWEPT).toLong() * stored.filesPerNote, count("SELECT COUNT(*) FROM attachment WHERE deletedAt IS NULL"))
            assertEquals("No deleted file keeps its name", 0L, count("SELECT COUNT(*) FROM attachment WHERE deletedAt IS NOT NULL AND name != ''"))
        }
    }

    /** Stores [NOTES] notes, the first [Stored.long] of them with the longest text, each with its files. Returns their `id`s in that order. */
    private suspend fun store(stored: Stored): List<String> {
        val notes = RecordWriter(database, database.notes(), clock, ids)
        val files = RecordWriter(database, database.attachments(), clock, ids)
        val noteIds = ArrayList<String>(NOTES)
        (0 until NOTES).chunked(BATCH).forEach { batch ->
            database.withWriteTransaction {
                batch.forEach { number ->
                    val text = if (number < stored.long) LONG_TEXT else "Short"
                    noteIds += notes.create { fields, change -> NoteEntity(fields, change, "Note $number", text, false, 0) }.record.id
                }
            }
        }
        noteIds.withIndex().chunked(BATCH).forEach { batch ->
            database.withWriteTransaction {
                batch.forEach { (number, noteId) ->
                    repeat(stored.filesPerNote) { file ->
                        val name = fileName(number, file, stored.nameLength)
                        files.create { fields, change -> AttachmentEntity(fields, change, noteId, name, "image/jpeg", FILE_BYTES, stored.key) }
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

    /** Runs [step] and writes down how long it took, under the name of the test, [test]. A step that runs out of memory ends the run before its line. */
    private suspend fun <T> timed(test: String, name: String, step: suspend () -> T): T {
        val start = System.nanoTime()
        val result = step()
        TestDevice.note("$test: $name, ${(System.nanoTime() - start) / NANOS_PER_SECOND} s")
        return result
    }

    /**
     * What one test stores: [long] of the notes have the longest text, and
     * each note has [filesPerNote] files, each with a name of [nameLength]
     * characters and the wrapped key [key].
     */
    private class Stored(val long: Int, val filesPerNote: Int, val nameLength: Int, val key: ByteArray)

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
        const val BATCH = 50
        const val WORD = "needle"
        const val FILE_BYTES = 1_000L
        const val MEGA = 1_000_000L
        const val NANOS_PER_SECOND = 1_000_000_000L

        /** How the lines of the test with more text than the heap holds start. */
        const val TEXTS = "Notes at its limits, the texts"

        /** How the lines of the test with more file keys than the heap holds start. */
        const val KEYS = "Notes at its limits, the file keys"

        /** Fifteen minutes: the emulator reads and writes hundreds of megabytes. */
        const val WAIT_MILLIS = 15 * 60 * 1_000L

        /** How many notes are marked deleted for the sweep: the first ones, which are long notes in the test of the texts. */
        const val SWEPT = 200

        /** The room one long note takes in the database: its text, and a tenth more. */
        const val ROOM_PER_LONG_NOTE = NoteLimits.MOST_BODY * 11L / 10

        /**
         * The room one file record with the longest key and a name of
         * [SHORT_NAME] characters takes in the database: three fit a page
         * of 4,096 bytes, and its three index entries take a tenth more.
         */
        const val ROOM_PER_LONG_KEY = 1_500L

        /** The room for what is small in a test: the short notes, the file records with short keys, the write-ahead file while [SWEPT] notes are wiped, and a margin. */
        const val ROOM_FOR_THE_REST = 150 * MEGA

        /** 999 lines of 100 characters, and a last line of 100 that starts with [WORD]: 100,000 characters. */
        val LONG_TEXT: String = ("x".repeat(99) + "\n").repeat(999) + WORD.padEnd(100, 'x')

        /** A wrapped key of the shortest form: the five bytes that every blob of kind 4 starts with, then zeros. */
        val SHORTEST_KEY: ByteArray = keyOf(NoteLimits.WRAPPED_KEY_LENGTH.first)

        /** A wrapped key of the longest form. */
        val LONGEST_KEY: ByteArray = keyOf(NoteLimits.WRAPPED_KEY_LENGTH.last)

        /**
         * The length of a file name beside the longest key. With the
         * longest name too, only two records would fit a page of the
         * database, and the test would need more room than the emulator has.
         */
        const val SHORT_NAME = 20

        /** How many characters at its start set a name apart from every other: "t0004999-00-". */
        const val NAME_START = 12

        private fun keyOf(length: Int): ByteArray = NoteLimits.WRAPPED_KEY_START + ByteArray(length - NoteLimits.WRAPPED_KEY_START.size)

        /** The name of the file [file] of the note [note], [length] characters long: "t0004999-00-yyy….jpg". */
        fun fileName(note: Int, file: Int, length: Int): String = "t%07d-%02d-".format(note, file).padEnd(length - 4, 'y') + ".jpg"
    }
}
