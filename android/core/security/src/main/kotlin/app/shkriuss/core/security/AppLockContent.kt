package app.shkriuss.core.security

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.crypto.AppLockState
import app.shkriuss.core.design.ShkCard
import app.shkriuss.core.design.ShkDialog
import app.shkriuss.core.design.ShkDialogAction
import app.shkriuss.core.design.ShkDialogInPlace
import app.shkriuss.core.design.ShkEmptyState
import app.shkriuss.core.design.ShkErrorState
import app.shkriuss.core.design.ShkFilledButton
import app.shkriuss.core.design.ShkInPlace
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkLoadingState
import app.shkriuss.core.design.ShkRadioButton
import app.shkriuss.core.design.ShkRadioGroup
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkStateAction
import app.shkriuss.core.design.ShkSwitch
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTonalButton
import app.shkriuss.core.design.ShkTopBar

/** What the user can do on the lock screen. */
class LockActions(
    val onUnlock: () -> Unit = {},
    val onRepair: () -> Unit = {},
)

/** What the user can do on the app lock screen. */
class AppLockActions(
    val onBack: () -> Unit = {},
    val onTurnOn: () -> Unit = {},
    val onTurnOff: () -> Unit = {},
    val onLockAfter: (LockAfter) -> Unit = {},
    val onBlockScreenshots: (Boolean) -> Unit = {},
    val onNotificationText: (Boolean) -> Unit = {},
    val onSecurity: () -> Unit = {},
    val onEnterWords: () -> Unit = {},
    val onRetry: () -> Unit = {},
)

/** What the user can do while turning the app lock on. */
class TurnOnActions(
    val onBack: () -> Unit = {},
    val onContinue: () -> Unit = {},
    val onRead: () -> Unit = {},
    val onAnswerChange: (index: Int, text: String) -> Unit = { _, _ -> },
    val onCheckFour: () -> Unit = {},
    val words: EnterActions = EnterActions(),
    val onLockAgain: () -> Unit = {},
    val onDone: () -> Unit = {},
)

/** The dialogs of the app lock. */
enum class AppLockDialog {
    /** When the app locks after it left the screen. */
    LOCK_AFTER,

    /** Asks before the app lock is turned off. */
    TURN_OFF,

    /** The notice [AppLockNotice.RESET]. */
    RESET_NOTICE,

    /** The notice [AppLockNotice.TURNED_OFF]. */
    TURNED_OFF_NOTICE,
}

/**
 * The lock screen that [AppLockGate] shows instead of a screen of the app
 * while the app is locked. [appName] is the app's name. Nothing of the
 * app shows here.
 */
@SecurityScreenSamples
@Composable
fun LockContent(screen: LockScreen, appName: String, actions: LockActions, modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true, topBar = { ShkTopBar(title = stringResource(R.string.sec_lock_title, appName)) }) {
        Column(verticalArrangement = Arrangement.spacedBy(ShkSpacing.Medium)) {
            Paragraph(stringResource(R.string.sec_lock_text))
            when (screen.note) {
                LockNote.FAILED -> Paragraph(stringResource(R.string.sec_prompt_failed), error = true)
                LockNote.NOT_NOW -> Paragraph(stringResource(R.string.sec_lock_not_now), error = true)
                LockNote.DAMAGED -> Paragraph(stringResource(R.string.sec_lock_damaged), error = true)
                null -> Unit
            }
            Buttons {
                if (screen.note == LockNote.DAMAGED) {
                    ShkFilledButton(stringResource(R.string.sec_repair_button), actions.onRepair)
                } else {
                    ShkFilledButton(
                        text = stringResource(R.string.sec_lock_unlock),
                        onClick = actions.onUnlock,
                        enabled = screen.prompt == null && !screen.working,
                    )
                }
            }
        }
    }
}

/**
 * The app lock screen: whether the app lock is on, why it cannot be
 * turned on, when it locks, the text of notifications, and the
 * screenshot block. While the app lock is on, it shows nothing before the
 * system prompt.
 */
