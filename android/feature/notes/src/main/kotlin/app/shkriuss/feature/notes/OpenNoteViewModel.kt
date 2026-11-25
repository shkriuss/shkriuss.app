package app.shkriuss.feature.notes

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/** The note that is open beside or in place of the list, and the image view that may show in its place. */
data class OpenNote(
    /** The note's ViewModel. */
    val model: NoteViewModel,
    /** True for a new note: it opens with the keyboard in the text (docs/apps/notes/spec.md, "A note", point 5). */
    val isNew: Boolean,
    /** The `id` of the file whose image view shows in place of the note, or null for the note. */
    val imageId: String? = null,
    /**
     * What the pane of the note is known by, with its saved state and the
     * launchers of its file pickers: the note's `id`, or the `id` of the
     * new note whose place it took after Android stopped Notes.
     */
    val paneKey: String = model.noteId,
)

/**
 * Which note is open, one at a time, and the image view in its place
 * (docs/apps/notes/spec.md, "Notes", point 4, "Saving", point 1, and "The
 * image view"). Notes has no navigation library (ADR 0003, point 2): the
 * open note is this ViewModel, which lives as long as the screen and is
 * kept while the phone is turned.
 *
 * Each open note has a [NoteViewModel] of its own, which [make] makes, in
 * a store of its own. A note closes after its save: on Back, when the
 * destination changes, when it is deleted, or when another note opens.
 * Another note opens only once the one before has closed; if its save
 * failed, the question "This note is not saved" comes first, and
 * [keepEditing] keeps it open and the other note closed. When the note has
 * closed, its store is cleared. [giveUp] gives up a new note that was
 * reserved for opening and never opened, so it no longer counts towards
 * 5,000.
 *
 * The open note and its image view are kept in [saved], so that after
 * Android stopped Notes, as while a file picker was open, the note opens
 * again, with the launcher that waits for the picker's result. A new note
 * that was not stored yet lost its reservation with Notes: [reserveNew]
 * reserves another one in its place, in the same pane, so a file picked
 * for it is still added. [isStored] says whether a note is stored.
 */
class OpenNoteViewModel(
    private val make: (noteId: String) -> NoteViewModel,
    private val giveUp: (noteId: String) -> Unit,
    private val saved: SavedStateHandle,
    private val reserveNew: suspend () -> String?,
    private val isStored: suspend (noteId: String) -> Boolean,
) : ViewModel() {
    private val shown = MutableStateFlow<OpenNote?>(null)
    private var store: ViewModelStore? = null

    /** The note to open once the open one has closed, and whether it is new. */
    private var next: Pair<String, Boolean>? = null

    /** The open note, or null. */
    val open: StateFlow<OpenNote?> = shown.asStateFlow()

    init {
        // Opened again after Android stopped Notes: a note that is gone by now closes at once.
        val noteId = saved.get<String>(NOTE_KEY)
        if (noteId != null) {
            val imageId = saved.get<String>(IMAGE_KEY)
            val paneKey = saved.get<String>(PANE_KEY) ?: noteId
            if (saved.get<Boolean>(NEW_KEY) == true) {
                viewModelScope.launch {
                    val fresh = if (isStored(noteId)) null else reserveNew()
                    if (fresh != null) start(fresh, isNew = true, paneKey = paneKey) else start(noteId, isNew = false, paneKey = paneKey)
                }
            } else {
                start(noteId, isNew = false, paneKey = paneKey)
                imageId?.let(::openImage)
            }
        }
    }

    /**
     * Opens the note [noteId], [isNew] for a note that **New note**
     * reserved. A note that is open already shows itself, not its image
     * view. Another open note closes first.
     */
    fun open(noteId: String, isNew: Boolean = false) {
        val now = shown.value
        when {
            now == null -> start(noteId, isNew)
            now.model.noteId == noteId -> {
                // The open note is closing for another one: the last tap wins, and this note opens again after.
                if (next != null) {
                    dropNext()
                    next = noteId to false
                }
                show(now.copy(imageId = null))
            }
            else -> {
                dropNext()
                next = noteId to isNew
                now.model.close()
            }
        }
    }

    /** Back on the note, or the destination changed: the open note closes after its save. */
    fun close() {
        dropNext()
        shown.value?.model?.close()
    }

    /** The question "This note is not saved" was dismissed: the note stays open, and the note that waited does not open. */
    fun keepEditing() {
        dropNext()
        shown.value?.model?.keepEditing()
    }

    /** Opens the image view of the file [fileId] in place of the note. */
    fun openImage(fileId: String) {
        shown.value?.let { show(it.copy(imageId = fileId)) }
    }

    /** Back on the image view, or its file was removed: the note shows again. */
    fun closeImage() {
        shown.value?.let { show(it.copy(imageId = null)) }
    }

    /** Shows [note], or no note, and keeps which in [saved]. */
    private fun show(note: OpenNote?) {
        shown.value = note
        saved[NOTE_KEY] = note?.model?.noteId
        saved[IMAGE_KEY] = note?.imageId
        saved[NEW_KEY] = note?.isNew
        saved[PANE_KEY] = note?.paneKey
    }

    /** Notes leaves the screen or locks: what is typed in the open note is saved. */
    fun leftScreen() {
        shown.value?.model?.leftScreen()
    }

    private fun start(noteId: String, isNew: Boolean, paneKey: String = noteId) {
        val notes = ViewModelStore()
        val model = ViewModelProvider(notes, viewModelFactory { initializer { make(noteId) } })[NoteViewModel::class.java]
        store = notes
        show(OpenNote(model, isNew, paneKey = paneKey))
        viewModelScope.launch {
            model.state.first { it.closed }
            closed(model)
        }
    }

    /** [model]'s note has closed: its store is cleared, and the note that waits opens. */
    private fun closed(model: NoteViewModel) {
        if (shown.value?.model !== model) return
        store?.clear()
        store = null
        show(null)
        next?.let { (noteId, isNew) ->
            next = null
            start(noteId, isNew)
        }
    }

    private fun dropNext() {
        val (noteId, isNew) = next ?: return
        next = null
        if (isNew) giveUp(noteId)
    }

    /** The screen went for good: the open note saves what is typed, and a note that waited is given up. */
    override fun onCleared() {
        dropNext()
        store?.clear()
        store = null
    }

    private companion object {
        /** The keys of the open note, of the file of its image view, of whether it is new and of its pane in the saved state. */
        const val NOTE_KEY = "openNote"
        const val IMAGE_KEY = "openImage"
        const val NEW_KEY = "openNoteIsNew"
        const val PANE_KEY = "openNotePane"
    }
}
