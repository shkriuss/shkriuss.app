package app.shkriuss.feature.reminders.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.feature.reminders.R

/**
 * Settings (docs/apps/reminders/spec.md, "As in Water", Settings screen):
 * one column of items under section headers. Reminders has no settings of
 * its own. It shows About, with [versionName], the version name of the
 * installed app, such as `1.0.0`. The sections Backup and Security, and
 * Licences under About, come with the backup, the recovery key and the
 * app lock.
 */
@Composable
internal fun SettingsContent(versionName: String) {
    ShkScreen(topBar = { ShkTopBar(title = stringResource(R.string.reminders_settings)) }, scrollable = true) {
        ShkSectionHeader(stringResource(R.string.reminders_section_about))
        ShkListItem(headline = stringResource(R.string.reminders_version), supportingText = versionName)
    }
}
