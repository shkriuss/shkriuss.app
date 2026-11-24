package app.shkriuss.feature.notes

import android.database.SQLException
import androidx.room3.withWriteTransaction
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.core.data.isDeleted
import app.shkriuss.feature.notes.data.AttachmentEntity
import app.shkriuss.feature.notes.data.FileTotals
import app.shkriuss.feature.notes.data.NoteEntity
import app.shkriuss.feature.notes.data.NotesDatabase
import app.shkriuss.feature.notes.data.checkpoint
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * What **Undo** acts on: the records of one snackbar, each with the change
 * number that the action's write gave it (docs/apps/notes/spec.md, "A
 * press twice or late", Undo). A record changed since then has another
 * change number and stays as it is. When the Undo ends, pressed or not,
 * the records of the action that are still deleted are wiped
 * ([NotesRepository.wipe]).
 */
class Undo internal constructor(
    /** What the action did. */
    internal val action: Action,
    /** The note it deleted, or the note of the file it removed. */
    internal val note: UndoStep,
    /** The files it deleted or removed. */
    internal val files: List<UndoStep>,
) {
    /** The two actions with **Undo**. */
    enum class Action {
        /** **Delete note**: the note and its shown files. */
        NOTE_DELETED,

        /** **Remove**: one file. */
        FILE_REMOVED,
    }

    /** The `id` of every record of the action. The move of the file keys leaves them alone while the Undo is open. */
    val ids: Set<String>
        get() = buildSet {
            if (action == Action.NOTE_DELETED) add(note.id)
            files.forEach { add(it.id) }
        }
}

/** One record that [Undo] acts on, with the change number the action's write gave it. */
internal data class UndoStep(val id: String, val changeNumber: Long)

/** What a save of a note did. */
enum class Saved {
    /** It wrote the change, or made the note. */
    WRITTEN,

    /** Nothing changed, or a new note has nothing in it yet: nothing was written. */
    NOTHING,

    /** The note is deleted, or a new note was given up: nothing was written. */
    GONE,
}

/** What happened to the record of an added file ([NotesRepository.addFile]). */
enum class FileAdded {
    /** The record is written, and the note with it. */
    ADDED,

    /** The note was deleted while the file was copied: nothing was written. */
    NOTE_DELETED,
}

/**
 * The notes and the records of their files. Every write goes through a
 * `RecordWriter`, so it is stamped, gets a change number and never removes
 * a row (docs/architecture/data.md). Every read that shows records leaves
 * deleted ones out. Each action is one transaction.
 *
 * Notes writes to the database and to the folder of streams ([store]).
 * The database is the truth: a stream is written before its record and
 * removed after its record is wiped (docs/apps/notes/spec.md, "Stopped
 * between two writes").
 *
 * Once a write has begun, it runs to its end, also when its caller is
 * cancelled. A write the database refuses throws its
 * `android.database.SQLException`, and nothing of the action is written
 * (spec, "A write fails").
 */
