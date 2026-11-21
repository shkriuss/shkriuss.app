package app.shkriuss.core.security

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import app.shkriuss.core.design.ShkEmptyState
import app.shkriuss.core.design.ShkErrorState
import app.shkriuss.core.design.ShkFilledButton
import app.shkriuss.core.design.ShkLoadingState
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkStateAction
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTextButton
import app.shkriuss.core.design.ShkTonalButton
import app.shkriuss.core.design.ShkWindowWidth

/** What the user can do while keeping the key and at the end of a flow. */
class FlowStepActions(
    val onKeep: () -> Unit = {},
    val onSkipKeeping: () -> Unit = {},
    val onDone: () -> Unit = {},
    /** Opens the app lock screen, after storing the keys turned the app lock off. */
    val onAppLock: () -> Unit = {},
)

/** What the user can do while creating a recovery key. */
class CreateActions(
    val onBack: () -> Unit = {},
    val onShowWords: () -> Unit = {},
    val onWordsWritten: () -> Unit = {},
    val onAnswerChange: (index: Int, text: String) -> Unit = { _, _ -> },
    val onCheck: () -> Unit = {},
    val step: FlowStepActions = FlowStepActions(),
)

/** What the user can do while entering the words. */
class EnterActions(
    val onBack: () -> Unit = {},
    val onTyped: (String) -> Unit = {},
    val onWord: (String) -> Unit = {},
    val onEditWord: (index: Int) -> Unit = {},
    val onCheck: () -> Unit = {},
    val onStartOverWithThese: () -> Unit = {},
    val onEnterOther: () -> Unit = {},
    val step: FlowStepActions = FlowStepActions(),
)

/** What the user can do while the kept key is shown again. */
class ShowActions(
    val onBack: () -> Unit = {},
    val onShow: () -> Unit = {},
    val onEnterWords: () -> Unit = {},
)

/** Creating a recovery key ("Creating it" in crypto-design.md), one screen of it. */
@SecurityScreenSamples
@Composable
fun CreateContent(screen: CreateScreen, previewBuild: Boolean, actions: CreateActions, modifier: Modifier = Modifier) {
    FlowScaffold(stringResource(R.string.sec_create_title), actions.onBack, previewBuild, modifier) {
        when (screen) {
            CreateIntro -> {
                Paragraph(stringResource(R.string.sec_create_intro_what))
                Paragraph(stringResource(R.string.sec_create_intro_paper))
                Paragraph(stringResource(R.string.sec_create_intro_wallet))
                Paragraph(stringResource(R.string.sec_create_intro_screen))
                Buttons { ShkFilledButton(stringResource(R.string.sec_show_words), actions.onShowWords) }
            }
            is CreateWords -> {
                if (screen.mismatch) Paragraph(stringResource(R.string.sec_words_mismatch), error = true)
                Paragraph(stringResource(R.string.sec_words_intro))
                WordsGrid(screen.words)
                Buttons { ShkFilledButton(stringResource(R.string.sec_words_written), actions.onWordsWritten) }
            }
            is CreateConfirm -> {
                Paragraph(stringResource(R.string.sec_confirm_intro))
                ConfirmWordsFields(screen.positions, screen.answers, actions.onAnswerChange, actions.onCheck)
            }
            is FlowStep -> FlowStepContent(screen, actions.step)
        }
    }
}