@SecurityScreenSamples
@Composable
fun AppLockContent(screen: AppLockScreen, previewBuild: Boolean, actions: AppLockActions, modifier: Modifier = Modifier) {
    FlowScaffold(stringResource(R.string.sec_app_lock_title), actions.onBack, previewBuild, modifier) {
        when (screen) {
            AppLockLoading, AppLockClosed -> ShkLoadingState(stringResource(R.string.sec_loading))
            is AppLockAsking -> Paragraph(stringResource(R.string.sec_app_lock_asking))
            AppLockDamaged -> {
                Paragraph(stringResource(R.string.sec_lock_damaged), error = true)
                Buttons { ShkFilledButton(stringResource(R.string.sec_repair_button), actions.onEnterWords) }
            }
            AppLockFailed -> ShkErrorState(
                title = stringResource(R.string.sec_failed_title),
                body = stringResource(R.string.sec_failed),
                action = ShkStateAction(stringResource(R.string.sec_try_again), actions.onRetry),
            )
            is AppLockSettingsScreen -> AppLockSettings(screen, actions)
        }
    }
}

@Composable
private fun AppLockSettings(screen: AppLockSettingsScreen, actions: AppLockActions) {
    var dialog by rememberSaveable { mutableStateOf<AppLockDialog?>(null) }
    when (screen.state) {
        AppLockState.ON -> {
            Paragraph(stringResource(R.string.sec_app_lock_on))
            if (screen.turnOffFailed) Paragraph(stringResource(R.string.sec_turn_off_failed), error = true)
            Buttons { ShkTonalButton(stringResource(R.string.sec_turn_off), { dialog = AppLockDialog.TURN_OFF }) }
        }
        AppLockState.RESET -> {
            Paragraph(stringResource(R.string.sec_app_lock_reset))
            Buttons { ShkFilledButton(stringResource(R.string.sec_show_enter), actions.onEnterWords) }
        }
        AppLockState.OFF -> {
            Paragraph(stringResource(R.string.sec_app_lock_off))
            when (screen.cannotTurnOn) {
                null -> Buttons { ShkFilledButton(stringResource(R.string.sec_turn_on), actions.onTurnOn) }
                CannotTurnOn.NO_RECOVERY_KEY, CannotTurnOn.SETUP_UNFINISHED -> {
                    Paragraph(stringResource(cannotTurnOnText(screen.cannotTurnOn)))
                    Buttons { ShkTonalButton(stringResource(R.string.sec_security_title), actions.onSecurity) }
                }
                else -> Paragraph(stringResource(cannotTurnOnText(screen.cannotTurnOn)))
            }
        }
    }
    Paragraph(stringResource(R.string.sec_app_lock_protects))
    if (screen.state == AppLockState.ON) {
        ShkSectionHeader(stringResource(R.string.sec_section_lock_after))
        ShkCard {
            ShkListItem(
                headline = stringResource(R.string.sec_lock_after_label),
                supportingText = lockAfterText(screen.lockAfter),
                onClick = { dialog = AppLockDialog.LOCK_AFTER },
            )
        }
        Paragraph(stringResource(R.string.sec_lock_after_screen_off))
        ShkSectionHeader(stringResource(R.string.sec_section_notifications))
        ShkSwitch(
            text = stringResource(R.string.sec_notification_text_switch),
            checked = screen.notificationText,
            onCheckedChange = actions.onNotificationText,
        )
        Paragraph(stringResource(R.string.sec_notification_text_help))
    }
    ShkSectionHeader(stringResource(R.string.sec_section_screenshots))
    ShkSwitch(
        text = stringResource(R.string.sec_block_switch),
        checked = screen.blockScreenshots,
        onCheckedChange = actions.onBlockScreenshots,
    )
    Paragraph(stringResource(R.string.sec_block_help))
    dialog?.let { open ->
        AppLockDialogView(
            dialog = open,
            inPlace = false,
            lockAfter = screen.lockAfter,
            onLockAfter = actions.onLockAfter,
            onConfirm = { if (open == AppLockDialog.TURN_OFF) actions.onTurnOff() },
            onDismiss = { dialog = null },
        )
    }
}

