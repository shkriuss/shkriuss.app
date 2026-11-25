package app.shkriuss.feature.tasks.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.backup.BackupDocuments
import app.shkriuss.core.design.ShkDialog
import app.shkriuss.core.design.ShkDialogAction
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkProgressDialog
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.security.RecoveryKeyFirstNeed
import app.shkriuss.core.security.RecoveryKeyFirstNeedState
import app.shkriuss.core.security.RecoveryKeyNeed
import app.shkriuss.core.security.SecurityScreens
import app.shkriuss.feature.tasks.BackupOpen
import app.shkriuss.feature.tasks.BackupRefusal
import app.shkriuss.feature.tasks.BackupScreen
import app.shkriuss.feature.tasks.BackupStep
import app.shkriuss.feature.tasks.BackupViewModel
import app.shkriuss.feature.tasks.R
import app.shkriuss.feature.tasks.RecoveryKeyLine

/**
 * The sections "Backup" and "Security" of Settings
 * (docs/apps/water/spec.md, "Settings screen", as
 * docs/apps/tasks/spec.md, "As in Water and Reminders", says). Nothing of
 * them shows until the keys were read once, so no row says "Not set up"
 * for a moment in an app that has its recovery key.
 *
 * - **Make a backup**, **Restore a backup** and **App lock** need the
 *   recovery key. Each starts [firstNeed] with what it is for: with the
 *   key there, Tasks goes on at once; without it, the dialog of ADR 0035
 *   shows first. The two backup rows stay enabled either way.
 * - **Recovery key** always opens the security screen of `core/security`.
 */
@Composable
internal fun ColumnScope.BackupAndSecuritySections(screen: BackupScreen, firstNeed: RecoveryKeyFirstNeedState) {
    if (!screen.loaded) return
    val context = LocalContext.current

    ShkSectionHeader(stringResource(R.string.tasks_section_backup))
    // A note, not a button, and only while the app has no recovery key (Water's spec, "What Settings shows before it").
    val note = when (screen.recoveryKey) {
        RecoveryKeyLine.NOT_SET_UP -> R.string.tasks_backup_note_no_key
        RecoveryKeyLine.UNFINISHED -> R.string.tasks_backup_note_unfinished
        RecoveryKeyLine.SET_UP -> null
    }
    if (note != null) {
        ShkText(text = stringResource(note), color = ShkTheme.colors.textSecondary, modifier = Modifier.padding(bottom = ShkSpacing.Small))
    }
    ShkListItem(headline = stringResource(R.string.tasks_make_backup), onClick = { firstNeed.start(RecoveryKeyNeed.BACKUP) })
    ShkListItem(headline = stringResource(R.string.tasks_restore_backup), onClick = { firstNeed.start(RecoveryKeyNeed.RESTORE) })

    ShkSectionHeader(stringResource(R.string.tasks_section_security))
    SettingItem(
        name = stringResource(R.string.tasks_recovery_key),
        value = stringResource(
            when (screen.recoveryKey) {
                RecoveryKeyLine.NOT_SET_UP -> R.string.tasks_recovery_key_not_set_up
                RecoveryKeyLine.UNFINISHED -> R.string.tasks_recovery_key_unfinished
                RecoveryKeyLine.SET_UP -> R.string.tasks_recovery_key_set_up
            },
        ),
        onClick = { context.startActivity(SecurityScreens.securityIntent(context)) },
    )
    SettingItem(
        name = stringResource(R.string.tasks_app_lock),
        value = stringResource(if (screen.appLockOn) R.string.tasks_app_lock_on else R.string.tasks_app_lock_off),
        onClick = { firstNeed.start(RecoveryKeyNeed.APP_LOCK) },
    )
}

/**
 * Everything of a backup and a restore that is not a row of Settings
 * (docs/apps/water/spec.md, "Backup and restore screens" and "The recovery
 * key when first needed"): the first-need dialog of `core/security`, the
 * two screens of Android's file picker, and the dialogs. `TasksScreens`
 * draws it once, inside the app lock's gate, so it does not depend on the
 * destination that shows.
 *
 * The result of a picker only tells the ViewModel. It can arrive while
 * the app is locked: the work then goes on and shows nothing until the
 * system prompt.
 */
@Composable
internal fun BackupFlow(model: BackupViewModel, firstNeed: RecoveryKeyFirstNeedState) {
    val screen by model.state.collectAsState()
    val context = LocalContext.current
    val newDocument = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        model.write(BackupDocuments.uriOf(result.resultCode, result.data, context))
    }
    val document = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        model.look(BackupDocuments.uriOf(result.resultCode, result.data, context))
    }

    // With the recovery key there, Tasks goes on with what the user started, without another tap.
    RecoveryKeyFirstNeed(firstNeed, onReady = model::goOn)
    val open = screen.open
    LaunchedEffect(open) {
        when (open) {
            null -> return@LaunchedEffect
            is BackupOpen.NewDocument -> newDocument.launch(BackupDocuments.createIntent(open.name))
            BackupOpen.Document -> document.launch(BackupDocuments.openIntent())
            BackupOpen.AppLock -> context.startActivity(SecurityScreens.appLockIntent(context))
        }
        model.opened()
    }

    BackupDialog(screen.step, model)
}