/** Entering the 24 words of a recovery key ("Entering it" in crypto-design.md), one screen of it. */
@SecurityScreenSamples
@Composable
fun EnterContent(screen: EnterScreen, previewBuild: Boolean, actions: EnterActions, modifier: Modifier = Modifier) {
    FlowScaffold(stringResource(R.string.sec_enter_title), actions.onBack, previewBuild, modifier) {
        when (screen) {
            is EnterWords -> EnterWordsContent(screen, actions)
            EnterOlderKey -> ShkErrorState(
                title = stringResource(R.string.sec_failed_title),
                body = stringResource(R.string.sec_enter_older),
                action = ShkStateAction(stringResource(R.string.sec_enter_other), actions.onEnterOther),
            )
            is EnterDifferentKey -> ShkErrorState(
                title = stringResource(R.string.sec_failed_title),
                body = screen.keyId?.let { stringResource(R.string.sec_enter_different, it) }
                    ?: stringResource(R.string.sec_enter_different_no_name),
                action = ShkStateAction(stringResource(R.string.sec_enter_other), actions.onEnterOther),
            )
            EnterStartOverOffer -> {
                Paragraph(stringResource(R.string.sec_enter_start_over_offer))
                Buttons {
                    ShkFilledButton(stringResource(R.string.sec_enter_start_over), actions.onStartOverWithThese)
                    ShkTonalButton(stringResource(R.string.sec_enter_other), actions.onEnterOther)
                }
            }
            is FlowStep -> FlowStepContent(screen, actions.step)
        }
    }
}

/**
 * The fields for four of the words, at [positions], and the button that
 * checks them. Creating a key and turning the app lock on use them.
 */
@Composable
internal fun ConfirmWordsFields(
    positions: List<Int>,
    answers: List<String>,
    onAnswerChange: (index: Int, text: String) -> Unit,
    onCheck: () -> Unit,
) {
    positions.forEachIndexed { index, position ->
        WordField(
            value = answers[index],
            onValueChange = { onAnswerChange(index, it) },
            onWord = { onAnswerChange(index, it) },
            label = stringResource(R.string.sec_confirm_label, position),
            imeAction = if (index == positions.lastIndex) ImeAction.Done else ImeAction.Next,
        )
    }
    Buttons {
        ShkFilledButton(text = stringResource(R.string.sec_check), onClick = onCheck, enabled = answers.none { it.isEmpty() })
    }
}

/**
 * The screen that takes all 24 words, one at a time. Entering a recovery
 * key and turning the app lock on in an app that does not keep the key
 * use it.
 */
@Composable
internal fun EnterWordsContent(screen: EnterWords, actions: EnterActions) {
    Paragraph(stringResource(R.string.sec_enter_intro))
    Paragraph(stringResource(R.string.sec_enter_no_paste))
    WordField(
        value = screen.typed,
        onValueChange = actions.onTyped,
        onWord = actions.onWord,
        label = stringResource(R.string.sec_enter_label, screen.current + 1),
        errorText = screen.notInList?.let { stringResource(R.string.sec_enter_not_in_list, it) },
    )
    if (screen.doNotBelong) Paragraph(stringResource(R.string.sec_enter_do_not_belong), error = true)
    // Only the words entered so far and the current one. "Word n of 24" shows how far along it is.
    val shown = screen.words.indices.filter { screen.words[it].isNotEmpty() || it == screen.current }
    val columns = if (ShkWindowWidth.current == ShkWindowWidth.Compact) 2 else 4
    Column(verticalArrangement = Arrangement.spacedBy(ShkSpacing.ExtraSmall)) {
        shown.chunked(columns).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Small)) {
                row.forEach { index ->
                    val word = screen.words[index]
                    val text = if (word.isEmpty()) {
                        stringResource(R.string.sec_enter_slot_empty, index + 1)
                    } else {
                        stringResource(R.string.sec_word_numbered, index + 1, word)
                    }
                    val slot = Modifier.weight(1f)
                    if (index == screen.current) {
                        ShkTonalButton(text = text, onClick = { actions.onEditWord(index) }, modifier = slot)
                    } else {
                        ShkTextButton(text = text, onClick = { actions.onEditWord(index) }, modifier = slot)
                    }
                }
                // A short last row keeps the width of its buttons.
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
    Buttons {
        ShkFilledButton(stringResource(R.string.sec_enter_check), actions.onCheck, enabled = screen.complete)
    }
}

