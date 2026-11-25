package app.shkriuss.feature.notes.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkErrorState
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkSnackbarHostState
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.feature.notes.FilesLine
import app.shkriuss.feature.notes.NoteLimits
import app.shkriuss.feature.notes.R
import app.shkriuss.feature.notes.SettingsViewModel

/**
 * Settings (docs/apps/notes/spec.md, "Settings"): one column of items
 * under section headers. **Files** comes first, with one line that is not
 * a button, "12 files, 120 MB of 1 GB" or "No files"; when the files
 * cannot be counted, `ShkErrorState` "Could not open your notes." in its
 * place, so the rest of Settings stays within reach. About shows
 * [versionName], the version name of the installed app, such as `1.0.0`.
 * Backup, Security and Licences come with backup, restore, the recovery
 * key and the app lock.
 */
@Composable
internal fun SettingsContent(model: SettingsViewModel, versionName: String, snackbar: ShkSnackbarHostState) {
    val files by model.files.collectAsState()
    val format = rememberNotesFormat()
    ShkScreen(topBar = { ShkTopBar(title = stringResource(R.string.notes_settings)) }, scrollable = true, snackbarHostState = snackbar) {
        ShkSectionHeader(stringResource(R.string.notes_section_files))
        when (val line = files) {
            FilesLine.Loading -> Unit
            // In the section only: About, and later Security with the recovery key, stay within reach.
            FilesLine.Failed -> ShkErrorState(title = stringResource(R.string.notes_could_not_open))
            is FilesLine.Counted -> {
                val totals = line.totals
                val words = if (totals.count == 0) {
                    stringResource(R.string.notes_no_files)
                } else {
                    stringResource(
                        R.string.notes_files_line,
                        pluralStringResource(R.plurals.notes_file_count, totals.count, format.number(totals.count)),
                        format.size(totals.bytes),
                        format.size(NoteLimits.MOST_ALL_FILE_BYTES),
                    )
                }
                ShkListItem(headline = words)
            }
        }
        ShkSectionHeader(stringResource(R.string.notes_section_about))
        ShkListItem(headline = stringResource(R.string.notes_version), supportingText = versionName)
    }
}
