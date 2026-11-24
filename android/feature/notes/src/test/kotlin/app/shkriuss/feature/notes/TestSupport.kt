package app.shkriuss.feature.notes

import android.content.Context
import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.core.testing.inMemoryTestDatabaseBuilder
import app.shkriuss.feature.notes.data.NotesDatabase
import app.shkriuss.feature.notes.data.SecureDelete
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.concurrent.Executor
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

/** The context of the Robolectric app. */
internal val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext

/** The time of the spec's examples: Tuesday 24 November 2026 at 09:30 UTC. */
internal val THE_TIME: Long = LocalDateTime.of(2026, 11, 24, 9, 30).toInstant(ZoneOffset.UTC).toEpochMilli()

/** A Notes database in memory, on the system SQLite driver, with `secure_delete` on. Close it at the end of the test. */
internal fun memoryDatabase(): NotesDatabase = inMemoryTestDatabaseBuilder<NotesDatabase>(context).addCallback(SecureDelete).build()

/** The cryptography of a Notes app with software keys, its keyset files in [folder], with no recovery key yet. */
internal fun cryptoIn(folder: File): SoftwareKeysApp = SoftwareKeysApp(folder, NotesServices.APP_NAME)

/** Gives [crypto] its keys from a new recovery key: the move of the file keys is then pending if files were added before. */
internal fun ShkCrypto.getRecoveryKey() {
    setup.storeDerivedKeys(setup.createRecoveryKey())
}

/** What one test of the files needs: a database, a clock, the IDs, a folder of streams and the repository on them. */
internal class Phone(folder: File) : AutoCloseable {
    val database: NotesDatabase = memoryDatabase()
    val clock = TestClock(THE_TIME)
    val ids = TestIdSource()
    val store = NoteFileStore(File(folder, "attachments"))
    val repository = NotesRepository(database, clock, ids, store)

    /** Makes a note with [title] and [body], and returns its `id`. */
    fun note(title: String = "Trip", body: String = ""): String = runBlocking {
        val id = repository.reserveNoteId()
        check(repository.save(id, title, body) == Saved.WRITTEN)
        id
    }

    override fun close() = database.close()
}

/** A file the picker gives, with [bytes] as its content. [failRead] makes the read fail after that many bytes. */
internal class TestPick(
    private val name: String? = "ticket.jpg",
    private val type: String? = "image/jpeg",
    val bytes: ByteArray = ByteArray(2_400) { it.toByte() },
    private val failOpen: Boolean = false,
    private val failRead: Int? = null,
    private val size: Long? = bytes.size.toLong(),
) : PickedFile {
    override fun name(): String? = name

    override fun type(): String? = type

    override fun reportedSize(): Long? = size

    override fun open(): InputStream {
        if (failOpen) throw IOException("Android stopped Notes meanwhile")
        val failAt = failRead ?: return ByteArrayInputStream(bytes)
        return object : InputStream() {
            private var read = 0

            override fun read(): Int {
                if (read >= failAt) throw IOException("The provider stopped")
                return if (read < bytes.size) bytes[read++].toInt() and 0xff else -1
            }
        }
    }
}

/** A file of [count] bytes that the picker gives without holding them in memory. */
internal class LongPick(private val count: Long, private val name: String = "film.mp4") : PickedFile {
    override fun name(): String = name

    override fun type(): String = "video/mp4"

    override fun reportedSize(): Long = count

    override fun open(): InputStream = object : InputStream() {
        private var left = count

        override fun read(): Int = if (left-- > 0) 7 else -1

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (left <= 0) return -1
            val now = minOf(length.toLong(), left).toInt()
            buffer.fill(7, offset, offset + now)
            left -= now
            return now
        }
    }
}

/** Where **Save a copy** writes in a test: the bytes, and whether the document was deleted. */
internal class TestTarget(private val failWrite: Boolean = false, private val canDelete: Boolean = true) : CopyTarget {
    val written = ByteArrayOutputStream()
    var deleted = false

    override fun open(): OutputStream = object : OutputStream() {
        override fun write(byte: Int) {
            if (failWrite) throw IOException("The place is full")
            written.write(byte)
        }

        override fun write(bytes: ByteArray, offset: Int, length: Int) {
            if (failWrite) throw IOException("The place is full")
            written.write(bytes, offset, length)
        }
    }

    override fun delete(): Boolean {
        deleted = canDelete
        return canDelete
    }
}

/**
 * Makes every write to [table] that SQLite would do fail from now on, as
 * when the disk is full: a trigger aborts each insert and update. Room
 * throws an `android.database.SQLException`, and the transaction rolls
 * back.
 */
internal fun NotesDatabase.refuseWritesTo(table: String) = runBlocking {
    useWriterConnection { connection ->
        connection.executeSQL("CREATE TRIGGER refuse_insert_$table BEFORE INSERT ON $table BEGIN SELECT RAISE(ABORT, 'refused'); END")
        connection.executeSQL("CREATE TRIGGER refuse_update_$table BEFORE UPDATE ON $table BEGIN SELECT RAISE(ABORT, 'refused'); END")
    }
}

/** Lets SQLite write to [table] again. */
internal fun NotesDatabase.acceptWritesTo(table: String) = runBlocking {
    useWriterConnection { connection ->
        connection.executeSQL("DROP TRIGGER refuse_insert_$table")
        connection.executeSQL("DROP TRIGGER refuse_update_$table")
    }
}

/** Makes every read of [table] fail from now on: the table is gone. Room throws an `android.database.SQLException`. */
internal fun NotesDatabase.refuseReadsOf(table: String) = runBlocking {
    useWriterConnection { connection -> connection.executeSQL("DROP TABLE $table") }
}

/** Waits up to ten seconds for a state that [condition] accepts, and returns it. */
internal fun <T> StateFlow<T>.await(condition: (T) -> Boolean): T = runBlocking {
    withTimeout(10_000) { first(condition) }
}

/** Waits up to ten seconds until [condition] is true. */
internal fun eventually(condition: () -> Boolean) {
    val end = System.currentTimeMillis() + 10_000
    while (!condition()) {
        check(System.currentTimeMillis() < end) { "Waited ten seconds in vain" }
        Thread.sleep(5)
    }
}

/** A dispatcher whose work waits until the test runs it, so that a test can stop between two steps of a coroutine. */
internal class Held {
    private val queued = LinkedBlockingQueue<Runnable>()

    /** The dispatcher: what it is given waits in a queue. */
    val dispatcher = Executor { queued.add(it) }.asCoroutineDispatcher()

    /** Runs the waiting work, and the work that it gives, until [condition] is true, for up to ten seconds. */
    fun runUntil(condition: () -> Boolean) {
        val end = System.currentTimeMillis() + 10_000
        while (!condition()) {
            check(System.currentTimeMillis() < end) { "Waited ten seconds in vain" }
            queued.poll(5, TimeUnit.MILLISECONDS)?.run()
        }
    }
}

/** The turns of Undo in a test with no snackbar: no Undo is ever open. */
internal object NoUndo : UndoTurns {
    override suspend fun <T> inTurn(action: suspend (openUndo: Set<String>) -> T): T = action(emptySet())
}
