package app.shkriuss.feature.notes.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.feature.notes.AddProblem
import app.shkriuss.feature.notes.CopyResult
import app.shkriuss.feature.notes.FileState
import app.shkriuss.feature.notes.NoteLimits
import app.shkriuss.feature.notes.NotesMessage
import app.shkriuss.feature.notes.R
import app.shkriuss.feature.notes.offeredUndo

/** True if the snackbar of this message has **Undo**. */
internal val NotesMessage.offersUndo: Boolean
    get() = offeredUndo != null

/** The words of the snackbar [message] (docs/apps/notes/spec.md, "Screens", "Files" and "A write fails"). */
@Composable
internal fun notesMessageText(message: NotesMessage, format: NotesFormat): String = when (message) {
    is NotesMessage.NoteDeleted -> stringResource(R.string.notes_note_deleted)
    is NotesMessage.FileRemoved -> stringResource(R.string.notes_file_removed)
    NotesMessage.NotesFull -> pluralStringResource(R.plurals.notes_notes_full, NoteLimits.MOST_NOTES, format.number(NoteLimits.MOST_NOTES))
    NotesMessage.CouldNotChange -> stringResource(R.string.notes_could_not_change)
    // The same words, and Undo with them: the press can be tried again.
    is NotesMessage.UndoFailed -> stringResource(R.string.notes_could_not_change)
    is NotesMessage.NotAdded -> addProblemText(message.problem, format)
    is NotesMessage.Copy -> copyText(message.result)
}

/** Why a picked file was not added. */
@Composable
private fun addProblemText(problem: AddProblem, format: NotesFormat): String = when (problem) {
    is AddProblem.NoteFull -> {
        val most = NoteLimits.MOST_FILES_PER_NOTE
        stringResource(
            R.string.notes_two_sentences,
            pluralStringResource(R.plurals.notes_note_holds, most, format.number(most)),
            pluralStringResource(R.plurals.notes_not_added, problem.notAdded, format.number(problem.notAdded)),
        )
    }
    AddProblem.AllFull -> stringResource(R.string.notes_all_full, format.size(NoteLimits.MOST_ALL_FILE_BYTES))
    is AddProblem.TooLarge -> stringResource(R.string.notes_too_large, problem.name, format.size(NoteLimits.MOST_FILE_BYTES))
    AddProblem.NoteDeleted -> stringResource(R.string.notes_note_gone)
    is AddProblem.CouldNotAdd -> stringResource(R.string.notes_could_not_add, problem.name)
    is AddProblem.CouldNotRead -> stringResource(R.string.notes_could_not_read, problem.name)
    AddProblem.KeysNotUsable -> stringResource(R.string.notes_keys_not_usable)
}

/** What **Save a copy** did. A busy copy shows no snackbar, so it has words only for safety. */
@Composable
private fun copyText(result: CopyResult): String = when (result) {
    CopyResult.SAVED -> stringResource(R.string.notes_copy_saved)
    CopyResult.DAMAGED -> stringResource(R.string.notes_copy_damaged)
    CopyResult.DAMAGED_PART_LEFT -> stringResource(R.string.notes_copy_damaged_part)
    CopyResult.FAILED, CopyResult.BUSY -> stringResource(R.string.notes_copy_failed)
    CopyResult.FAILED_PART_LEFT -> stringResource(R.string.notes_copy_failed_part)
}

/** What the row of a file says under its name when it cannot be opened, or null when it can. */
@Composable
internal fun fileStateText(state: FileState?): String? = when (state) {
    null, FileState.READY -> null
    FileState.NOT_ON_PHONE -> stringResource(R.string.notes_not_on_phone)
    FileState.KEYS_NOT_USABLE -> stringResource(R.string.notes_keys_not_usable)
    FileState.NO_LONGER_OPENS -> stringResource(R.string.notes_no_longer_opens)
    FileState.DAMAGED -> stringResource(R.string.notes_damaged)
}
