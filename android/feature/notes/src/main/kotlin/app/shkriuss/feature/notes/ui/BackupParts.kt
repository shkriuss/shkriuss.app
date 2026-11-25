package app.shkriuss.feature.notes.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import app.shkriuss.feature.notes.BackupOpen
import app.shkriuss.feature.notes.BackupRefusal
import app.shkriuss.feature.notes.BackupScreen
import app.shkriuss.feature.notes.BackupStep
import app.shkriuss.feature.notes.BackupViewModel
import app.shkriuss.feature.notes.R
import app.shkriuss.feature.notes.RecoveryKeyLine
import app.shkriuss.feature.notes.isWorking

/**
 * The sections "Backup" and "Security" of Settings
 * (docs/apps/water/spec.md, "Settings screen", as
 * docs/apps/notes/spec.md, "As in Water and Tasks", says). Nothing of
 * them shows until the keys were read once, so no row says "Not set up"
 * for a moment in an app that has its recovery key.
 *
 * - **Make a backup**, **Restore a backup** and **App lock** need the
 *   recovery key. Each starts [firstNeed] with what it is for: with the
 *   key there, Notes goes on at once; without it, the dialog of ADR 0035
 *   shows first. The two backup rows stay enabled either way.
 * - **Recovery key** always opens the security screen of `core/security`.
 */
@Composable
internal fun ColumnScope.BackupAndSecuritySections(screen: BackupScreen, firstNeed: RecoveryKeyFirstNeedState) {
    if (!screen.loaded) return
    val context = LocalContext.current

    ShkSectionHeader(stringResource(R.string.notes_section_backup))
    // A note, not a button, and only while the app has no recovery key (Water's spec, "What Settings shows before it").
    val note = when (screen.recoveryKey) {
        RecoveryKeyLine.NOT_SET_UP -> R.string.notes_backup_note_no_key
        RecoveryKeyLine.UNFINISHED -> R.string.notes_backup_note_unfinished
        RecoveryKeyLine.SET_UP -> null
    }
    if (note != null) {
        ShkText(text = stringResource(note), color = ShkTheme.colors.textSecondary, modifier = Modifier.padding(bottom = ShkSpacing.Small))
    }
    ShkListItem(headline = stringResource(R.string.notes_make_backup), onClick = { firstNeed.start(RecoveryKeyNeed.BACKUP) })
    ShkListItem(headline = stringResource(R.string.notes_restore_backup), onClick = { firstNeed.start(RecoveryKeyNeed.RESTORE) })

    ShkSectionHeader(stringResource(R.string.notes_section_security))
    SettingItem(
        name = stringResource(R.string.notes_recovery_key),
        value = stringResource(
            when (screen.recoveryKey) {
                RecoveryKeyLine.NOT_SET_UP -> R.string.notes_recovery_key_not_set_up
                RecoveryKeyLine.UNFINISHED -> R.string.notes_recovery_key_unfinished
                RecoveryKeyLine.SET_UP -> R.string.notes_recovery_key_set_up
            },
        ),
        onClick = { context.startActivity(SecurityScreens.securityIntent(context)) },
    )
    SettingItem(
        name = stringResource(R.string.notes_app_lock),
        value = stringResource(if (screen.appLockOn) R.string.notes_app_lock_on else R.string.notes_app_lock_off),
        onClick = { firstNeed.start(RecoveryKeyNeed.APP_LOCK) },
    )
}

/** One setting: its [name], and its [value] under it. TalkBack reads both: "Recovery key, Not set up". */
@Composable
private fun SettingItem(name: String, value: String, onClick: () -> Unit) {
    val spoken = stringResource(R.string.notes_setting_spoken, name, value)
    ShkListItem(
        headline = name,
        supportingText = value,
        onClick = onClick,
        modifier = Modifier.semantics { contentDescription = spoken },
    )
}

/**
 * Everything of a backup and a restore that is not a row of Settings
 * (docs/apps/water/spec.md, "Backup and restore screens" and "The recovery
 * key when first needed", and docs/apps/notes/spec.md, "Writing"): the
 * first-need dialog of `core/security`, the two screens of Android's file
 * picker, and the dialogs. `NotesScreens` draws it once, inside the app
 * lock's gate, so it does not depend on the destination that shows.
 *
 * While a backup, its check or a restore runs, its dialog shows a
 * progress bar and the percent, or the circle while the total is not
 * known, and the screen stays on.
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

    // With the recovery key there, Notes goes on with what the user started, without another tap.
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

    if (screen.step?.isWorking == true) KeepScreenOn()
    BackupDialog(screen.step, model)
}

/** Keeps the screen on while it is drawn: a backup of many files takes a while (docs/apps/notes/spec.md, "Writing", point 4). */
@Composable
private fun KeepScreenOn() {
    val view = LocalView.current
    DisposableEffect(view) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }
}

/** The dialog of [step]: the progress while Notes works, the question before a restore, or how it ended. */
@Composable
private fun BackupDialog(step: BackupStep?, model: BackupViewModel) {
    when (step) {
        null -> Unit
        is BackupStep.Writing -> Progress(R.string.notes_backup_writing, step.percent)
        is BackupStep.Checking -> Progress(R.string.notes_backup_checking, step.percent)
        is BackupStep.Restoring -> Progress(R.string.notes_backup_restoring, step.percent)
        is BackupStep.Question -> RestoreQuestion(step, model)
        else -> {
            val (title, text) = wordsOf(step)
            ShkDialog(
                title = title,
                text = text,
                confirmAction = ShkDialogAction(text = stringResource(R.string.notes_ok), onClick = {}),
                onDismissRequest = model::close,
            )
        }
    }
}

