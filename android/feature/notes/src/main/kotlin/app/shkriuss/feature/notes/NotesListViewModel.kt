package app.shkriuss.feature.notes

import android.database.SQLException
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus

/** One row of the list (docs/apps/notes/spec.md, "Notes", point 3, and "Search", point 2). */
data class NoteRowState(
    /** The note. */
    val note: Note,
    /** The title the row shows, or "" for "Empty note". */
    val title: String,
    /** The text under the title, marks removed and line breaks as spaces. The screen shows two lines of it. */
    val preview: String,
    /** How many shown files the note has: "2 files". */
    val fileCount: Int,
    /** How it matches the search, or null with no search. */
    val match: SearchMatch? = null,
)

/** What the list shows. */
sealed interface NotesListState {
    /** The notes are being read. */
    data object Loading : NotesListState

    /** The database cannot be read: `ShkErrorState`, "Could not open your notes." */
    data object Failed : NotesListState

    /**
     * The notes in their sections, for [query]. With no pinned note,
     * [pinned] is empty and the list has no heading. [noMatch] is true for
     * "No notes match “rent”.", and [noNotes] for "No notes yet".
     */
    data class Shown(
        val query: String,
        val pinned: List<NoteRowState>,
        val others: List<NoteRowState>,
        val noNotes: Boolean,
        val noMatch: Boolean,
    ) : NotesListState
}

/**
 * The list of Notes, its search and **New note** (docs/apps/notes/spec.md,
 * "Notes" and "Search"). What is typed filters the list 300 ms after the
 * last key; clearing the field shows every note at once. Nothing of a
 * search is stored. [wait] is the pause, which tests control.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotesListViewModel(
    private val repository: NotesRepository,
    private val snackbars: NotesSnackbars,
    private val work: CoroutineContext = Dispatchers.IO,
    private val wait: suspend (Long) -> Unit = { delay(it) },
) : ViewModel() {
    private val typed = MutableStateFlow("")
    private val opening = MutableStateFlow<String?>(null)
    private val asking = AtomicBoolean(false)

    /** What the field holds now, as typed. */
    val query: StateFlow<String> = typed

    /** The `id` of the new note that **New note** made room for, for the screen to open. The screen calls [newNoteOpened]. */
    val newNote: StateFlow<String?> = opening

    private val searched: Flow<String> = typed.mapLatest { text ->
        if (text.isNotEmpty()) wait(SEARCH_PAUSE_MILLIS)
        text
    }

    /** The list, in its order and sections, as the search filters it. */
    val state: StateFlow<NotesListState> =
        combine(repository.notes(), repository.shownFiles(), searched) { notes, files, query -> shown(notes, files, query) as NotesListState }
            .catch { error -> if (error is SQLException) emit(NotesListState.Failed) else throw error }
            .stateIn(viewModelScope + work, SharingStarted.Eagerly, NotesListState.Loading)

    /** The field changed. */
    fun search(text: String) {
        typed.value = text
    }

    /** Back with text in the field clears it. True if it held text, so Back did that and nothing more. */
    fun clearSearch(): Boolean {
        if (typed.value.isEmpty()) return false
        typed.value = ""
        return true
    }

    /**
     * **New note**: reserves the `id` of a new note, for the screen to
     * open, unless 5,000 notes are shown, new ones that are not made yet
     * counted too: then it shows "Notes keeps 5,000 notes. Delete some to
     * add more." A second press before the note opens does nothing, so
     * one note opens.
     */
    fun newNote() {
        if (opening.value != null || !asking.compareAndSet(false, true)) return
        viewModelScope.launch(work) {
            try {
                val reserved = try {
                    repository.reserveNewNote()
                } catch (_: SQLException) {
                    snackbars.show(NotesMessage.CouldNotChange)
                    return@launch
                }
                if (reserved == null) snackbars.show(NotesMessage.NotesFull) else opening.value = reserved
            } finally {
                asking.set(false)
            }
        }
    }

    /** The screen opened the new note of [newNote]: the note's ViewModel owns its reservation now. */
    fun newNoteOpened() {
        opening.value = null
    }

    /** A new note that was reserved and never opened is given up, so that it no longer counts towards 5,000. */
    override fun onCleared() {
        opening.value?.let(repository::giveUpNewNote)
    }

    private fun shown(notes: List<Note>, files: List<NoteFile>, query: String): NotesListState.Shown {
        val namesByNote = files.groupBy({ it.noteId }, { it })
        val rows = notes.mapNotNull { note ->
            val shownFiles = namesByNote[note.id].orEmpty().sortedWith(NoteOrder.FILES)
            val match = if (query.isEmpty()) null else NoteSearch.match(note, shownFiles.map { it.name }, query) ?: return@mapNotNull null
            NoteRowState(note, NoteRow.title(note), NoteRow.preview(note), shownFiles.size, match)
        }
        val sections = NoteOrder.sections(rows.map { it.note })
        val byId = rows.associateBy { it.note.id }
        return NotesListState.Shown(
            query = query,
            pinned = sections.pinned.map { byId.getValue(it.id) },
            others = sections.others.map { byId.getValue(it.id) },
            noNotes = notes.isEmpty(),
            noMatch = query.isNotEmpty() && rows.isEmpty(),
        )
    }

    private companion object {
        /** The pause after the last key before the list follows the search. */
        const val SEARCH_PAUSE_MILLIS = 300L
    }
}