/** Showing the kept recovery key again ("Showing it again" in crypto-design.md), one screen of it. */
@SecurityScreenSamples
@Composable
fun ShowContent(screen: ShowScreen, previewBuild: Boolean, actions: ShowActions, modifier: Modifier = Modifier) {
    FlowScaffold(stringResource(R.string.sec_show_title), actions.onBack, previewBuild, modifier) {
        when (screen) {
            is ShowIntro -> {
                if (screen.note == KeepNote.FAILED) Paragraph(stringResource(R.string.sec_prompt_failed), error = true)
                Paragraph(stringResource(R.string.sec_show_intro))
                Buttons {
                    ShkFilledButton(stringResource(R.string.sec_show_words), actions.onShow, enabled = screen.prompt == null)
                }
            }
            is ShowWords -> {
                Paragraph(stringResource(R.string.sec_show_words_intro))
                WordsGrid(screen.words)
                Buttons { ShkFilledButton(stringResource(R.string.sec_done), actions.onBack) }
            }
            ShowNotKept -> ShkErrorState(
                title = stringResource(R.string.sec_failed_title),
                body = stringResource(R.string.sec_show_not_kept),
                action = ShkStateAction(stringResource(R.string.sec_show_enter), actions.onEnterWords),
            )
            ShowDamaged -> ShkErrorState(
                title = stringResource(R.string.sec_failed_title),
                body = stringResource(R.string.sec_show_damaged),
                action = ShkStateAction(stringResource(R.string.sec_show_enter), actions.onEnterWords),
            )
        }
    }
}

/** Storing, keeping, done or a failure: the end of the create and the enter flow. */
@Composable
private fun FlowStepContent(step: FlowStep, actions: FlowStepActions) {
    when (step) {
        FlowWorking -> ShkLoadingState(stringResource(R.string.sec_working))
        is FlowKeeping -> {
            ShkText(text = stringResource(R.string.sec_keep_title), style = ShkTextStyle.Title)
            Paragraph(stringResource(R.string.sec_keep_text))
            when (step.note) {
                KeepNote.CANCELLED -> Paragraph(stringResource(R.string.sec_keep_cancelled))
                KeepNote.FAILED -> Paragraph(stringResource(R.string.sec_keep_failed), error = true)
                null -> Unit
            }
            if (step.prompt == null) {
                Buttons {
                    ShkFilledButton(stringResource(R.string.sec_keep_button), actions.onKeep)
                    ShkTonalButton(stringResource(R.string.sec_keep_skip), actions.onSkipKeeping)
                }
            }
        }
        is FlowDone -> {
            ShkEmptyState(
                title = stringResource(R.string.sec_done_title),
                body = stringResource(
                    when (step.kept) {
                        Kept.KEPT -> R.string.sec_done_kept
                        Kept.NOT_KEPT -> R.string.sec_done_not_kept
                        Kept.NO_SCREEN_LOCK -> R.string.sec_done_no_lock
                    },
                ),
                action = ShkStateAction(stringResource(R.string.sec_done), actions.onDone),
                announce = true,
            )
            if (step.appLockOff) {
                Paragraph(stringResource(R.string.sec_done_app_lock_off))
                Buttons { ShkTonalButton(stringResource(R.string.sec_app_lock_button), actions.onAppLock) }
            }
        }
        is FlowFailed -> ShkErrorState(
            title = stringResource(R.string.sec_failed_title),
            body = stringResource(
                when (step.problem) {
                    SecurityProblem.NOT_NOW -> R.string.sec_problem_not_now
                    SecurityProblem.DAMAGED -> R.string.sec_problem_damaged
                    SecurityProblem.CANNOT_MAKE_KEY -> R.string.sec_problem_cannot_make_key
                    SecurityProblem.KEY_ID_IN_USE -> R.string.sec_problem_key_id_in_use
                    SecurityProblem.FILE_KEYS_DAMAGED -> R.string.sec_problem_file_keys_damaged
                    SecurityProblem.SETUP_UNFINISHED -> R.string.sec_problem_setup_unfinished
                    SecurityProblem.ALREADY_SET_UP -> R.string.sec_problem_already_set_up
                },
            ),
            action = ShkStateAction(stringResource(R.string.sec_done), actions.onDone),
        )
    }
}
