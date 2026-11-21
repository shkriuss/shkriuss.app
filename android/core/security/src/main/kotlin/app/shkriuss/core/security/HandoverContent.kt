package app.shkriuss.core.security

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkEmptyState
import app.shkriuss.core.design.ShkErrorState
import app.shkriuss.core.design.ShkFilledButton
import app.shkriuss.core.design.ShkLoadingState
import app.shkriuss.core.design.ShkStateAction
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTonalButton

/** What the user can do on a keeper's handover screen. */
class HandoverActions(
    val onAllow: () -> Unit = {},
    val onDeny: () -> Unit = {},
    val onAnswerChange: (index: Int, text: String) -> Unit = { _, _ -> },
    val onCheck: () -> Unit = {},
    val onClose: () -> Unit = {},
)

/**
 * A keeper's handover screen (ADR 0041, point 5): [asker] asks this app,
 * [keeper], for its own keys, or to check four words first. It names both
 * apps and the short name of the kept key, and says what the asker gets.
 */
@SecurityScreenSamples
@Composable
fun HandoverContent(
    screen: HandoverScreen,
    asker: String,
    keeper: String,
    previewBuild: Boolean,
    actions: HandoverActions,
    modifier: Modifier = Modifier,
) {
    FlowScaffold(stringResource(R.string.sec_handover_title, asker), actions.onDeny, previewBuild, modifier) {
        when (screen) {
            HandoverWorking, HandoverReady -> ShkLoadingState(stringResource(R.string.sec_handover_working))
            is HandoverAsk -> {
                if (screen.mode == HandoverMode.KEYS) {
                    Paragraph(stringResource(R.string.sec_handover_keys_ask, asker, keeper))
                    Paragraph(stringResource(R.string.sec_handover_keys_then, asker))
                } else {
                    Paragraph(stringResource(R.string.sec_handover_check_ask, asker, keeper))
                    Paragraph(stringResource(R.string.sec_handover_check_then, keeper, asker))
                }
                Paragraph(stringResource(R.string.sec_handover_short_name, screen.keyId))
                when (screen.note) {
                    KeepNote.CANCELLED -> Paragraph(stringResource(R.string.sec_handover_cancelled, asker))
                    KeepNote.FAILED -> Paragraph(stringResource(R.string.sec_prompt_failed), error = true)
                    null -> Unit
                }
                if (screen.prompt == null) {
                    Buttons {
                        ShkFilledButton(stringResource(R.string.sec_handover_allow), actions.onAllow)
                        ShkTonalButton(stringResource(R.string.sec_handover_deny), actions.onDeny)
                    }
                }
            }
            is HandoverFourWords -> {
                if (screen.mismatch) Paragraph(stringResource(R.string.sec_turn_on_mismatch), error = true)
                Paragraph(stringResource(R.string.sec_confirm_intro))
                ConfirmWordsFields(screen.positions, screen.answers, actions.onAnswerChange, actions.onCheck)
            }
            HandoverNotKept -> ShkErrorState(
                title = stringResource(R.string.sec_failed_title),
                body = stringResource(R.string.sec_handover_not_kept, keeper, asker),
                action = ShkStateAction(stringResource(R.string.sec_handover_close), actions.onClose),
            )
            is HandoverFailed -> ShkErrorState(
                title = stringResource(R.string.sec_failed_title),
                body = if (screen.damaged) {
                    stringResource(R.string.sec_handover_damaged, keeper)
                } else {
                    stringResource(R.string.sec_handover_failed)
                },
                action = ShkStateAction(stringResource(R.string.sec_handover_close), actions.onClose),
            )
        }
    }
}

/** What the user can do on the asking app's "Get the keys" screen. */
class GetKeysActions(
    val onDone: () -> Unit = {},
    /** Opens the app lock screen, after storing the keys turned the app lock off. */
    val onAppLock: () -> Unit = {},
)

