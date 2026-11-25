package app.shkriuss.feature.notes

import android.database.SQLException
import android.os.SystemClock
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
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
    /** True once the note is stored. A new note is not until it has a title, a text or a file: until then **Pin** is turned off. */
    val stored: Boolean = false,
    /** The shown files, oldest first. */
    val files: List<FileRowState> = emptyList(),
    /** True once the files were read: before, an image view that is not among [files] may only not be read yet. */
    val filesLoaded: Boolean = false,
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
 * the reads and writes. [lasting] is a scope that outlives the screen,
 * the one of `NotesServices`: the save when Notes leaves the screen, and
 * the one when the screen goes, run there, so that the end of this
 * ViewModel never cuts them off. [gateOpen] is true while the gate of the
 * app lock is open: the states of the files are read only then, and read
 * again each time it opens, because the file keys cannot be used while
 * Notes is locked.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NoteViewModel(
    private val repository: NotesRepository,
    private val adds: FileAdds,
    private val reader: FileReader,
    private val snackbars: NotesSnackbars,
    /** The note that is open. */
    val noteId: String,
    private val lasting: CoroutineScope,
    private val work: CoroutineContext = Dispatchers.IO,
    private val wait: suspend (Long) -> Unit = { delay(it) },
    private val gateOpen: Flow<Boolean> = flowOf(true),
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
            // Not while the note, closed, is looked at again for being empty, and no such look after.
            snackbars.opening(noteId) { repository.findNote(noteId) }
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
            it.copy(
                loading = false,
                title = stored?.title.orEmpty(),
                body = TextEdit(stored?.body.orEmpty(), 0),
                pinned = stored?.pinned == true,
                stored = stored != null,
            )
        }
        // A restore, or later sync, can delete the note while it is open: it closes. Pin follows the stored note.
        repository.note(noteId).catch { error ->
            // A read that fails once the note is open: the screen shows that it cannot open the notes, not an old state.
            if (error is SQLException) shown.update { it.copy(failed = true) } else throw error
        }.collect { note ->
            if (note != null) {
                wasStored = true
                shown.update { it.copy(pinned = note.pinned, stored = true) }
            } else if (wasStored && !closing) {
                cancelTimer()
                shown.update { it.copy(closed = true) }
            }
        }
    }

    private suspend fun watchFiles() {
        // Each time the gate opens again, the states are read again: read while locked, every file would seem unusable.
        combine(repository.filesOf(noteId), checkAgain, gateOpen) { files, _, open -> files.takeIf { open } }
            .filterNotNull()
            .mapLatest { files -> files.map { FileRowState(it, reader.stateOf(it)) } }
            .catch { error ->
                // The files cannot be read: the note shows "Could not open your notes." rather than no files.
                if (error is SQLException) shown.update { it.copy(failed = true) } else throw error
            }
            .collect { rows -> shown.update { it.copy(files = rows, filesLoaded = true) } }
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

    /** Notes leaves the screen or locks: what is typed is saved, also if the screen goes meanwhile. */
    fun leftScreen() {
        cancelTimer()
        lasting.launch(work) { saveNow() }
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
            if (saveAll()) finishClosing() else shown.update { it.copy(askUnsaved = true) }
        }
    }

    /** Saves until nothing typed is left unsaved, also a change that came while a save wrote. False if a save failed. */
    private suspend fun saveAll(): Boolean {
        while (true) {
            if (!saveNow()) return false
            if (changes == savedThrough) return true
        }
    }

    /**
     * The screen went without closing the note: what is typed and not
     * saved yet is saved. Then a new note is given up once no add can make
     * it any more; one that the save made stays.
     */
    override fun onCleared() {
        cancelTimer()
        lasting.launch(work) {
            saveAll()
            if (repository.isNewNote(noteId)) adds.giveUpNewNoteAfterAdds(noteId)
        }
    }

    /** **Try again** in "This note is not saved". */
    fun tryAgain() {
        shown.update { it.copy(askUnsaved = false) }
        close()
    }

    /**
     * The question "This note is not saved" was dismissed, by Back or a tap
     * beside it: the note stays open with what is typed, and Notes tries to
     * save again at the next change.
     */
    fun keepEditing() {
        shown.update { it.copy(askUnsaved = false) }
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
        // Written down before anything is looked at, so that an Undo or an add that ends meanwhile looks at the note again:
        // a removed file whose Undo is open keeps an empty note, and so do files still being added to it.
        snackbars.closedKept(noteId)
        val stillAdding = adds.isAddingTo(noteId)
        try {
            when {
                // The adds decide: their first file makes or keeps the note; once the last one ends, a new note no add made is
                // given up, and a stored note that is empty then is deleted.
                stillAdding -> if (repository.isNewNote(noteId)) adds.giveUpNewNoteAfterAdds(noteId)
                repository.findNote(noteId) == null -> repository.giveUpNewNote(noteId)
                else -> if (repository.deleteIfEmpty(noteId)) snackbars.forget(noteId)
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
     * brings it back; if that save fails, nothing is deleted. The note
     * closes, with "Note deleted" and **Undo**. A new note that is not made
     * yet is given up. Pressed twice, it deletes once.
     */
    fun delete() {
        if (closing || shown.value.closed) return
        closing = true
        cancelTimer()
        viewModelScope.launch(work) {
            if (!saveAll()) {
                // What is typed is not saved: the note stays open with it, and its line says so (spec, "A write fails").
                closing = false
                snackbars.show(NotesMessage.CouldNotChange)
                return@launch
            }
            try {
                val deleted = snackbars.offer { repository.deleteNote(noteId)?.let(NotesMessage::NoteDeleted) }
                if (deleted == null) repository.giveUpNewNote(noteId)
                shown.update { it.copy(closed = true) }
            } catch (_: SQLException) {
                closing = false
                snackbars.show(NotesMessage.CouldNotChange)
            }
        }
    }

    /** The picker gave [picked] for **Add a file**. They are added after every file picked before, when Notes may make their keys. */
    fun addFiles(picked: List<PickedFile>, notTried: Int = 0) {
        adds.add(noteId, picked, notTried)
    }

    /** **Remove** on [file]: "File removed", with **Undo**. Pressed twice, it removes once. */
    fun removeFile(file: NoteFile) {
        viewModelScope.launch(work) {
            try {
                snackbars.offer { repository.removeFile(file.id)?.let(NotesMessage::FileRemoved) }
            } catch (_: SQLException) {
                snackbars.show(NotesMessage.CouldNotChange)
            }
        }
    }

    /**
     * **Save a copy** of the file [fileId] into [target], once the picker
     * answers, also after Android stopped Notes while the picker was open
     * and before the files are read again. The dialog "Saving a copy"
     * shows at once, before the file is looked up, so no second copy
     * starts meanwhile. A file that is gone by then gets no copy: the
     * empty document is deleted, and "Could not save the copy." shows.
     */
    fun saveCopyOf(fileId: String, target: CopyTarget) {
        if (!startCopy(target)) return
        viewModelScope.launch(work) {
            val file = try {
                repository.filesOf(noteId).first().firstOrNull { it.id == fileId }
            } catch (_: SQLException) {
                null
            }
            if (file != null) {
                copy(file, target)
            } else {
                shown.update { it.copy(copying = null) }
                refuse(target)
            }
        }
    }

    /** **Save a copy** of [file] into [target], under the dialog "Saving a copy". One copy at a time. */
    fun saveCopy(file: NoteFile, target: CopyTarget) {
        if (!startCopy(target)) return
        viewModelScope.launch(work) { copy(file, target) }
    }

    /**
     * Shows "Saving a copy" for [target] and gives true. While another copy
     * is saved, gives false and refuses [target], so that its document is
     * not left empty: one copy at a time.
     */
    private fun startCopy(target: CopyTarget): Boolean {
        var started = false
        shown.update {
            started = it.copying == null
            if (started) it.copy(copying = 0f) else it
        }
        if (!started) viewModelScope.launch(work) { refuse(target) }
        return started
    }

    private suspend fun copy(file: NoteFile, target: CopyTarget) {
        val result = reader.saveCopy(file, target) { written ->
            val fraction = if (file.size == 0L) 1f else written.toFloat() / file.size
            shown.update { it.copy(copying = fraction.coerceIn(0f, 1f)) }
        }
        shown.update { it.copy(copying = null) }
        if (result == CopyResult.BUSY) refuse(target) else snackbars.show(NotesMessage.Copy(result))
        if (result == CopyResult.DAMAGED || result == CopyResult.DAMAGED_PART_LEFT) checkFilesAgain()
    }

    /** No copy goes into [target]: its empty document is deleted, and "Could not save the copy." shows. */
    private suspend fun refuse(target: CopyTarget) {
        val gone = target.delete()
        snackbars.show(NotesMessage.Copy(if (gone) CopyResult.FAILED else CopyResult.FAILED_PART_LEFT))
    }

    private companion object {
        /** A save comes this long after the last change. */
        const val PAUSE_MILLIS = 1_000L

        /** And at the latest this long after the first change since the last save. */
        const val MOST_UNSAVED_MILLIS = 10_000L
    }
}
