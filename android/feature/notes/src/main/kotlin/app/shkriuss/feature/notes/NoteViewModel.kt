package app.shkriuss.feature.notes

import android.database.SQLException
import android.os.SystemClock
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** One file row of a note: the file, and its state once it is known (docs/apps/notes/spec.md, "A note", point 4). */
data class FileRowState(val file: NoteFile, val state: FileState?)

/** Why a change to a field was refused: the words under it until the next change. */
enum class FieldProblem {
    /** "A title has at most 200 characters." */
    TITLE_TOO_LONG,

    /** "A note has at most 100,000 characters." */
    TEXT_TOO_LONG,
}

/** What an open note shows (docs/apps/notes/spec.md, "A note"). */
data class NoteState(
    /** True until the note is read. */
    val loading: Boolean = true,
    /** True if the database cannot be read: `ShkErrorState`, "Could not open your notes." */
    val failed: Boolean = false,
    /** The title as typed. Spaces at both ends go when it is saved. */
    val title: String = "",
    /** The text and its selection. */
    val body: TextEdit = TextEdit("", 0),
    /** The words under the field whose change was refused, until the next change. */
    val problem: FieldProblem? = null,
    /** True for the line above the title: "Could not save the note. Notes tries again." */
    val saveFailed: Boolean = false,
    /** True if the note is pinned: the menu offers **Unpin**. */
    val pinned: Boolean = false,
    /** The shown files, oldest first. */
    val files: List<FileRowState> = emptyList(),
    /** The files that wait to be added to this note or are being added. */
    val adding: List<AddingFile> = emptyList(),
    /** True while **Save a copy** writes: the dialog "Saving a copy". The fraction, or null before it starts. */
    val copying: Float? = null,
    /** True for the question "This note is not saved", with **Try again** and **Discard changes**. */
    val askUnsaved: Boolean = false,
    /** True once the note closed: the screen goes back to the list. */
    val closed: Boolean = false,
)