class NotesRepository(
    private val database: NotesDatabase,
    clock: Clock,
    ids: IdSource,
    /** The streams of the files. */
    val store: NoteFileStore,
) {
    private val notes = database.notes()
    private val attachments = database.attachments()
    private val noteWriter = RecordWriter(database, notes, clock, ids)
    private val fileWriter = RecordWriter(database, attachments, clock, ids)

    /**
     * Held while streams are removed, and by a backup while it writes, so
     * that no stream is removed while a backup is written
     * (spec, "Removing a file, and the wipe", point 3).
     */
    val streams: Mutex = Mutex()

    /** The notes that are not deleted, in no order. */
    fun notes(): Flow<List<Note>> = notes.observeShown().map { rows -> rows.map(::noteOf) }

    /** The files that are not deleted, of every note, in no order. */
    fun shownFiles(): Flow<List<NoteFile>> = attachments.observeShown().map { rows -> rows.map(::fileOf) }

    /** The note [id], and again after each change of it. Null while it is not stored or is deleted. */
    fun note(id: String): Flow<Note?> = notes.observe(id).map { row -> row?.takeUnless { it.record.isDeleted }?.let(::noteOf) }

    /** The files of the note [id] that are not deleted, oldest first. */
    fun filesOf(id: String): Flow<List<NoteFile>> =
        attachments.observeShownOf(id).map { rows -> rows.map(::fileOf).sortedWith(NoteOrder.FILES) }

    /** How many files are not deleted, and their bytes: "12 files, 120 MB of 1 GB". */
    fun totals(): Flow<FileTotals> = attachments.observeTotals()

    /** The note [id], or null if it is not stored or is deleted. */
    suspend fun findNote(id: String): Note? = notes.find(id)?.takeUnless { it.record.isDeleted }?.let(::noteOf)

    /** How many notes are not deleted: **New note** adds none at [NoteLimits.MOST_NOTES]. */
    suspend fun shownCount(): Int = notes.shownCount()

    /** How many files of the note [id] are not deleted: **Add a file** adds none at [NoteLimits.MOST_FILES_PER_NOTE]. */
    suspend fun shownFileCount(id: String): Int = attachments.shownCountOf(id)

    /** The bytes of all files that are not deleted: **Add a file** adds none past [NoteLimits.MOST_ALL_FILE_BYTES]. */
    suspend fun shownBytes(): Long = attachments.shownBytes()

    /** The wrapped key of the shown file [id], or null if it is deleted or not stored. Only `core/crypto` opens it. */
    internal suspend fun wrappedKeyOf(id: String): ByteArray? = attachments.find(id)?.takeUnless { it.record.isDeleted }?.wrappedKey

    /**
     * The `id` of a new note, reserved until the note is made: by its first
     * save with a title or a text ([save]), or by its first file
     * ([addFile]). Nothing is written now: a new note writes nothing until
     * it has a title, a text or a file (spec, "Saving", point 2).
     */
    fun reserveNoteId(): String = noteWriter.reserveId()

    /** Gives up the new note [id] that is not made: an add that ends later does not make it. Nothing happens to a note that is made. */
    fun giveUpNewNote(id: String) = noteWriter.release(id)

    /** True while [id] is the reserved `id` of a new note that is not made yet. */
    fun isNewNote(id: String): Boolean = id in noteWriter.reservedIds()

    /**
     * Saves the note [id] with [title], as stored, and [body], in one
     * transaction. A save with no change writes nothing. A new note,
     * reserved with [reserveNoteId], is made at its first save with a
     * title or a text.
     */
    suspend fun save(id: String, title: String, body: String): Saved = withContext(NonCancellable) {
        val saved = database.withWriteTransaction<Saved> {
            val stored = notes.find(id)
            when {
                stored == null && !isNewNote(id) -> Saved.GONE
                stored == null && title.isEmpty() && body.isEmpty() -> Saved.NOTHING
                stored == null -> {
                    noteWriter.create(id) { fields, number -> stored(NoteEntity(fields, number, title, body, pinned = false, fileChanges = 0)) }
                    Saved.WRITTEN
                }
                stored.record.isDeleted -> Saved.GONE
                stored.title == title && stored.body == body -> Saved.NOTHING
                else -> {
                    noteWriter.update(id) { stored(it.copy(title = title, body = body)) }
                    Saved.WRITTEN
                }
            }
        }
        if (saved == Saved.WRITTEN) noteWriter.release(id)
        saved
    }

    /**
     * **Pin** or **Unpin** on the note [id]: a press carries the state it
     * showed, [shownPinned], so **Pin** on a pinned note does nothing.
     * True if it wrote the change.
     */
    suspend fun setPinned(id: String, shownPinned: Boolean): Boolean = withContext(NonCancellable) {
        database.withWriteTransaction<Boolean> {
            val stored = notes.find(id)
            if (stored == null || stored.record.isDeleted || stored.pinned != shownPinned) {
                false
            } else {
                noteWriter.update(id) { it.copy(pinned = !shownPinned) } != null
            }
        }
    }

    /**
     * **Delete note**: marks the note [id] and its shown files deleted, in
     * one transaction. Their content stays until the Undo ends. Null if it
     * was deleted or not stored.
     */
    suspend fun deleteNote(id: String): Undo? = withContext(NonCancellable) {
        database.withWriteTransaction<Undo?> {
            val note = noteWriter.markDeleted(id) ?: return@withWriteTransaction null
            val files = attachments.shownOf(id).mapNotNull { fileWriter.markDeleted(it.record.id) }
            Undo(Undo.Action.NOTE_DELETED, UndoStep(id, note.changeNumber), files.map { UndoStep(it.record.id, it.changeNumber) })
        }
    }

    /**
     * **Remove**: marks the file [id] deleted and raises its note's
     * `fileChanges`, in one transaction. Its stream stays until the Undo
     * ends. Null if it was deleted or not stored.
     */
    suspend fun removeFile(id: String): Undo? = withContext(NonCancellable) {
        database.withWriteTransaction<Undo?> {
            val file = fileWriter.markDeleted(id) ?: return@withWriteTransaction null
            val note = raiseFileChanges(file.noteId)
            Undo(Undo.Action.FILE_REMOVED, UndoStep(file.noteId, note?.changeNumber ?: 0L), listOf(UndoStep(id, file.changeNumber)))
        }
    }

    /**
     * **Undo**. It acts only on the records of [undo] whose change number
     * is still the one the action gave them, in one transaction. A file
     * comes back only while its note is shown. Bringing back a removed file
     * always raises its note's `fileChanges`. Undo may bring a count past
     * its limit. True if it brought anything back.
     */
    suspend fun undo(undo: Undo): Boolean = withContext(NonCancellable) {
        database.withWriteTransaction<Boolean> {
            var brought = false
            if (undo.action == Undo.Action.NOTE_DELETED && notes.find(undo.note.id)?.changeNumber == undo.note.changeNumber) {
                brought = noteWriter.restore(undo.note.id) != null
            }
            val noteShown = notes.find(undo.note.id)?.record?.isDeleted == false
            undo.files.forEach { step ->
                if (noteShown && attachments.find(step.id)?.changeNumber == step.changeNumber && fileWriter.restore(step.id) != null) {
                    brought = true
                    if (undo.action == Undo.Action.FILE_REMOVED) raiseFileChanges(undo.note.id)
                }
            }
            brought
        }
    }

    /**
     * Wipes the records of [undo] that are still deleted, in one
     * transaction, once its Undo has ended (spec, "Removing a file, and
     * the wipe", point 2). Then it removes their streams and checkpoints
     * the write-ahead file. A wipe, a stream or a checkpoint that fails is
     * tried again at the next start.
     */
    suspend fun wipe(undo: Undo) = withContext(NonCancellable) {
        val wiped = database.withWriteTransaction<List<String>> {
            if (undo.action == Undo.Action.NOTE_DELETED) noteWriter.wipe(undo.note.id, NoteRules::wiped)
            undo.files.mapNotNull { step -> fileWriter.wipe(step.id, NoteRules::wiped)?.record?.id }
        }
        streams.withLock { wiped.forEach(store::remove) }
        tryCheckpoint()
    }

    /**
     * Deletes and wipes the note [id] when it is empty as it closes: no
     * title, no text, no shown file (spec, "Saving", point 3). The caller
     * knows that no file is being added to it. True if it was.
     */
    suspend fun deleteIfEmpty(id: String): Boolean = withContext(NonCancellable) {
        val deleted = database.withWriteTransaction<Boolean> {
            val stored = notes.find(id)
            if (stored == null || stored.record.isDeleted || stored.title.isNotEmpty() || stored.body.isNotEmpty() ||
                attachments.shownCountOf(id) > 0
            ) {
                false
            } else {
                noteWriter.markDeleted(id)
                noteWriter.wipe(id, NoteRules::wiped)
                true
            }
        }
        if (deleted) tryCheckpoint()
        deleted
    }

    /** The `id` of a new file, reserved until its add ends: its stream is written under it before its record. */
    fun reserveFileId(): String = fileWriter.reserveId()

    /** Ends the reservation of the file [id] once its add ended, its record written or not. */
    fun releaseFileId(id: String) = fileWriter.release(id)

    /**
     * Writes the record of an added file, whose stream is written already,
     * and raises its note's `fileChanges`, in one transaction. A new note
     * that is reserved and not made yet is made with it. It first checks
     * that the note is still shown: if it was deleted, or a new note was
     * given up, while the file was copied, nothing is written
     * (spec, "Adding a file", point 5).
     */
    suspend fun addFile(
        noteId: String,
        fileId: String,
        name: String,
        mimeType: String,
        size: Long,
        wrappedKey: ByteArray,
    ): FileAdded = withContext(NonCancellable) {
        val added = database.withWriteTransaction<FileAdded> {
            val note = notes.find(noteId)
            when {
                note == null && !isNewNote(noteId) -> return@withWriteTransaction FileAdded.NOTE_DELETED
                note == null -> noteWriter.create(noteId) { fields, number ->
                    NoteEntity(fields, number, title = "", body = "", pinned = false, fileChanges = 1)
                }
                note.record.isDeleted -> return@withWriteTransaction FileAdded.NOTE_DELETED
                else -> raiseFileChanges(noteId)
            }
            fileWriter.create(fileId) { fields, number ->
                stored(AttachmentEntity(fields, number, noteId, name, mimeType, size, wrappedKey))
            }
            FileAdded.ADDED
        }
        if (added == FileAdded.ADDED) noteWriter.release(noteId)
        added
    }

    /**
     * What Notes does at every start, before a backup lists its records,
     * and after a restore, in this order (spec, "Removing a file, and the
     * wipe", point 3): it marks deleted each file that is not deleted and
     * whose note is; wipes every deleted record that is not wiped yet;
     * removes every stream that no unwiped file names; and checkpoints the
     * write-ahead file. A stop between any two of these is mended at the
     * next start.
     *
     * The caller ends any open Undo first. The sweep leaves alone the part
     * and the stream of an add that is running: its `id` is reserved. At
     * start no add runs, so every `.part` file goes. Returns false if a
     * wipe or a stream could not be removed: the next start tries again.
     */
    suspend fun sweep(): Boolean = withContext(NonCancellable) {
        database.withWriteTransaction {
            attachments.shownOfDeletedNotes().forEach { fileWriter.markDeleted(it.record.id) }
        }
        database.withWriteTransaction {
            notes.deletedNotWiped().forEach { noteWriter.wipe(it.record.id, NoteRules::wiped) }
            attachments.deletedNotWiped().forEach { fileWriter.wipe(it.record.id, NoteRules::wiped) }
        }
        val removed = removeUnneededStreams()
        tryCheckpoint() && removed
    }

    /** Checkpoints the write-ahead file ([checkpoint]). False if it could not finish or failed: the next wipe or start tries again. */
    private suspend fun tryCheckpoint(): Boolean = try {
        database.checkpoint()
    } catch (_: SQLException) {
        false
    }

    /**
     * Removes every stream that no unwiped file names, and every part of
     * an add that is not running. The folder is listed first, then the
     * reserved `id`s are read, then the records: a stream that appears
     * after the list is not touched, and an add that ends between the two
     * reads has its record by the second.
     */
    private suspend fun removeUnneededStreams(): Boolean = streams.withLock {
        val listed = store.list()
        val running = fileWriter.reservedIds()
        val keep = running + attachments.unwipedIds()
        store.removeAllBut(listed, keep)
    }

    /**
     * The files whose wrapped key [needsNewSeal] says must be sealed again,
     * deleted ones that are not wiped too, without those in [leaveAlone]:
     * the records of an Undo that is still open (spec, "Before the
     * recovery key: the file key move", point 3).
     */
    internal suspend fun filesToSealAgain(leaveAlone: Set<String>, needsNewSeal: (ByteArray) -> Boolean): List<String> =
        attachments.withKeys().filter { it.record.id !in leaveAlone && needsNewSeal(it.wrappedKey) }.map { it.record.id }

    /**
     * Writes the file [id] with its key sealed again by [sealAgain], in its
     * own transaction, with `updatedAt` as it was (`RecordWriter.sealFileKeyAgain`).
     * [needsNewSeal] is asked again inside the transaction, so a key that
     * changed meanwhile is left as it is.
     */
    internal suspend fun sealAgain(id: String, needsNewSeal: (ByteArray) -> Boolean, sealAgain: (String, ByteArray) -> ByteArray) =
        withContext(NonCancellable) {
            fileWriter.sealFileKeyAgain(id) { row ->
                if (row.wrappedKey.isEmpty() || !needsNewSeal(row.wrappedKey)) null else row.copy(wrappedKey = sealAgain(id, row.wrappedKey))
            }
        }

    /** Raises the `fileChanges` of the note [id], if it is shown. Inside the caller's transaction. */
    private suspend fun raiseFileChanges(id: String): NoteEntity? =
        noteWriter.update(id) { it.copy(fileChanges = NoteRules.nextFileChanges(it.fileChanges)) }

    /** [row], checked against the limits: the repository never writes a value outside them. */
    private fun stored(row: NoteEntity): NoteEntity = row.also { check(NoteRules.isStored(it)) { "A note outside its limits" } }

    /** [row], checked against the limits: the repository never writes a value outside them. */
    private fun stored(row: AttachmentEntity): AttachmentEntity = row.also { check(NoteRules.isStored(it)) { "A file outside its limits" } }
}