private fun cannotTurnOnText(reason: CannotTurnOn): Int = when (reason) {
    CannotTurnOn.NO_SCREEN_LOCK -> R.string.sec_cannot_no_screen_lock
    CannotTurnOn.NO_RECOVERY_KEY -> R.string.sec_cannot_no_key
    CannotTurnOn.SETUP_UNFINISHED -> R.string.sec_cannot_unfinished
    CannotTurnOn.FILE_KEYS_MOVING -> R.string.sec_cannot_moving
    CannotTurnOn.NOT_NOW -> R.string.sec_cannot_not_now
}

/** The words for one choice of [LockAfter], with plurals for the minutes and the hour. */
@Composable
internal fun lockAfterText(choice: LockAfter): String {
    val minutes = (choice.millis / MINUTE).toInt()
    return when {
        choice == LockAfter.LEAVING -> stringResource(R.string.sec_lock_after_leaving)
        minutes % MINUTES_PER_HOUR == 0 -> {
            val hours = minutes / MINUTES_PER_HOUR
            pluralStringResource(R.plurals.sec_lock_after_hours, hours, hours)
        }
        else -> pluralStringResource(R.plurals.sec_lock_after_minutes, minutes, minutes)
    }
}

private const val MINUTE = 60_000L
private const val MINUTES_PER_HOUR = 60

/**
 * Turning the app lock on ("Turning it on" in crypto-design.md), one
 * screen of it: the plain warning, the check of the words, the prompt.
 */
@SecurityScreenSamples
@Composable
fun TurnOnContent(screen: TurnOnScreen, previewBuild: Boolean, actions: TurnOnActions, modifier: Modifier = Modifier) {
    FlowScaffold(stringResource(R.string.sec_turn_on_title), actions.onBack, previewBuild, modifier) {
        when (screen) {
            TurnOnWorking -> ShkLoadingState(stringResource(R.string.sec_loading))
            is TurnOnIntro -> {
                Paragraph(stringResource(R.string.sec_turn_on_what))
                Paragraph(stringResource(R.string.sec_turn_on_files))
                ShkCard {
                    ShkText(text = stringResource(R.string.sec_turn_on_warning), style = ShkTextStyle.Subtitle)
                }
                Paragraph(stringResource(if (screen.keeper) R.string.sec_turn_on_keeper else R.string.sec_turn_on_not_keeper))
                Buttons { ShkFilledButton(stringResource(R.string.sec_turn_on_continue), actions.onContinue) }
            }
            is TurnOnReading -> {
                Paragraph(stringResource(R.string.sec_turn_on_reading))
                PromptNote(screen.note)
                if (screen.prompt == null) Buttons { ShkFilledButton(stringResource(R.string.sec_turn_on_read), actions.onRead) }
            }
            is TurnOnFourWords -> {
                Paragraph(stringResource(R.string.sec_confirm_intro))
                if (screen.mismatch) Paragraph(stringResource(R.string.sec_turn_on_mismatch), error = true)
                ConfirmWordsFields(screen.positions, screen.answers, actions.onAnswerChange, actions.onCheckFour)
            }
            is TurnOnAllWords -> {
                if (screen.keptUnreadable) Paragraph(stringResource(R.string.sec_turn_on_kept_unreadable))
                if (screen.notThisApp) Paragraph(stringResource(R.string.sec_turn_on_not_this_app), error = true)
                EnterWordsContent(screen.entry, actions.words)
            }
            is TurnOnLocking -> {
                Paragraph(stringResource(R.string.sec_turn_on_locking))
                PromptNote(screen.note)
                if (screen.prompt == null) Buttons { ShkFilledButton(stringResource(R.string.sec_turn_on), actions.onLockAgain) }
            }
            TurnOnDone -> ShkEmptyState(
                title = stringResource(R.string.sec_turn_on_done_title),
                body = stringResource(R.string.sec_turn_on_done_text),
                action = ShkStateAction(stringResource(R.string.sec_done), actions.onDone),
                announce = true,
            )
            is TurnOnFailed -> ShkErrorState(
                title = stringResource(R.string.sec_failed_title),
                body = stringResource(
                    when (screen.problem) {
                        TurnOnProblem.NOT_ALLOWED -> R.string.sec_turn_on_not_allowed
                        TurnOnProblem.NOT_NOW -> R.string.sec_problem_not_now
                        TurnOnProblem.DAMAGED -> R.string.sec_turn_on_damaged
                        TurnOnProblem.CANNOT_MAKE_KEY -> R.string.sec_problem_cannot_make_key
                    },
                ),
                action = ShkStateAction(stringResource(R.string.sec_done), actions.onDone),
            )
        }
    }
}

