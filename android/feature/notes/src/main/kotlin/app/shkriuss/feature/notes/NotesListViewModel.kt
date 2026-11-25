package app.shkriuss.feature.notes

import android.database.SQLException
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

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
 * The one state of the list's screen: what the search field holds, the
 * new note to open, and the list.
 */
data class NotesListScreen(
    /** What the search field holds now, as typed. The list follows it 300 ms later ([NotesListState.Shown.query]). */
    val typed: String = "",
    /** The `id` of the new note that **New note** made room for, for the screen to open, or null. The screen then calls [NotesListViewModel.newNoteOpened]. */
    val newNote: String? = null,
    /** The list, as the search filters it. */
    val list: NotesListState = NotesListState.Loading,
)

/**
 * The list of Notes, its search and **New note** (docs/apps/notes/spec.md,
 * "Notes" and "Search"). What is typed filters the list 300 ms after the
 * last key; clearing the field shows every note at once. Nothing of a
 * search is stored. [wait] is the pause, which tests control.
 *
 * It has one state, [state]. What is typed is set in it at once, on the
 * thread of the press, so the field never shows an older text; the list
 * is read on [work] and set in it when it is ready.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotesListViewModel(
    private val repository: NotesRepository,
    private val snackbars: NotesSnackbars,
    private val work: CoroutineContext = Dispatchers.IO,
    private val wait: suspend (Long) -> Unit = { delay(it) },
) : ViewModel() {
    private val screen = MutableStateFlow(NotesListScreen())

    /** True while a press of **New note** reserves. It and the note to open change together, under [pressLock]. */
    private var asking = false
    private val pressLock = Any()

    /** What the screen shows: the field, the new note to open, and the list in its order and sections. */
    val state: StateFlow<NotesListScreen> = screen.asStateFlow()

    private val searched: Flow<String> = screen.map { it.typed }.distinctUntilChanged().mapLatest { text ->
        if (text.isNotEmpty()) wait(SEARCH_PAUSE_MILLIS)
        text
    }

    init {
        viewModelScope.launch(work) {
            combine(repository.notes(), repository.shownFiles(), searched) { notes, files, query -> shown(notes, files, query) as NotesListState }
                .catch { error -> if (error is SQLException) emit(NotesListState.Failed) else throw error }
                .collect { list -> screen.update { it.copy(list = list) } }
        }
    }

    /** The field changed. */
    fun search(text: String) {
        screen.update { it.copy(typed = text) }
    }

    /** Back with text in the field clears it. True if it held text, so Back did that and nothing more. */
    fun clearSearch(): Boolean {
        if (screen.value.typed.isEmpty()) return false
        screen.update { it.copy(typed = "") }
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
        synchronized(pressLock) {
            if (screen.value.newNote != null || asking) return
            asking = true
        }
        viewModelScope.launch(work) {
            var reserved: String? = null
            try {
                reserved = repository.reserveNewNote()
                if (reserved == null) snackbars.show(NotesMessage.NotesFull)
            } catch (_: SQLException) {
                snackbars.show(NotesMessage.CouldNotChange)
            } finally {
                // The note to open and the end of the press show together, so a press just after it is not lost.
                synchronized(pressLock) {
                    asking = false
                    if (reserved != null) screen.update { it.copy(newNote = reserved) }
                }
            }
        }
    }

    /** The screen opened the new note of [NotesListScreen.newNote]: the note's ViewModel owns its reservation now. */
    fun newNoteOpened() {
        screen.update { it.copy(newNote = null) }
    }

    /** A new note that was reserved and never opened is given up, so that it no longer counts towards 5,000. */
    override fun onCleared() {
        screen.value.newNote?.let(repository::giveUpNewNote)
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
