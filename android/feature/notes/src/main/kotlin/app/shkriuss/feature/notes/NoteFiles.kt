package app.shkriuss.feature.notes

import android.content.ContentResolver
import android.database.SQLException
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import app.shkriuss.core.crypto.BlobAnswer
import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.FileCrypto
import app.shkriuss.core.crypto.FileKey
import java.io.FileInputStream
import java.io.FilterInputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.Collections
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * One file the system's "open document" screen gave (docs/apps/notes/spec.md,
 * "Adding a file", point 1). Notes keeps no lasting permission: it reads
 * the file once, when its add starts.
 */
interface PickedFile {
    /** The name the picker gives, or null. */
    fun name(): String?

    /** The type the picker gives, or null. */
    fun type(): String?

    /** The size the picker reports, for the progress bar only, or null. The count of the bytes read is the truth. */
    fun reportedSize(): Long?

    /** Opens the file to read it. Throws [IOException] or [SecurityException] if it cannot be read now. */
    fun open(): InputStream
}

/** A document the picker gave, read through [resolver]. */
class PickedDocument(private val resolver: ContentResolver, private val uri: Uri) : PickedFile {
    override fun name(): String? = column(OpenableColumns.DISPLAY_NAME) { cursor, index -> cursor.getString(index) }

    override fun type(): String? = resolver.getType(uri)

    override fun reportedSize(): Long? = column(OpenableColumns.SIZE) { cursor, index -> if (cursor.isNull(index)) null else cursor.getLong(index) }

    override fun open(): InputStream = resolver.openInputStream(uri) ?: throw FileNotFoundException("The picker gave no file")

    private fun <T> column(name: String, read: (android.database.Cursor, Int) -> T?): T? = try {
        resolver.query(uri, arrayOf(name), null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(name)
            if (index >= 0 && cursor.moveToFirst()) read(cursor, index) else null
        }
    } catch (_: RuntimeException) {
        // A provider that cannot answer gives no name: the file is called "File".
        null
    }
}

/** Where **Save a copy** writes: the document that Android's "create document" screen made. */
interface CopyTarget {
    /** Opens the document to write, in the mode that cuts off old content. */
    fun open(): OutputStream

    /** Tries to delete the document. False if it could not. */
    fun delete(): Boolean
}

/** A document the "create document" screen made, written through [resolver]. */
class ChosenDocument(private val resolver: ContentResolver, private val uri: Uri) : CopyTarget {
    override fun open(): OutputStream = resolver.openOutputStream(uri, "wt") ?: throw FileNotFoundException("No document to write")

    override fun delete(): Boolean = try {
        DocumentsContract.deleteDocument(resolver, uri)
    } catch (_: Exception) {
        // A provider that refuses or fails leaves the document: Notes says so.
        false
    }
}

/** What the row of a file says when it cannot be opened (docs/apps/notes/spec.md, "Files that cannot be opened"). */
enum class FileState {
    /** It can be opened. */
    READY,

    /** "Not on this phone": its stream is not here. */
    NOT_ON_PHONE,

    /** "Notes cannot open its files now. Open Recovery key in Settings.": the app lock was reset, or a keyset file is damaged. */
    KEYS_NOT_USABLE,

    /** "This file can no longer be opened": its key was given up, or needs another recovery key. */
    NO_LONGER_OPENS,

    /** "This file is damaged": its wrapped key or its stream is damaged, cut, or of the wrong length. */
    DAMAGED,
}

/** What **Save a copy** did (docs/apps/notes/spec.md, "Showing an image, and saving a copy" and "A write fails"). */
enum class CopyResult {
    /** "Copy saved". */
    SAVED,

    /** "This file is damaged. No copy was saved.": the document was deleted. */
    DAMAGED,

    /** "This file is damaged. Part of it may be in the place you chose. Delete it there." */
    DAMAGED_PART_LEFT,

    /** "Could not save the copy.": the document was deleted. */
    FAILED,

    /** "Could not save the copy. Part of it may be in the place you chose. Delete it there." */
    FAILED_PART_LEFT,

    /** Another copy is being saved: one copy at a time. Nothing was written. */
    BUSY,
}

