package app.shkriuss.feature.notes

import android.database.SQLException
import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.ShkCrypto
import java.io.IOException
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** The snackbars of Notes (docs/apps/notes/spec.md, "Screens", "Files" and "A write fails"). */
sealed interface NotesMessage {
    /** "Note deleted", with **Undo**. */
    data class NoteDeleted(val undo: Undo) : NotesMessage

    /** "File removed", with **Undo**. */
    data class FileRemoved(val undo: Undo) : NotesMessage

    /** "Notes keeps 5,000 notes. Delete some to add more." */
    data object NotesFull : NotesMessage

    /** "Could not change your notes. Try again.": a delete, a remove, an Undo or a pin that the database refused. */
    data object CouldNotChange : NotesMessage

    /** Why a picked file was not added. */
    data class NotAdded(val problem: AddProblem) : NotesMessage

    /** What **Save a copy** did: "Copy saved", or why no copy, or only part of one, was saved. */
    data class Copy(val result: CopyResult) : NotesMessage
}

/** The [Undo] of a snackbar that offers it, or null. */
val NotesMessage.offeredUndo: Undo?
    get() = when (this) {
        is NotesMessage.NoteDeleted -> undo
        is NotesMessage.FileRemoved -> undo
        else -> null
    }

/**
 * The turns that the making and the press of an **Undo** take, so that a
 * write that gives a record a new change number, such as the move of the
 * file keys, never comes between them for a record of that Undo.
 */
interface UndoTurns {
    /**
     * Runs [action] in a turn of its own, with the `id`s of the records of
     * the Undo that is open now. No Undo is made or pressed while it runs.
     */
    suspend fun <T> inTurn(action: suspend (openUndo: Set<String>) -> T): T
}

/**
 * The one snackbar of Notes, which the list, an open note and the image
 * view share, and the end of its **Undo** (docs/apps/notes/spec.md,
 * "Removing a file, and the wipe", point 2). The Undo ends when its
 * snackbar goes: its time runs out ([gone]), another snackbar takes its
 * place ([show]), it is pressed ([undo]), or Notes leaves the screen or
 * the destination changes ([endUndo]). If Notes stops, the next start
 * wipes. Then Notes wipes the records of that action that are still
 * deleted, and goes on with the move of the file keys ([afterUndo]).
 *
 * The write that makes an Undo and its snackbar take one turn ([offer]),
 * and so does a press of Undo and its write. The move of the file keys
 * seals each record in a turn of its own and leaves alone the records of
 * the open Undo ([inTurn]), so it never gives such a record a
 * new change number, which would stop the Undo
 * (spec, "Before the recovery key: the file key move", point 3). An Undo
 * that ended counts as open until its wipe is done, because the wipe
 * leaves alone a record whose change number moved.
 */
class NotesSnackbars(
    private val repository: NotesRepository,
    private val afterUndo: suspend () -> Unit,
    private val scope: CoroutineScope,
    private val work: CoroutineContext,
) : UndoTurns {
    private val shown = MutableStateFlow<NotesMessage?>(null)
    private val turns = Mutex()

    /** The Undos that ended and whose wipe is not done yet. */
    private val ending = mutableListOf<Undo>()

    /** The snackbar that shows now, or null. */
    val current: StateFlow<NotesMessage?> = shown.asStateFlow()

    /** The records of the Undo that is open now, and of those that ended and whose wipe is not done yet. */
    val openUndoIds: Set<String>
        get() = shown.value?.offeredUndo?.ids.orEmpty() + synchronized(ending) { ending.flatMap { it.ids } }

    /**
     * Runs [write], an action with **Undo** such as **Delete note**, and
     * shows the snackbar it gives, in one turn. Null when it wrote
     * nothing. A refusal of the database goes to the caller.
     */
    suspend fun offer(write: suspend () -> NotesMessage?): NotesMessage? = turns.withLock {
        write()?.also(::show)
    }

    override suspend fun <T> inTurn(action: suspend (openUndo: Set<String>) -> T): T = turns.withLock {
        action(openUndoIds)
    }

    /** Shows [message] in place of the snackbar that shows now, whose Undo then ends. */
    fun show(message: NotesMessage) {
        do {
            val before = shown.value
        } while (!replace(before, message))
    }

    /** The snackbar [message] went by itself: its time ran out, or it was swiped away. Its Undo ends. */
    fun gone(message: NotesMessage) {
        replace(message, null)
    }

    /**
     * Shows [next] in place of [before], if [before] still shows, and ends
     * the Undo of [before]. Its records count as ending before they stop
     * counting as open, so the move never finds them as neither.
     */
    private fun replace(before: NotesMessage?, next: NotesMessage?): Boolean {
        val undo = before?.offeredUndo
        undo?.let(::startEnding)
        val replaced = shown.compareAndSet(before, next)
        if (undo != null) {
            if (replaced) ended(undo) else stopEnding(undo)
        }
        return replaced
    }

    /**
     * **Undo** in the snackbar that shows now. It counts once: a second
     * press finds no snackbar. The records come back, then those of the
     * action that changed meanwhile and are still deleted are wiped.
     */
    fun undo() {
        val message = shown.value ?: return
        val undo = message.offeredUndo ?: return
        scope.launch(work) {
            val pressed = turns.withLock {
                startEnding(undo)
                // Another snackbar may have taken its place meanwhile: then that ended the Undo, and the press counts for nothing.
                if (!shown.compareAndSet(message, null)) {
                    stopEnding(undo)
                    return@withLock false
                }
                try {
                    repository.undo(undo)
                } catch (_: SQLException) {
                    show(NotesMessage.CouldNotChange)
                }
                true
            }
            if (pressed) end(undo)
        }
    }

    /** Notes leaves the screen, or the destination changes: a snackbar with Undo goes, and its Undo ends. */
    fun endUndo() {
        val message = shown.value ?: return
        if (message.offeredUndo != null) replace(message, null)
    }

    private fun startEnding(undo: Undo) = synchronized(ending) { ending += undo }

    private fun stopEnding(undo: Undo) = synchronized(ending) { ending.remove(undo) }

    private fun ended(undo: Undo) {
        scope.launch(work) { end(undo) }
    }

    /**
     * Wipes what is still deleted of [undo]. A wipe that fails is tried
     * again at the next start, and nothing shows. Only then do its records
     * stop counting as open.
     */
    private suspend fun end(undo: Undo) {
        try {
            repository.wipe(undo)
        } catch (_: SQLException) {
            // The next start wipes it (spec, "A write fails").
        } finally {
            stopEnding(undo)
        }
        afterUndo()
    }
}

