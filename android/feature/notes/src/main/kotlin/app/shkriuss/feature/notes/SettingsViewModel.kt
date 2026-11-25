package app.shkriuss.feature.notes

import android.database.SQLException
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shkriuss.feature.notes.data.FileTotals
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.plus

/** The line of the section Files in Settings (docs/apps/notes/spec.md, "Settings"). */
sealed interface FilesLine {
    /** The files are being counted. */
    data object Loading : FilesLine

    /** The database cannot be read: "Could not open your notes." */
    data object Failed : FilesLine

    /** "12 files, 120 MB of 1 GB", or "No files" when [totals] counts none. */
    data class Counted(val totals: FileTotals) : FilesLine
}

/**
 * Settings of Notes: the section Files, which counts the files that are
 * not deleted, as the limit of 1 GB does (docs/apps/notes/spec.md,
 * "Settings"). A file whose **Undo** is still open counts no more.
 */
class SettingsViewModel(repository: NotesRepository, work: CoroutineContext = Dispatchers.IO) : ViewModel() {
    /** The line under Files. */
    val files: StateFlow<FilesLine> = repository.totals()
        .map { FilesLine.Counted(it) as FilesLine }
        .catch { error -> if (error is SQLException) emit(FilesLine.Failed) else throw error }
        .stateIn(viewModelScope + work, SharingStarted.Eagerly, FilesLine.Loading)
}