/**
 * Reads the files of the notes: the state of each row, the stream of a
 * file decrypted in memory for an image, and **Save a copy**, the one way
 * a file leaves Notes (docs/apps/notes/spec.md, "Showing an image, and
 * saving a copy"). A stream is checked segment by segment as it is read,
 * and is whole only when it has ended without an error. Nothing Notes
 * decrypts is written anywhere but into the document the user chose.
 */
class FileReader(
    private val repository: NotesRepository,
    private val files: FileCrypto,
    /** True if a keyset file is damaged: then no file opens until the recovery key repairs it or the files are given up. */
    private val keysetIsDamaged: () -> Boolean,
    private val work: CoroutineContext,
) {
    private val copying = Mutex()

    /** The files whose stream a read found damaged while Notes runs. A stream never changes, so it stays damaged. */
    private val foundDamaged: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())

    /**
     * The state of [file], from its stream on the phone and from what
     * `FileCrypto` answers for its key. A stream of the right length is
     * checked segment by segment only as it is read: once a read, an
     * image or a copy, met damage, the file is damaged from then on.
     */
    suspend fun stateOf(file: NoteFile): FileState = withContext(work) {
        val store = repository.store
        when {
            !store.has(file.id) -> FileState.NOT_ON_PHONE
            !store.isWhole(file.id, file.size) || file.id in foundDamaged -> FileState.DAMAGED
            else -> try {
                val wrapped = repository.wrappedKeyOf(file.id) ?: return@withContext FileState.NOT_ON_PHONE
                files.unwrap(file.id, wrapped)
                FileState.READY
            } catch (refused: BlobException) {
                stateOf(refused.answer)
            } catch (_: SQLException) {
                FileState.KEYS_NOT_USABLE
            }
        }
    }

    /**
     * Opens the stream of [file], decrypted. A read throws [BlobException]
     * at the first segment that is damaged; the file counts as whole only
     * when the stream has ended without one. Throws [BlobException] or
     * [IOException] if it cannot be opened. Close it after use.
     */
    suspend fun open(file: NoteFile): InputStream = withContext(work) {
        val wrapped = repository.wrappedKeyOf(file.id) ?: throw FileNotFoundException("The file is deleted")
        val key = files.unwrap(file.id, wrapped)
        val input = FileInputStream(repository.store.stream(file.id))
        val decrypting = try {
            key.decryptingStream(file.id, input)
        } catch (failed: Exception) {
            input.close()
            if (failed is BlobException && failed.answer == BlobAnswer.DAMAGED_OR_CHANGED) foundDamaged += file.id
            throw failed
        }
        Noticing(decrypting) { foundDamaged += file.id }
    }

    /** A decrypted stream that tells [onDamage] when a read meets a damaged segment. */
    private class Noticing(input: InputStream, private val onDamage: () -> Unit) : FilterInputStream(input) {
        override fun read(): Int = noticing { super.read() }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int = noticing { super.read(buffer, offset, length) }

        override fun skip(count: Long): Long = noticing { super.skip(count) }

        private inline fun <T> noticing(read: () -> T): T {
            try {
                return read()
            } catch (damaged: BlobException) {
                if (damaged.answer == BlobAnswer.DAMAGED_OR_CHANGED) onDamage()
                throw damaged
            }
        }
    }

    /**
     * **Save a copy** of [file] into [target]: decrypted, byte for byte as
     * it was picked, with [progress] given the bytes written. One copy at a
     * time. A copy that meets damage or a failed write stops, and Notes
     * tries to delete the document.
     */
    suspend fun saveCopy(file: NoteFile, target: CopyTarget, progress: (Long) -> Unit = {}): CopyResult {
        if (!copying.tryLock()) return CopyResult.BUSY
        try {
            return withContext(work) {
                when (copy(file, target, progress)) {
                    Outcome.SAVED -> CopyResult.SAVED
                    Outcome.DAMAGED -> if (target.delete()) CopyResult.DAMAGED else CopyResult.DAMAGED_PART_LEFT
                    Outcome.FAILED -> if (target.delete()) CopyResult.FAILED else CopyResult.FAILED_PART_LEFT
                }
            }
        } finally {
            copying.unlock()
        }
    }

    private enum class Outcome { SAVED, DAMAGED, FAILED }

    private suspend fun copy(file: NoteFile, target: CopyTarget, progress: (Long) -> Unit): Outcome {
        val source = try {
            open(file)
        } catch (refused: BlobException) {
            return if (refused.answer == BlobAnswer.DAMAGED_OR_CHANGED && !keysetIsDamaged()) Outcome.DAMAGED else Outcome.FAILED
        } catch (_: IOException) {
            return Outcome.FAILED
        } catch (_: SQLException) {
            return Outcome.FAILED
        }
        return source.use { input ->
            val output = try {
                target.open()
            } catch (_: Exception) {
                // A provider that refuses to write fails the copy as a full disk does.
                return Outcome.FAILED
            }
            try {
                var written = 0L
                val buffer = ByteArray(BUFFER)
                while (true) {
                    val read = try {
                        input.read(buffer)
                    } catch (damaged: BlobException) {
                        return if (damaged.answer == BlobAnswer.DAMAGED_OR_CHANGED) Outcome.DAMAGED else Outcome.FAILED
                    } catch (_: IOException) {
                        return Outcome.FAILED
                    }
                    if (read < 0) break
                    output.write(buffer, 0, read)
                    written += read
                    progress(written)
                }
                output.close()
                // A stream that decrypts to another length than its record says is not the file that was picked.
                if (written == file.size) {
                    Outcome.SAVED
                } else {
                    foundDamaged += file.id
                    Outcome.DAMAGED
                }
            } catch (_: IOException) {
                Outcome.FAILED
            } finally {
                try {
                    output.close()
                } catch (_: IOException) {
                    // Closed already, or the failure is reported.
                }
            }
        }
    }

    /** The state a refusal of `core/crypto` gives. A damaged keyset file makes every file wait for the recovery key. */
    private fun stateOf(answer: BlobAnswer): FileState = when (answer) {
        BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW -> FileState.KEYS_NOT_USABLE
        BlobAnswer.NEEDS_ANOTHER_RECOVERY_KEY -> if (keysetIsDamaged()) FileState.KEYS_NOT_USABLE else FileState.NO_LONGER_OPENS
        BlobAnswer.DAMAGED_OR_CHANGED -> if (keysetIsDamaged()) FileState.KEYS_NOT_USABLE else FileState.DAMAGED
        BlobAnswer.NOT_ONE_OF_OURS, BlobAnswer.MADE_BY_A_NEWER_VERSION, BlobAnswer.WRONG_KIND -> FileState.DAMAGED
    }

    private companion object {
        const val BUFFER = 64 * 1024
    }
}