/** What a closed or failed prompt of the turn-on flow left. */
@Composable
private fun PromptNote(note: KeepNote?) {
    when (note) {
        KeepNote.CANCELLED -> Paragraph(stringResource(R.string.sec_turn_on_cancelled))
        KeepNote.FAILED -> Paragraph(stringResource(R.string.sec_prompt_failed), error = true)
        null -> Unit
    }
}

/**
 * One of the dialogs of the app lock, drawn in place for the Catalog's
 * samples. In an app they are real dialogs over their screen.
 */
@SecurityScreenSamples
@Composable
fun AppLockDialogSample(dialog: AppLockDialog, modifier: Modifier = Modifier, lockAfter: LockAfter = LockAfter.LEAVING) {
    AppLockDialogView(dialog, inPlace = true, lockAfter = lockAfter, onLockAfter = {}, onConfirm = {}, onDismiss = {}, modifier = modifier)
}

/**
 * A dialog of the app lock. [onConfirm] is the main action. After any
 * action, and after a tap outside or Back, the dialog calls [onDismiss].
 * [inPlace] draws it without its window, for the Catalog.
 */
@OptIn(ShkInPlace::class)
@Composable
internal fun AppLockDialogView(
    dialog: AppLockDialog,
    inPlace: Boolean,
    lockAfter: LockAfter,
    onLockAfter: (LockAfter) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val title: String
    val text: String?
    val confirm: ShkDialogAction
    var dismiss: ShkDialogAction? = null
    var content: (@Composable ColumnScope.() -> Unit)? = null
    when (dialog) {
        AppLockDialog.LOCK_AFTER -> {
            title = stringResource(R.string.sec_lock_after_label)
            text = null
            confirm = ShkDialogAction(stringResource(R.string.sec_done), {})
            content = {
                ShkRadioGroup {
                    LockAfter.entries.forEach { choice ->
                        ShkRadioButton(text = lockAfterText(choice), selected = choice == lockAfter, onClick = { onLockAfter(choice) })
                    }
                }
            }
        }
        AppLockDialog.TURN_OFF -> {
            title = stringResource(R.string.sec_turn_off_title)
            text = stringResource(R.string.sec_turn_off_text)
            confirm = ShkDialogAction(stringResource(R.string.sec_turn_off_confirm), onConfirm, destructive = true)
            dismiss = ShkDialogAction(stringResource(R.string.sec_cancel), {})
        }
        AppLockDialog.RESET_NOTICE -> {
            title = stringResource(R.string.sec_notice_reset_title)
            text = stringResource(R.string.sec_notice_reset_text)
            confirm = ShkDialogAction(stringResource(R.string.sec_show_enter), onConfirm)
            dismiss = ShkDialogAction(stringResource(R.string.sec_later), {})
        }
        AppLockDialog.TURNED_OFF_NOTICE -> {
            title = stringResource(R.string.sec_notice_off_title)
            text = stringResource(R.string.sec_notice_off_text)
            confirm = ShkDialogAction(stringResource(R.string.sec_app_lock_button), onConfirm)
            dismiss = ShkDialogAction(stringResource(R.string.sec_ok), {})
        }
    }
    if (inPlace) {
        ShkDialogInPlace(title = title, confirmAction = confirm, modifier = modifier, text = text, dismissAction = dismiss, content = content)
    } else {
        ShkDialog(
            title = title,
            confirmAction = confirm,
            onDismissRequest = onDismiss,
            modifier = modifier,
            text = text,
            dismissAction = dismiss,
            content = content,
        )
    }
}
