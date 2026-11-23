package app.shkriuss.feature.tasks.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.feature.tasks.R

/**
 * Settings (docs/apps/tasks/spec.md, "As in Water and Reminders",
 * Settings screen): one column of items under section headers. Tasks has
 * no settings of its own. It shows About, with [versionName], the version
 * name of the installed app, such as `1.0.0`. Backup, Security and
 * Licences come with backup, restore, the recovery key and the app lock.
 */
@Composable
internal fun SettingsContent(versionName: String) {
    ShkScreen(topBar = { ShkTopBar(title = stringResource(R.string.tasks_settings)) }, scrollable = true) {
        ShkSectionHeader(stringResource(R.string.tasks_section_about))
        ShkListItem(headline = stringResource(R.string.tasks_version), supportingText = versionName)
    }
}
