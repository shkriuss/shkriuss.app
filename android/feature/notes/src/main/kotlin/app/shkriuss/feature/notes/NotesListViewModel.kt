package app.shkriuss.feature.notes

import android.database.SQLException
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shkriuss.feature.notes.data.NoteMark
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
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * One row of the list (docs/apps/notes/spec.md, "Notes", point 3, and
 * "Search", point 2). It keeps what the row shows of its note and never
 * the whole text: the list holds a row for every note.
 */
data class NoteRowState(
    override val id: String,
    /** The title the row shows, or "" for "Empty note". */
    val title: String,
    /** True if the note has a title of its own. Only then do the matches of a search in the title show in [title]. */
    val hasTitle: Boolean,
    /**
     * The text under the title: the first 1,000 characters of the text,
     * marks removed and line breaks as spaces ([NoteRow.preview]). The
     * screen shows two lines of it.
     */
    val preview: String,
    override val pinned: Boolean,
    override val createdAt: Long,
    override val lastChange: Long,
    /** How many shown files the note has: "2 files". */
    val fileCount: Int,
    /**
     * How it matches the search, or null with no search. Its line is the
     * line as the row keeps it ([NoteSearch.rowLine]).
     */
    val match: SearchMatch? = null,
) : Listed

/**
 * The rows of the list, kept between two reads of the notes. It reads
 * the notes in groups of [NoteLimits.NOTES_AT_A_TIME] through [read], so
 * that only a few texts are in memory at a time, and keeps of each note
 * only its row. A note is read again only when its change number moved,
 * or when a search needs its text again.
 *
 * One coroutine uses it, one call after the other.
 */
internal class KeptRows(private val read: suspend (ids: List<String>) -> List<Note>) {
    /** A row without its files, for the search [query], of the note as it was at [changeNumber]. */
    private class Kept(val changeNumber: Long, val query: String, val row: NoteRowState)

    private var kept: Map<String, Kept> = emptyMap()

    /**
     * The rows of the notes of [marks] for the search [query], in the
     * order of [marks], each without its files: with no file count, and
     * with the match in its title or text only. A note that went since
     * [marks] were read has no row.
     */
    suspend fun of(marks: List<NoteMark>, query: String): List<NoteRowState> {
        val next = HashMap<String, Kept>(marks.size)
        val toRead = ArrayList<String>()
        marks.forEach { mark ->
            val old = kept[mark.id]
            // With no search, a kept row needs no text. With one, it must be the row of that search.
            val stillRight = old != null && old.changeNumber == mark.changeNumber && (query.isEmpty() || old.query == query)
            if (stillRight) next[mark.id] = checkNotNull(old) else toRead += mark.id
        }
        toRead.chunked(NoteLimits.NOTES_AT_A_TIME).forEach { group ->
            read(group).forEach { note -> next[note.id] = Kept(note.changeNumber, query, rowOf(note, query)) }
        }
        kept = next
        return marks.mapNotNull { mark ->
            // A row kept from a search shows without its match once the search is cleared.
            next[mark.id]?.row?.let { row -> if (query.isEmpty() && row.match != null) row.copy(match = null) else row }
        }
    }

    private fun rowOf(note: Note, query: String): NoteRowState {
        val match = NoteSearch.inNote(note, query)?.let { found -> found.copy(line = found.line?.let(NoteSearch::rowLine)) }
        return NoteRowState(
            id = note.id,
            title = NoteRow.title(note),
            hasTitle = note.title.isNotEmpty(),
            preview = NoteRow.preview(note),
            pinned = note.pinned,
            createdAt = note.createdAt,
            lastChange = note.lastChange,
            fileCount = 0,
            match = match,
        )
    }
}

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
 *
 * The list never holds the text of every note: it reads the notes a few
 * at a time and keeps only their rows ([KeptRows]).
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

    private val rows = KeptRows(repository::shownNotes)

    init {
        viewModelScope.launch(work) {
            combine(repository.noteMarks(), repository.shownFiles(), searched) { marks, files, query -> Triple(marks, files, query) }
                // One answer is read to its end before the next starts, so what a read kept is there for the next.
                .conflate()
                .map { (marks, files, query) -> shown(marks, files, query) as NotesListState }
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

    private suspend fun shown(marks: List<NoteMark>, files: List<NoteFile>, query: String): NotesListState.Shown {
        val filesByNote = files.groupBy { it.noteId }
        val shownRows = rows.of(marks, query).mapNotNull { row ->
            val shownFiles = filesByNote[row.id].orEmpty().sortedWith(NoteOrder.FILES)
            // A note whose title and text do not match can still match by the name of a file.
            val match = if (query.isEmpty()) null else row.match ?: NoteSearch.inFileNames(shownFiles.map { it.name }, query) ?: return@mapNotNull null
            row.copy(fileCount = shownFiles.size, match = match)
        }
        val sections = NoteOrder.sections(shownRows)
        return NotesListState.Shown(
            query = query,
            pinned = sections.pinned,
            others = sections.others,
            noNotes = marks.isEmpty(),
            noMatch = query.isNotEmpty() && shownRows.isEmpty(),
        )
    }

    private companion object {
        /** The pause after the last key before the list follows the search. */
        const val SEARCH_PAUSE_MILLIS = 300L
    }
}
