package app.shkriuss.catalog

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkDialog
import app.shkriuss.core.design.ShkDialogAction
import app.shkriuss.core.design.ShkDialogInPlace
import app.shkriuss.core.design.ShkInPlace
import app.shkriuss.core.design.ShkRadioButton
import app.shkriuss.core.design.ShkRadioGroup
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextField
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTonalButton

/**
 * The dialog with text and two buttons, with one button, with a choice,
 * with its confirm button turned off and with long text, each drawn in
 * place. Then one to try, which opens in its window. Only the button
 * under "Try it" does something when tapped.
 */
@OptIn(ShkInPlace::class)
@Composable
fun DialogsPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_dialogs_title))
        PageIntro(stringResource(R.string.dialogs_intro))

        ComponentHeading(stringResource(R.string.dialog_title), stringResource(R.string.dialog_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_two_actions) {
                    ShkDialogInPlace(
                        title = stringResource(R.string.sample_delete_note_question),
                        text = stringResource(R.string.sample_delete_note_text),
                        confirmAction = deleteAction(),
                        dismissAction = cancelAction(),
                    )
                },
                ComponentState(R.string.state_one_action) {
                    ShkDialogInPlace(
                        title = stringResource(R.string.sample_backup_unreadable),
                        text = stringResource(R.string.sample_backup_error_body),
                        confirmAction = ShkDialogAction(text = stringResource(R.string.sample_ok), onClick = {}),
                    )
                },
                ComponentState(R.string.state_with_choice) {
                    ShkDialogInPlace(
                        title = stringResource(R.string.sample_sort_by),
                        confirmAction = ShkDialogAction(text = stringResource(R.string.sample_sort), onClick = {}),
                        dismissAction = cancelAction(),
                    ) {
                        ShkRadioGroup {
                            ShkRadioButton(text = stringResource(R.string.sample_date_changed), selected = true, onClick = {})
                            ShkRadioButton(text = stringResource(R.string.sample_title), selected = false, onClick = {})
                        }
                    }
                },
                // The list has no name yet, so it cannot be renamed.
                ComponentState(R.string.state_confirm_disabled) {
                    ShkDialogInPlace(
                        title = stringResource(R.string.sample_rename_list),
                        confirmAction = ShkDialogAction(text = stringResource(R.string.sample_rename), onClick = {}, enabled = false),
                        dismissAction = cancelAction(),
                    ) {
                        ShkTextField(value = "", onValueChange = {}, label = stringResource(R.string.sample_name))
                    }
                },
                ComponentState(R.string.state_long_text) {
                    ShkDialogInPlace(
                        title = stringResource(R.string.sample_long_dialog_title),
                        text = stringResource(R.string.sample_long_dialog_text),
                        confirmAction = ShkDialogAction(
                            text = stringResource(R.string.sample_delete_all),
                            onClick = {},
                            destructive = true,
                        ),
                        dismissAction = ShkDialogAction(text = stringResource(R.string.sample_keep_notes), onClick = {}),
                    )
                },
                ComponentState(R.string.state_try_dialog) { DialogToTry() },
            ),
            wideColumns = 2,
            // Each panel keeps its own height, as in its window.
            equalHeights = false,
        )
    }
}

/** A button that opens the dialog, and a line that says how it was answered. */
@Composable
private fun DialogToTry() {
    var open by rememberSaveable { mutableStateOf(false) }
    var deleted by rememberSaveable { mutableStateOf(false) }
    var answer by rememberSaveable { mutableIntStateOf(R.string.sample_no_answer) }
    ShkTonalButton(
        text = stringResource(R.string.sample_delete_the_note),
        onClick = {
            deleted = false
            open = true
        },
    )
    Spacer(Modifier.height(ShkSpacing.Small))
    ShkText(text = stringResource(answer), color = ShkTheme.colors.textSecondary)
    if (open) {
        // A tap on Delete comes before the dialog closes.
        ShkDialog(
            title = stringResource(R.string.sample_delete_note_question),
            text = stringResource(R.string.sample_delete_note_text),
            confirmAction = ShkDialogAction(
                text = stringResource(R.string.sample_delete),
                onClick = { deleted = true },
                destructive = true,
            ),
            dismissAction = ShkDialogAction(text = stringResource(R.string.sample_cancel), onClick = {}),
            onDismissRequest = {
                open = false
                answer = if (deleted) R.string.sample_answer_deleted else R.string.sample_answer_closed
            },
        )
    }
}

/** A "Delete" button that does nothing. */
@Composable
private fun deleteAction() = ShkDialogAction(text = stringResource(R.string.sample_delete), onClick = {}, destructive = true)

/** A "Cancel" button that does nothing. */
@Composable
private fun cancelAction() = ShkDialogAction(text = stringResource(R.string.sample_cancel), onClick = {})
