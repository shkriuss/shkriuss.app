package app.shkriuss.feature.tasks.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.security.RecoveryKeyFirstNeedState
import app.shkriuss.feature.tasks.BackupViewModel
import app.shkriuss.feature.tasks.R

/**
 * Settings (docs/apps/tasks/spec.md, "As in Water and Reminders",
 * Settings screen): one column of items under section headers. Tasks has
 * no settings of its own. It shows only Backup and Security
 * ([BackupAndSecuritySections]), whose rows start [firstNeed], and About,
 * with [versionName], the version name of the installed app, such as
 * `1.0.0`, and Licences, which [onLicences] opens.
 */
@Composable
internal fun SettingsContent(backup: BackupViewModel, firstNeed: RecoveryKeyFirstNeedState, versionName: String, onLicences: () -> Unit) {
    val keys by backup.state.collectAsState()
    ShkScreen(topBar = { ShkTopBar(title = stringResource(R.string.tasks_settings)) }, scrollable = true) {
        BackupAndSecuritySections(keys, firstNeed)

        ShkSectionHeader(stringResource(R.string.tasks_section_about))
        ShkListItem(headline = stringResource(R.string.tasks_version), supportingText = versionName)
        ShkListItem(headline = stringResource(R.string.tasks_licences), onClick = onLicences)
    }
}

/** One setting: its [name], and its [value] under it. TalkBack reads both: "Recovery key, Not set up". */
@Composable
internal fun SettingItem(name: String, value: String, onClick: () -> Unit) {
    val spoken = stringResource(R.string.tasks_setting_spoken, name, value)
    ShkListItem(
        headline = name,
        supportingText = value,
        onClick = onClick,
        modifier = Modifier.semantics { contentDescription = spoken },
    )
}
