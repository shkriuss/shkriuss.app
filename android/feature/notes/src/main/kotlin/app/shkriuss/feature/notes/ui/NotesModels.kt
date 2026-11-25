package app.shkriuss.feature.notes.ui

import android.database.SQLException
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.shkriuss.feature.notes.NoteImages
import app.shkriuss.feature.notes.NoteViewModel
import app.shkriuss.feature.notes.NotesListViewModel
import app.shkriuss.feature.notes.NotesNow
import app.shkriuss.feature.notes.NotesServices
import app.shkriuss.feature.notes.NotesSnackbars
import app.shkriuss.feature.notes.OpenNoteViewModel
import app.shkriuss.feature.notes.SettingsViewModel

/**
 * The ViewModels of Notes' screens, made once for the activity [owner]
 * and kept while the phone is turned. Notes has no navigation library
 * (ADR 0003, point 2): the two destinations, the open note and its image
 * view are these ViewModels and the screen's saved state.
 */
class NotesModels(owner: ViewModelStoreOwner, services: NotesServices) {
    private val provider = ViewModelProvider(
        owner,
        viewModelFactory {
            initializer { NotesListViewModel(services.repository, services.snackbars) }
            initializer {
                val repository = services.repository
                // An open note outlives this object when the phone is turned, so it holds the services' parts only.
                OpenNoteViewModel(
                    make = { noteId -> NoteViewModel(repository, services.adds, services.reader, services.snackbars, noteId, services.scope) },
                    giveUp = repository::giveUpNewNote,
                    saved = createSavedStateHandle(),
                    reserveNew = {
                        try {
                            repository.reserveNewNote()
                        } catch (_: SQLException) {
                            null
                        }
                    },
                    isStored = { noteId ->
                        try {
                            repository.findNote(noteId) != null
                        } catch (_: SQLException) {
                            // The note opens as it was, and shows that Notes cannot open the notes.
                            true
                        }
                    },
                )
            }
            initializer { SettingsViewModel(services.repository) }
        },
    )

    /** The list, its search and **New note**. */
    val list: NotesListViewModel = provider[NotesListViewModel::class.java]

    /** The open note, and the image view in its place. */
    val open: OpenNoteViewModel = provider[OpenNoteViewModel::class.java]

    /** Settings: the section Files. */
    val settings: SettingsViewModel = provider[SettingsViewModel::class.java]

    /** The one snackbar of Notes. */
    val snackbars: NotesSnackbars = services.snackbars

    /** The images of files, decoded in memory. */
    val images: NoteImages = services.images

    /** The phone's clock for the screens. */
    val now: NotesNow = services.now

    /**
     * The clock is read again, so a last change shows in the phone's zone
     * and day now, and the open note reads the states of its files again:
     * on the way back from a screen of `core/security` the keys may have
     * changed. The activity calls it each time it comes to the front.
     */
    fun check() {
        now.check()
        open.open.value?.model?.checkFilesAgain()
    }

    /**
     * Notes leaves the screen: the open note saves what is typed, and a
     * snackbar with **Undo** goes, so its Undo ends (docs/apps/notes/spec.md,
     * "Saving", point 1, and "Removing a file, and the wipe", point 2). The
     * activity calls it when it stops.
     */
    fun leftScreen() {
        open.leftScreen()
        snackbars.endUndo()
    }
}