/** A dialog with no button: the words, and a bar at [percent] with the percent under it, or the circle while it is null. */
@Composable
private fun Progress(words: Int, percent: Int?) {
    ShkProgressDialog(stringResource(words), fraction = percent?.let { it / PERCENT })
}

/**
 * "Restore this backup?", with when the backup was made and how many
 * notes and files it holds. **Restore** restores it; **Cancel** changes
 * nothing.
 */
@Composable
private fun RestoreQuestion(question: BackupStep.Question, model: BackupViewModel) {
    val format = rememberNotesFormat()
    ShkDialog(
        title = stringResource(R.string.notes_restore_question_title),
        text = stringResource(
            R.string.notes_restore_question_text,
            format.madeAt(question.madeAt),
            notesText(question.notes, format),
            filesText(question.files, format),
        ),
        // The dialog stays until the ViewModel shows the next one: "Restoring the backup".
        confirmAction = ShkDialogAction(text = stringResource(R.string.notes_restore), onClick = model::restore, closesDialog = false),
        dismissAction = ShkDialogAction(text = stringResource(R.string.notes_cancel), onClick = {}),
        onDismissRequest = model::close,
    )
}

/** The title and the text of the dialog that says how a backup or a restore ended. */
@Composable
private fun wordsOf(step: BackupStep): Pair<String, String> {
    val format = rememberNotesFormat()
    return when (step) {
        is BackupStep.Written -> stringResource(R.string.notes_backup_written_title) to withLeftOut(
            stringResource(R.string.notes_backup_written_text, notesText(step.notes, format), filesText(step.files, format)),
            step.leftOut,
            format,
        )
        BackupStep.WrittenNotUsable -> words(R.string.notes_backup_not_usable_title, R.string.notes_backup_not_usable_text)
        is BackupStep.WrittenNotChecked -> stringResource(R.string.notes_backup_not_checked_title) to
            withLeftOut(stringResource(R.string.notes_backup_not_checked_text), step.leftOut, format)
        BackupStep.NotWritten -> words(R.string.notes_backup_not_written_title, R.string.notes_backup_not_written_text)
        BackupStep.NotWiped -> words(R.string.notes_backup_not_written_title, R.string.notes_backup_not_wiped_text)
        BackupStep.NoKeys -> words(R.string.notes_backup_no_keys_title, R.string.notes_backup_no_keys_text)
        BackupStep.FilesStillMoving -> words(R.string.notes_backup_no_keys_title, R.string.notes_backup_files_moving_text)
        BackupStep.Restored -> words(R.string.notes_restored_title, R.string.notes_restored_text)
        is BackupStep.Refused -> wordsOf(step.reason)
        BackupStep.NotRead -> words(R.string.notes_not_read_title, R.string.notes_not_read_text)
        BackupStep.NoRoom -> words(R.string.notes_no_room_title, R.string.notes_no_room_text)
        BackupStep.Unreadable -> words(R.string.notes_unreadable_title, R.string.notes_unreadable_text)
        // These four have dialogs of their own.
        is BackupStep.Writing, is BackupStep.Checking, is BackupStep.Restoring, is BackupStep.Question -> "" to ""
    }
}

/** [text], and after it, when [leftOut] is above 0, how many files are not in the backup. */
@Composable
private fun withLeftOut(text: String, leftOut: Long, format: NotesFormat): String {
    if (leftOut <= 0) return text
    val notIn = pluralStringResource(R.plurals.notes_backup_left_out, quantityOf(leftOut), format.count(leftOut))
    return stringResource(R.string.notes_two_sentences, text, notIn)
}

/** "42 notes". */
@Composable
private fun notesText(notes: Long, format: NotesFormat): String =
    pluralStringResource(R.plurals.notes_note_count, quantityOf(notes), format.count(notes))

/** "12 files". */
@Composable
private fun filesText(files: Long, format: NotesFormat): String =
    pluralStringResource(R.plurals.notes_file_count, quantityOf(files), format.count(files))

/** The words for a file Notes does not take, as docs/user/backup.md names each answer. */
@Composable
private fun wordsOf(reason: BackupRefusal): Pair<String, String> = when (reason) {
    BackupRefusal.NotABackup -> words(R.string.notes_refused_not_a_backup_title, R.string.notes_refused_not_a_backup_text)
    BackupRefusal.NewerVersion -> words(R.string.notes_refused_newer_title, R.string.notes_refused_newer_text)
    is BackupRefusal.OtherApp -> stringResource(R.string.notes_refused_other_app_title) to
        stringResource(R.string.notes_refused_other_app_text, reason.name)
    is BackupRefusal.OtherRecoveryKey -> stringResource(R.string.notes_refused_other_key_title) to
        stringResource(R.string.notes_refused_other_key_text, reason.shortName)
    BackupRefusal.NoKeys -> words(R.string.notes_refused_no_keys_title, R.string.notes_refused_no_keys_text)
    BackupRefusal.Damaged -> words(R.string.notes_refused_damaged_title, R.string.notes_refused_damaged_text)
}

@Composable
private fun words(title: Int, text: Int): Pair<String, String> = stringResource(title) to stringResource(text)

/** [count] as the quantity of a plural. A backup never holds more notes or files than fit. */
private fun quantityOf(count: Long): Int = count.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()

private const val PERCENT = 100f