/** A file that is waiting to be added, or being added: its row says "Adding ticket.jpg", with a progress bar. */
data class AddingFile(
    /** A number for the row, unique while Notes runs. */
    val key: Long,
    /** The note it goes to. */
    val noteId: String,
    /** Its name, once the add read it from the picker. */
    val name: String?,
    /** The bytes copied so far. */
    val done: Long,
    /** The size the picker reported, or null: the bar then shows no fraction. */
    val total: Long?,
)

/** Why a file was not added: the words of the snackbar (docs/apps/notes/spec.md, "Adding a file" and "A write fails"). */
sealed interface AddProblem {
    /** "A note holds at most 20 files. 3 files were not added." */
    data class NoteFull(val notAdded: Int) : AddProblem

    /** "Notes keeps 1 GB of files. Remove some to add more." */
    data object AllFull : AddProblem

    /** "ticket.jpg is larger than 25 MB." */
    data class TooLarge(val name: String) : AddProblem

    /** "The note was deleted. The file was not added." */
    data object NoteDeleted : AddProblem

    /** "Could not add ticket.jpg. The phone may be full." */
    data class CouldNotAdd(val name: String) : AddProblem

    /** "Could not read ticket.jpg. Pick it again." */
    data class CouldNotRead(val name: String) : AddProblem

    /** "Notes cannot open its files now. Open Recovery key in Settings.": no new file key can be sealed now. */
    data object KeysNotUsable : AddProblem
}

/**
 * The adds of files, one at a time in all of Notes, in the order the
 * files were picked, also across notes (docs/apps/notes/spec.md, "Adding
 * a file"). A note's screen hands its picked files here and they wait,
 * in memory only, until they start: a file starts only while [canStart]
 * says that Notes is on the screen and the gate of the app lock is open,
 * because no new file key is made otherwise. An add that has started
 * goes on when its note closes, when Notes locks and when the screen
 * turns off: its key is made before the copy starts.
 *
 * Each add checks the counts when it starts, so two adds never pass a
 * count together. It reserves the file's `id`, makes and wraps a new file
 * key, encrypts the picked bytes into `<id>.part`, counting them, renames
 * the part and writes the record with its note in one transaction. An add
 * holds [fileKeys] from the key to the record, so the move of the file
 * keys never finishes while a key is wrapped before its record exists.
 * [tell] gets the words of each problem.
 */