/**
 * The asking app's "Get the keys" screen (ADR 0041, point 4): it waits
 * while [keeper] asks the user, then says how it went.
 */
@SecurityScreenSamples
@Composable
fun GetKeysContent(screen: GetKeysScreen, keeper: String, previewBuild: Boolean, actions: GetKeysActions, modifier: Modifier = Modifier) {
    FlowScaffold(stringResource(R.string.sec_get_keys_title), actions.onDone, previewBuild, modifier) {
        when (screen) {
            GetKeysWorking, GetKeysClosed -> ShkLoadingState(stringResource(R.string.sec_get_keys_waiting, keeper))
            is GetKeysDone -> {
                ShkEmptyState(
                    title = stringResource(R.string.sec_get_keys_done_title),
                    body = stringResource(R.string.sec_get_keys_done_text, screen.keyId, keeper),
                    action = ShkStateAction(stringResource(R.string.sec_done), actions.onDone),
                    announce = true,
                )
                if (screen.appLockOff) {
                    Paragraph(stringResource(R.string.sec_done_app_lock_off))
                    Buttons { ShkTonalButton(stringResource(R.string.sec_app_lock_button), actions.onAppLock) }
                }
            }
            is GetKeysFailed -> ShkErrorState(
                title = stringResource(R.string.sec_failed_title),
                body = problemText(screen, keeper),
                action = ShkStateAction(stringResource(R.string.sec_done), actions.onDone),
            )
        }
    }
}

@Composable
private fun problemText(failed: GetKeysFailed, keeper: String): String = when (failed.problem) {
    GetKeysProblem.NOT_KEEPER -> stringResource(R.string.sec_get_keys_not_keeper, keeper)
    GetKeysProblem.UPDATE -> stringResource(R.string.sec_get_keys_update, keeper)
    GetKeysProblem.UNREADABLE -> stringResource(R.string.sec_get_keys_unreadable, keeper)
    GetKeysProblem.NOT_A_SUITE_APP -> stringResource(R.string.sec_get_keys_not_suite, keeper)
    GetKeysProblem.OLDER_KEY -> stringResource(R.string.sec_get_keys_older, keeper)
    GetKeysProblem.DIFFERENT_KEY -> failed.keyId?.let { stringResource(R.string.sec_get_keys_different, keeper, it) }
        ?: stringResource(R.string.sec_get_keys_different_no_name, keeper)
    GetKeysProblem.KEY_ID_IN_USE -> stringResource(R.string.sec_get_keys_key_id_in_use)
    GetKeysProblem.NOT_NOW -> stringResource(R.string.sec_problem_not_now)
    GetKeysProblem.DAMAGED -> stringResource(R.string.sec_get_keys_damaged)
    GetKeysProblem.CANNOT_MAKE_KEY -> stringResource(R.string.sec_problem_cannot_make_key)
}

/** The text of the button that gets this app's keys from [keeper]. With [withKeyId], it also names the keeper's key. */
@Composable
internal fun getKeysButtonText(keeper: KeeperApp, withKeyId: Boolean): String =
    if (withKeyId) {
        stringResource(R.string.sec_get_keys_from_with_key, keeper.label, keeper.keyId)
    } else {
        stringResource(R.string.sec_get_keys_from, keeper.label)
    }

/** One button for each keeper, to get this app's keys from it. Keepers of different keys are told apart by their key's short name. */
@Composable
internal fun GetKeysButtons(keepers: List<KeeperApp>, onGetKeys: (KeeperApp) -> Unit) {
    val withKeyId = keepers.map { it.keyId }.distinct().size > 1
    Buttons {
        keepers.forEach { keeper -> ShkTonalButton(getKeysButtonText(keeper, withKeyId), { onGetKeys(keeper) }) }
    }
}

/** A title line in the style of the keeping step, for the question "keep it here too". */
@Composable
internal fun StepTitle(text: String) {
    ShkText(text = text, style = ShkTextStyle.Title)
}