/** The dialog of [step]: a progress circle while Tasks works, the question before a restore, or how it ended. */
@Composable
private fun BackupDialog(step: BackupStep?, model: BackupViewModel) {
    when (step) {
        null -> Unit
        BackupStep.Writing -> ShkProgressDialog(stringResource(R.string.tasks_backup_writing))
        BackupStep.Checking -> ShkProgressDialog(stringResource(R.string.tasks_backup_checking))
        BackupStep.Restoring -> ShkProgressDialog(stringResource(R.string.tasks_backup_restoring))
        is BackupStep.Question -> RestoreQuestion(step, model)
        else -> {
            val (title, text) = wordsOf(step)
            ShkDialog(
                title = title,
                text = text,
                confirmAction = ShkDialogAction(text = stringResource(R.string.tasks_ok), onClick = {}),
                onDismissRequest = model::close,
            )
        }
    }
}

/**
 * "Restore this backup?", with when the backup was made and how many
 * tasks it holds. **Restore** restores it; **Cancel** changes nothing.
 */
@Composable
private fun RestoreQuestion(question: BackupStep.Question, model: BackupViewModel) {
    val format = rememberTasksFormat()
    ShkDialog(
        title = stringResource(R.string.tasks_restore_question_title),
        text = pluralStringResource(
            R.plurals.tasks_restore_question_text,
            quantityOf(question.tasks),
            format.count(question.tasks),
            format.madeAt(question.madeAt),
        ),
        // The dialog stays until the ViewModel shows the next one: "Restoring the backup".
        confirmAction = ShkDialogAction(text = stringResource(R.string.tasks_restore), onClick = model::restore, closesDialog = false),
        dismissAction = ShkDialogAction(text = stringResource(R.string.tasks_cancel), onClick = {}),
        onDismissRequest = model::close,
    )
}

/** The title and the text of the dialog that says how a backup or a restore ended. */
@Composable
private fun wordsOf(step: BackupStep): Pair<String, String> {
    val format = rememberTasksFormat()
    return when (step) {
        is BackupStep.Written -> stringResource(R.string.tasks_backup_written_title) to
            pluralStringResource(R.plurals.tasks_backup_written_text, quantityOf(step.tasks), format.count(step.tasks))
        BackupStep.WrittenNotUsable -> words(R.string.tasks_backup_not_usable_title, R.string.tasks_backup_not_usable_text)
        BackupStep.WrittenNotChecked -> words(R.string.tasks_backup_not_checked_title, R.string.tasks_backup_not_checked_text)
        BackupStep.NotWritten -> words(R.string.tasks_backup_not_written_title, R.string.tasks_backup_not_written_text)
        BackupStep.NoKeys -> words(R.string.tasks_backup_no_keys_title, R.string.tasks_backup_no_keys_text)
        BackupStep.Restored -> words(R.string.tasks_restored_title, R.string.tasks_restored_text)
        is BackupStep.Refused -> wordsOf(step.reason)
        BackupStep.NotRead -> words(R.string.tasks_not_read_title, R.string.tasks_not_read_text)
        BackupStep.NoRoom -> words(R.string.tasks_no_room_title, R.string.tasks_no_room_text)
        BackupStep.Unreadable -> words(R.string.tasks_unreadable_title, R.string.tasks_unreadable_text)
        // These four have dialogs of their own.
        BackupStep.Writing, BackupStep.Checking, BackupStep.Restoring, is BackupStep.Question -> "" to ""
    }
}

/** The words for a file Tasks does not take, as docs/user/backup.md names each answer. */
@Composable
private fun wordsOf(reason: BackupRefusal): Pair<String, String> = when (reason) {
    BackupRefusal.NotABackup -> words(R.string.tasks_refused_not_a_backup_title, R.string.tasks_refused_not_a_backup_text)
    BackupRefusal.NewerVersion -> words(R.string.tasks_refused_newer_title, R.string.tasks_refused_newer_text)
    is BackupRefusal.OtherApp -> stringResource(R.string.tasks_refused_other_app_title) to
        stringResource(R.string.tasks_refused_other_app_text, reason.name)
    is BackupRefusal.OtherRecoveryKey -> stringResource(R.string.tasks_refused_other_key_title) to
        stringResource(R.string.tasks_refused_other_key_text, reason.shortName)
    BackupRefusal.NoKeys -> words(R.string.tasks_refused_no_keys_title, R.string.tasks_refused_no_keys_text)
    BackupRefusal.Damaged -> words(R.string.tasks_refused_damaged_title, R.string.tasks_refused_damaged_text)
}

@Composable
private fun words(title: Int, text: Int): Pair<String, String> = stringResource(title) to stringResource(text)

/** [count] as the quantity of a plural. A backup never holds more tasks than fit. */
private fun quantityOf(count: Long): Int = count.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