class FileAdds(
    private val repository: NotesRepository,
    private val files: FileCrypto,
    private val canStart: Flow<Boolean>,
    private val fileKeys: Mutex,
    private val tell: (AddProblem) -> Unit,
    scope: CoroutineScope,
    private val work: CoroutineContext,
) {
    private class Waiting(val key: Long, val batch: Long, val noteId: String, val picked: PickedFile)

    private val lock = Any()
    private val queue = ArrayDeque<Waiting>()
    private var nextKey = 1L
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private val rows = MutableStateFlow<List<AddingFile>>(emptyList())

    /** The files that wait or are being added, in their order. The first one may be running. */
    val adding: StateFlow<List<AddingFile>> = rows.asStateFlow()

    init {
        scope.launch(work) { runAdds() }
    }

    /** Adds [picked] to the note [noteId], after every file picked before. A new note is made with its first file. */
    fun add(noteId: String, picked: List<PickedFile>) {
        if (picked.isEmpty()) return
        synchronized(lock) {
            val batch = nextKey
            picked.forEach { file ->
                val key = nextKey++
                queue.addLast(Waiting(key, batch, noteId, file))
                rows.value += AddingFile(key, noteId, name = null, done = 0, total = null)
            }
        }
        wake.trySend(Unit)
    }

    /** True while a file waits to be added to the note [noteId], or is being added to it. */
    fun isAddingTo(noteId: String): Boolean = synchronized(lock) { queue.any { it.noteId == noteId } }

    private suspend fun runAdds() {
        while (true) {
            val next = synchronized(lock) { queue.firstOrNull() }
            if (next == null) {
                wake.receive()
                continue
            }
            canStart.first { it }
            try {
                addOne(next)
            } finally {
                done(next)
            }
        }
    }

    /** Takes [waiting] off the queue and its row away. */
    private fun done(waiting: Waiting) = synchronized(lock) {
        queue.remove(waiting)
        rows.value = rows.value.filter { it.key != waiting.key }
    }

    /** Takes the other files of [waiting]'s batch off the queue, and returns how many files of the batch are not added, [waiting] too. */
    private fun dropBatch(waiting: Waiting): Int = synchronized(lock) {
        val rest = queue.filter { it !== waiting && it.batch == waiting.batch }
        queue.removeAll(rest.toSet())
        val keys = rest.map { it.key }.toSet()
        rows.value = rows.value.filter { it.key !in keys }
        rest.size + 1
    }

    private fun show(waiting: Waiting, change: (AddingFile) -> AddingFile) = synchronized(lock) {
        rows.value = rows.value.map { if (it.key == waiting.key) change(it) else it }
    }

    private suspend fun addOne(waiting: Waiting) {
        val noteId = waiting.noteId
        try {
            if (repository.findNote(noteId) == null && !repository.isNewNote(noteId)) {
                dropBatch(waiting)
                tell(AddProblem.NoteDeleted)
                return
            }
            if (repository.shownFileCount(noteId) >= NoteLimits.MOST_FILES_PER_NOTE) {
                tell(AddProblem.NoteFull(dropBatch(waiting)))
                return
            }
            val startBytes = repository.shownBytes()
            if (startBytes >= NoteLimits.MOST_ALL_FILE_BYTES) {
                dropBatch(waiting)
                tell(AddProblem.AllFull)
                return
            }
            val name = FileText.name(readOrNull { waiting.picked.name() })
            val type = FileText.type(readOrNull { waiting.picked.type() })
            val total = readOrNull { waiting.picked.reportedSize() }
            show(waiting) { it.copy(name = name, total = total) }
            fileKeys.withLock { copyAndWrite(waiting, name, type, startBytes) }?.let(tell)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // A database that refuses, a full disk while the first file key is stored, or anything else: the file is
            // not added, its part and stream are gone, and the files after it still wait their turn.
            tell(AddProblem.CouldNotAdd(FileText.name(readOrNull { waiting.picked.name() })))
        }
    }

    /** The copy and the record, holding [fileKeys]. Returns the problem, or null when the file was added. */
    private suspend fun copyAndWrite(waiting: Waiting, name: String, type: String, startBytes: Long): AddProblem? {
        val fileId = repository.reserveFileId()
        try {
            val key = files.newFileKey()
            val wrapped = try {
                files.wrap(fileId, key)
            } catch (_: BlobException) {
                return AddProblem.KeysNotUsable
            } catch (_: IOException) {
                // The first file key of an app with no recovery key is stored here: the phone may be full.
                return AddProblem.CouldNotAdd(name)
            }
            val input = try {
                waiting.picked.open()
            } catch (_: IOException) {
                return AddProblem.CouldNotRead(name)
            } catch (_: SecurityException) {
                return AddProblem.CouldNotRead(name)
            }
            val copied = input.use { source -> encrypt(waiting, source, fileId, key, name, startBytes) }
            if (copied is Copied.Stopped) return copied.problem
            val size = (copied as Copied.Whole).size
            val added = try {
                repository.addFile(waiting.noteId, fileId, name, type, size, wrapped)
            } catch (failed: Exception) {
                repository.store.remove(fileId)
                throw failed
            }
            if (added == FileAdded.NOTE_DELETED) {
                repository.store.remove(fileId)
                return AddProblem.NoteDeleted
            }
            return null
        } finally {
            repository.releaseFileId(fileId)
        }
    }

    /** How a copy into the part ended. */
    private sealed interface Copied {
        /** The stream is whole and renamed to `<id>`: the file had [size] bytes. */
        class Whole(val size: Long) : Copied

        /** The copy stopped for [problem], and the part is deleted. */
        class Stopped(val problem: AddProblem) : Copied
    }

    /**
     * Encrypts [source] into `<id>.part`, counting the bytes, then flushes
     * it and renames it to `<id>`. Stops at 25,000,001 bytes, or when the
     * count takes all files past 1 GB. On a problem the part is deleted.
     */
    private fun encrypt(waiting: Waiting, source: InputStream, fileId: String, key: FileKey, name: String, startBytes: Long): Copied {
        val part = try {
            repository.store.startPart(fileId)
        } catch (_: IOException) {
            return Copied.Stopped(AddProblem.CouldNotAdd(name))
        }
        val problem = try {
            copyInto(waiting, source, key.encryptingStream(fileId, part.output), name, startBytes)
        } catch (_: IOException) {
            CopyEnd(0, AddProblem.CouldNotAdd(name))
        }
        if (problem.stop == null) {
            try {
                part.finish()
                return Copied.Whole(problem.count)
            } catch (_: IOException) {
                part.abandon()
                repository.store.remove(fileId)
                return Copied.Stopped(AddProblem.CouldNotAdd(name))
            }
        }
        part.abandon()
        return Copied.Stopped(problem.stop)
    }

    /** How the copy loop ended: the bytes read, and the problem that stopped it, or null. */
    private class CopyEnd(val count: Long, val stop: AddProblem?)

    /** Copies [source] into [encrypting] and closes it, counting the bytes. A write that fails throws [IOException]. */
    private fun copyInto(waiting: Waiting, source: InputStream, encrypting: OutputStream, name: String, startBytes: Long): CopyEnd {
        var count = 0L
        val buffer = ByteArray(BUFFER)
        while (true) {
            val read = try {
                source.read(buffer)
            } catch (_: IOException) {
                return CopyEnd(count, AddProblem.CouldNotRead(name))
            }
            if (read < 0) break
            count += read
            if (count > NoteLimits.MOST_FILE_BYTES) return CopyEnd(count, AddProblem.TooLarge(name))
            if (startBytes + count > NoteLimits.MOST_ALL_FILE_BYTES) return CopyEnd(count, AddProblem.AllFull)
            encrypting.write(buffer, 0, read)
            val done = count
            show(waiting) { it.copy(done = done) }
        }
        encrypting.close()
        return CopyEnd(count, null)
    }

    /** [read], or null if the picker's provider fails: the name is then "File" and the type `application/octet-stream`. */
    private inline fun <T> readOrNull(read: () -> T?): T? = try {
        read()
    } catch (_: RuntimeException) {
        null
    }

    private companion object {
        const val BUFFER = 64 * 1024
    }
}