/**
 * One open note: its title and text, saved by themselves, its formatting,
 * its files, **Pin**, **Delete note** and closing (docs/apps/notes/spec.md,
 * "A note", "Saving", "Formatting" and "Files"). [noteId] is a stored note,
 * or the reserved `id` of a new one (`NotesRepository.reserveNoteId`).
 *
 * Notes saves one second after the last change, at least every 10 seconds
 * while changes go on without a pause, and when the note closes or Notes
 * leaves the screen or locks ([saveNow]). [wait] and [elapsed] are the
 * pause and the clock of those times, which tests control. [work] runs
 * the reads and writes.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NoteViewModel(
    private val repository: NotesRepository,
    private val adds: FileAdds,
    private val reader: FileReader,
    private val snackbars: NotesSnackbars,
    /** The note that is open. */
    val noteId: String,
    private val work: CoroutineContext = Dispatchers.IO,
    private val wait: suspend (Long) -> Unit = { delay(it) },
    private val elapsed: () -> Long = SystemClock::elapsedRealtime,
) : ViewModel() {
    private val shown = MutableStateFlow(NoteState())

    /** What the note shows now. */
    val state: StateFlow<NoteState> = shown.asStateFlow()

    /** One save at a time. A close waits for the save that runs. */
    private val saving = Mutex()
    private var saveTimer: Job? = null

    /** When the first change since the last save was made, by [elapsed], or null when everything is saved. */
    @Volatile
    private var firstUnsaved: Long? = null

    /** Counts the changes, so that a save knows whether one came while it wrote. Changes come on the main thread. */
    @Volatile
    private var changes = 0L

    /** The count of [changes] that the last save, or **Discard changes**, took in. */
    @Volatile
    private var savedThrough = 0L

    /** Asks for the states of the files again, as after a screen of `core/security`. */
    private val checkAgain = MutableStateFlow(0)

    /** True once the note was stored: a later read that finds it deleted closes it. */
    @Volatile
    private var wasStored = false

    @Volatile
    private var closing = false

    init {
        viewModelScope.launch(work) { read() }
        viewModelScope.launch(work) { watchFiles() }
        viewModelScope.launch(work) {
            adds.adding.collect { all -> shown.update { it.copy(adding = all.filter { file -> file.noteId == noteId }) } }
        }
    }

    private suspend fun read() {
        val stored = try {
            repository.findNote(noteId)
        } catch (_: SQLException) {
            shown.update { it.copy(loading = false, failed = true) }
            return
        }
        if (stored == null && !repository.isNewNote(noteId)) {
            shown.update { it.copy(loading = false, closed = true) }
            return
        }
        wasStored = stored != null
        shown.update {
            it.copy(loading = false, title = stored?.title.orEmpty(), body = TextEdit(stored?.body.orEmpty(), 0), pinned = stored?.pinned == true)
        }
        // A restore, or later sync, can delete the note while it is open: it closes. Pin follows the stored note.
        repository.note(noteId).catch { error -> if (error !is SQLException) throw error }.collect { note ->
            if (note != null) {
                wasStored = true
                shown.update { it.copy(pinned = note.pinned) }
            } else if (wasStored && !closing) {
                cancelTimer()
                shown.update { it.copy(closed = true) }
            }
        }
    }

    private suspend fun watchFiles() {
        combine(repository.filesOf(noteId), checkAgain) { files, _ -> files }
            .mapLatest { files -> files.map { FileRowState(it, reader.stateOf(it)) } }
            .catch { error -> if (error !is SQLException) throw error }
            .collect { rows -> shown.update { it.copy(files = rows) } }
    }

    /** Reads the state of each file again, as when Notes comes back from a screen of `core/security`. */
    fun checkFilesAgain() {
        checkAgain.update { it + 1 }
    }

    /** The title field changed to [typed]. A change past 200 characters is refused, and the field keeps what it had. */
    fun onTitleChange(typed: String) {
        val kept = NoteText.title(typed)
        if (NoteText.length(kept) > NoteLimits.MOST_TITLE) {
            shown.update { it.copy(problem = FieldProblem.TITLE_TOO_LONG) }
            return
        }
        if (kept == shown.value.title) return
        shown.update { it.copy(title = kept, problem = null) }
        changed()
    }

    /**
     * The text field changed to [edit]. Line breaks are kept as `\n` and
     * control characters other than tab go. Enter at the end of an item
     * starts the next one. A change past 100,000 characters is refused.
     */
    fun onBodyChange(edit: TextEdit) {
        val cleaned = TextEdit(
            NoteText.body(edit.text),
            NoteText.body(edit.text.substring(0, edit.start.coerceIn(0, edit.text.length))).length,
            NoteText.body(edit.text.substring(0, edit.end.coerceIn(0, edit.text.length))).length,
        )
        val before = shown.value.body
        apply(NoteFormatting.afterEnter(before, cleaned) ?: cleaned)
    }

    /** **Heading** on the bar. */
    fun heading() = apply(NoteFormatting.toggleLineMark(shown.value.body, LineKind.HEADING))

    /** **Bulleted list** on the bar. */
    fun bullets() = apply(NoteFormatting.toggleLineMark(shown.value.body, LineKind.BULLET))

    /** **Numbered list** on the bar. */
    fun numbers() = apply(NoteFormatting.toggleNumbers(shown.value.body))

    /** **Checklist** on the bar. */
    fun checklist() = apply(NoteFormatting.toggleChecklist(shown.value.body))

    /** **Bold** on the bar. */
    fun bold() = apply(NoteFormatting.toggleInline(shown.value.body, "**"))

    /** **Italic** on the bar. */
    fun italic() = apply(NoteFormatting.toggleInline(shown.value.body, "*"))

    /** A tap on the box of a checklist item that starts at [boxStart]: it is ticked or opened again. The cursor does not move. */
    fun toggleBox(boxStart: Int) {
        val body = shown.value.body
        apply(body.copy(text = NoteFormatting.toggleBox(body.text, boxStart)))
    }

    private fun apply(edit: TextEdit) {
        if (NoteText.length(edit.text) > NoteLimits.MOST_BODY) {
            shown.update { it.copy(problem = FieldProblem.TEXT_TOO_LONG) }
            return
        }
        val textChanged = edit.text != shown.value.body.text
        shown.update { it.copy(body = edit, problem = if (textChanged) null else it.problem) }
        if (textChanged) changed()
    }

    /** A change to save: one second after the last change, and at least 10 seconds after the first one since the last save. */
    private fun changed() {
        changes++
        val now = elapsed()
        val first = firstUnsaved ?: now.also { firstUnsaved = it }
        val pause = minOf(PAUSE_MILLIS, MOST_UNSAVED_MILLIS - (now - first)).coerceAtLeast(0)
        saveTimer?.cancel()
        saveTimer = viewModelScope.launch(work) {
            wait(pause)
            saveNow()
        }
    }

    private fun cancelTimer() {
        saveTimer?.cancel()
        saveTimer = null
    }

    /**
     * Saves what is typed now, in one transaction, if anything changed
     * since the last save. A save that the database refuses changes
     * nothing: the line "Could not save the note" shows, and Notes tries
     * again at the next change. True if everything is saved. Notes calls
     * it when the note closes, another note opens, or Notes leaves the
     * screen or locks.
     */
    suspend fun saveNow(): Boolean = saving.withLock {
        val counted = changes
        if (counted == savedThrough) return@withLock true
        val now = shown.value
        val saved = try {
            repository.save(noteId, NoteText.savedTitle(now.title), now.body.text)
        } catch (_: SQLException) {
            shown.update { it.copy(saveFailed = true) }
            return@withLock false
        }
        if (saved == Saved.WRITTEN) wasStored = true
        savedThrough = counted
        if (changes == counted) firstUnsaved = null
        shown.update { it.copy(saveFailed = false) }
        if (saved == Saved.GONE && !closing) shown.update { it.copy(closed = true) }
        true
    }

    /** Notes leaves the screen or locks: what is typed is saved. */
    fun leftScreen() {
        cancelTimer()
        viewModelScope.launch(work) { saveNow() }
    }

    /**
     * Back, another note, or the destination changes: the note closes
     * after its save. If the save fails, the question "This note is not
     * saved" asks first. A note that is empty then, with no file and no
     * file being added to it, is deleted and wiped, with no snackbar.
     */
    fun close() {
        if (closing || shown.value.closed) return
        cancelTimer()
        viewModelScope.launch(work) {
            if (saveNow()) finishClosing() else shown.update { it.copy(askUnsaved = true) }
        }
    }

    /** **Try again** in "This note is not saved". */
    fun tryAgain() {
        shown.update { it.copy(askUnsaved = false) }
        close()
    }

    /** **Discard changes** in "This note is not saved": the note closes with what was saved last. */
    fun discard() {
        shown.update { it.copy(askUnsaved = false) }
        savedThrough = changes
        firstUnsaved = null
        viewModelScope.launch(work) { finishClosing() }
    }

    private suspend fun finishClosing() {
        closing = true
        val stillAdding = adds.isAddingTo(noteId)
        try {
            if (!stillAdding) {
                if (repository.findNote(noteId) == null) repository.giveUpNewNote(noteId) else repository.deleteIfEmpty(noteId)
            }
        } catch (_: SQLException) {
            // The empty note stays. It shows as "Empty note" in the list.
        }
        shown.update { it.copy(closed = true) }
    }

    /** **Pin** or **Unpin**: the press carries the state it showed. What is typed is saved first, so a new note is made. */
    fun setPinned(shownPinned: Boolean) {
        viewModelScope.launch(work) {
            if (!saveNow()) return@launch
            try {
                repository.setPinned(noteId, shownPinned)
            } catch (_: SQLException) {
                snackbars.show(NotesMessage.CouldNotChange)
            }
        }
    }

    /**
     * **Delete note**: what is typed is saved first, so that **Undo**
     * brings it back. The note closes, with "Note deleted" and **Undo**. A
     * new note that is not made yet is given up. Pressed twice, it deletes
     * once.
     */
    fun delete() {
        if (closing || shown.value.closed) return
        closing = true
        cancelTimer()
        viewModelScope.launch(work) {
            saveNow()
            try {
                val undo = repository.deleteNote(noteId)
                if (undo == null) repository.giveUpNewNote(noteId) else snackbars.show(NotesMessage.NoteDeleted(undo))
                shown.update { it.copy(closed = true) }
            } catch (_: SQLException) {
                closing = false
                snackbars.show(NotesMessage.CouldNotChange)
            }
        }
    }

    /** The picker gave [picked] for **Add a file**. They are added after every file picked before, when Notes may make their keys. */
    fun addFiles(picked: List<PickedFile>) {
        adds.add(noteId, picked)
    }

    /** **Remove** on [file]: "File removed", with **Undo**. Pressed twice, it removes once. */
    fun removeFile(file: NoteFile) {
        viewModelScope.launch(work) {
            try {
                repository.removeFile(file.id)?.let { snackbars.show(NotesMessage.FileRemoved(it)) }
            } catch (_: SQLException) {
                snackbars.show(NotesMessage.CouldNotChange)
            }
        }
    }

    /** **Save a copy** of [file] into [target], under the dialog "Saving a copy". One copy at a time. */
    fun saveCopy(file: NoteFile, target: CopyTarget) {
        if (shown.value.copying != null) return
        shown.update { it.copy(copying = 0f) }
        viewModelScope.launch(work) {
            val result = reader.saveCopy(file, target) { written ->
                val fraction = if (file.size == 0L) 1f else written.toFloat() / file.size
                shown.update { it.copy(copying = fraction.coerceIn(0f, 1f)) }
            }
            shown.update { it.copy(copying = null) }
            if (result != CopyResult.BUSY) snackbars.show(NotesMessage.Copy(result))
        }
    }

    private companion object {
        /** A save comes this long after the last change. */
        const val PAUSE_MILLIS = 1_000L

        /** And at the latest this long after the first change since the last save. */
        const val MOST_UNSAVED_MILLIS = 10_000L
    }
}
