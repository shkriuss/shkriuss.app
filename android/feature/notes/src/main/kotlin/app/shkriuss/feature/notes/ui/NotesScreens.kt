package app.shkriuss.feature.notes.ui

import androidx.activity.compose.BackHandler
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkDestination
import app.shkriuss.core.design.ShkDialog
import app.shkriuss.core.design.ShkDialogAction
import app.shkriuss.core.design.ShkNavigationScaffold
import app.shkriuss.core.design.ShkSnackbarHostState
import app.shkriuss.core.design.ShkSnackbarResult
import app.shkriuss.core.design.rememberShkSnackbarHostState
import app.shkriuss.feature.notes.NoteViewModel
import app.shkriuss.feature.notes.NotesSnackbars
import app.shkriuss.feature.notes.OpenNoteViewModel
import app.shkriuss.feature.notes.R

/**
 * Every screen of Notes (docs/apps/notes/spec.md, "As in Water and
 * Tasks", navigation): Notes and Settings, in a navigation bar under 600dp
 * and a rail from 600dp. Notes is the start screen.
 *
 * - Each destination keeps its scroll position when the user switches.
 *   Changing the destination closes the open note after its save, and ends
 *   the **Undo** of a snackbar.
 * - Back from Settings goes to Notes. On Notes, the image view, the open
 *   note under 840dp and a search close first. Back from Notes leaves the
 *   app.
 * - The one snackbar of Notes shows on the screen in front, and the
 *   question "This note is not saved" over every destination, because a
 *   note can close while Settings shows.
 *
 * There is no navigation library (ADR 0003, point 2): the chosen
 * destination is saved state, and the open note is in the [NotesModels].
 * The activity puts this in `AppLockGate`, and every dialog and menu of
 * Notes is drawn from inside it. [versionName] is the version name of the
 * installed app, such as `1.0.0`.
 */
@Composable
fun NotesScreens(models: NotesModels, versionName: String) {
    var destination by rememberSaveable { mutableStateOf(NotesDestination.NOTES) }
    val go = { to: NotesDestination ->
        if (to != destination) {
            models.snackbars.endUndo()
            if (to != NotesDestination.NOTES) models.open.close()
            destination = to
        }
    }
    // Before the content, so that the Back of the image view, an open note and a search comes first.
    BackHandler(enabled = destination != NotesDestination.NOTES) { go(NotesDestination.NOTES) }
    val snackbar = rememberShkSnackbarHostState()
    NotesSnackbar(models.snackbars, snackbar)
    val saved = rememberSaveableStateHolder()
    ShkNavigationScaffold(
        destinations = NotesDestination.entries.map { ShkDestination(stringResource(it.label), painterResource(it.icon)) },
        selectedIndex = destination.ordinal,
        onSelect = { go(NotesDestination.entries[it]) },
    ) {
        saved.SaveableStateProvider(destination.name) {
            when (destination) {
                NotesDestination.NOTES -> NotesContent(models, snackbar)
                NotesDestination.SETTINGS -> SettingsContent(models.settings, versionName, snackbar)
            }
        }
    }
    UnsavedQuestion(models.open)
}

/** The two destinations of Notes, in the order the navigation shows them. */
private enum class NotesDestination(@param:StringRes val label: Int, @param:DrawableRes val icon: Int) {
    NOTES(R.string.notes_notes, R.drawable.notes_icon_notes),
    SETTINGS(R.string.notes_settings, R.drawable.notes_icon_settings),
}

/**
 * Shows the snackbar of [snackbars] in [host], and tells it how it went:
 * **Undo** pressed, or gone by itself. A snackbar that another one
 * replaces goes at once.
 */
@Composable
private fun NotesSnackbar(snackbars: NotesSnackbars, host: ShkSnackbarHostState) {
    val message by snackbars.current.collectAsState()
    val format = rememberNotesFormat()
    val words = message?.let { notesMessageText(it, format) }
    val undo = stringResource(R.string.notes_undo)
    LaunchedEffect(message) {
        val shown = message ?: return@LaunchedEffect
        val text = words ?: return@LaunchedEffect
        when (host.show(text, actionText = if (shown.offersUndo) undo else null)) {
            ShkSnackbarResult.ActionPerformed -> snackbars.undo()
            ShkSnackbarResult.Dismissed -> snackbars.gone(shown)
        }
    }
}

/**
 * The question "This note is not saved", with **Try again** and **Discard
 * changes**, when the save before a note closes failed
 * (docs/apps/notes/spec.md, "A write fails"). Back or a tap beside it
 * keeps the note open with what is typed.
 */
@Composable
private fun UnsavedQuestion(open: OpenNoteViewModel) {
    val note by open.open.collectAsState()
    val model = note?.model ?: return
    UnsavedQuestionOf(model, onKeepEditing = open::keepEditing)
}

@Composable
private fun UnsavedQuestionOf(model: NoteViewModel, onKeepEditing: () -> Unit) {
    val state by model.state.collectAsState()
    if (!state.askUnsaved) return
    ShkDialog(
        title = stringResource(R.string.notes_not_saved),
        // Each answer ends the question by itself: the dialog goes when the ViewModel says so.
        confirmAction = ShkDialogAction(text = stringResource(R.string.notes_try_again), onClick = model::tryAgain, closesDialog = false),
        dismissAction = ShkDialogAction(
            text = stringResource(R.string.notes_discard),
            onClick = model::discard,
            destructive = true,
            closesDialog = false,
        ),
        onDismissRequest = onKeepEditing,
    )
}