/**
 * The move of the file keys from the random `file-key` to the one from
 * the recovery key (docs/apps/notes/spec.md, "Before the recovery key: the
 * file key move"). Notes runs it at every start, when it comes back from
 * a screen of `core/security`, when an Undo ends, pressed or not, and
 * before it goes on after the first-need dialog.
 *
 * For each file whose wrapped key is not sealed by the current key,
 * deleted ones that are not wiped too, it seals the key again, one record
 * per transaction, with `updatedAt` as it was. It leaves alone the
 * records of the Undo that is still open, asked for each record in the
 * turn of the Undo ([undoTurns]). Only when every
 * such key is sealed again, holding [fileKeys] so that no add runs, does
 * it call `finishFileKeyMove()`. A key that cannot be sealed again keeps
 * the move pending: Notes never ends it by itself.
 */
class FileKeyMove(
    private val repository: NotesRepository,
    private val crypto: ShkCrypto,
    private val fileKeys: Mutex,
    private val undoTurns: UndoTurns,
    private val work: CoroutineContext,
) {
    private val moving = Mutex()

    /** Moves what it can. True if no move is pending after it. */
    suspend fun run(): Boolean = withContext(work) {
        moving.withLock {
            try {
                move()
            } catch (_: BlobException) {
                false
            } catch (_: SQLException) {
                false
            } catch (_: IllegalStateException) {
                // finishFileKeyMove() refuses an app that has no keys from a recovery key yet.
                false
            } catch (_: IOException) {
                // A keyset file that cannot be read or written now, such as on a full disk: the move stays pending.
                false
            }
        }
    }

    private suspend fun move(): Boolean {
        val setup = crypto.setup
        if (!setup.fileKeyMoveIsPending()) return true
        if (!crypto.status().hasDerivedKeys) return false
        val files = crypto.files
        val needsNewSeal = { wrapped: ByteArray -> !files.isSealedByCurrentKey(wrapped) }
        var allSealed = true
        repository.filesToSealAgain(emptySet(), needsNewSeal).forEach { id ->
            try {
                // Asked again for each record, in the turn of the Undo: an Undo made meanwhile keeps its change numbers.
                undoTurns.inTurn { openUndo -> if (id !in openUndo) repository.sealAgain(id, needsNewSeal, files::sealAgain) }
            } catch (_: BlobException) {
                // Damaged, or sealed by a key that is gone: the move stays pending (spec, point 5).
                allSealed = false
            }
        }
        if (!allSealed) return false
        return fileKeys.withLock {
            // No add runs now: each holds the lock from its key to its record. A key wrapped meanwhile is checked here.
            if (repository.filesToSealAgain(emptySet(), needsNewSeal).isNotEmpty()) {
                false
            } else {
                // Water finishes the move at once, because it stores no files. Notes finishes it only here, once no
                // record holds a key that the old keyset sealed: after this call such a key can never be opened again.
                setup.finishFileKeyMove()
                true
            }
        }
    }
}
