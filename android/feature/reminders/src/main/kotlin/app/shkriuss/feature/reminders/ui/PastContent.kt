package app.shkriuss.feature.reminders.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkDialog
import app.shkriuss.core.design.ShkDialogAction
import app.shkriuss.core.design.ShkEmptyState
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSnackbarHostState
import app.shkriuss.core.design.ShkSnackbarResult
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.ShkTopBarAction
import app.shkriuss.core.design.ShkWindowWidth
import app.shkriuss.core.design.rememberShkSnackbarHostState
import app.shkriuss.feature.reminders.DeleteAllQuestion
import app.shkriuss.feature.reminders.PastRow
import app.shkriuss.feature.reminders.PastScreen
import app.shkriuss.feature.reminders.PastViewModel
import app.shkriuss.feature.reminders.R
import app.shkriuss.feature.reminders.ReminderFormViewModel
import java.time.LocalDate

/**
 * Past (docs/apps/reminders/spec.md, "Past"): one row per past reminder,
 * newest first, **Delete all** in the top bar while the list is not
 * empty, and the [form] that a row opens ([ListAndForm]).
 */
@Composable
internal fun PastContent(
    model: PastViewModel,
    form: ReminderFormViewModel,
    windowWidth: ShkWindowWidth = ShkWindowWidth.current,
) {
    val screen by model.state.collectAsState()
    val formScreen by form.state.collectAsState()
    val format = rememberRemindersFormat()
    val snackbars = rememberShkSnackbarHostState()
    PastSnackbars(screen, model, snackbars, format)
    ListAndForm(form, screen.today, snackbars, format, windowWidth) {
        val deleteAll = stringResource(R.string.reminders_delete_all)
        ShkScreen(
            topBar = {
                ShkTopBar(
                    title = stringResource(R.string.reminders_past),
                    actions = if (screen.canDeleteAll) {
                        listOf(ShkTopBarAction(painterResource(R.drawable.reminders_icon_delete_all), deleteAll, model::askDeleteAll))
                    } else {
                        emptyList()
                    },
                )
            },
            snackbarHostState = snackbars,
        ) {
            if (!screen.loaded) return@ShkScreen
            if (screen.isEmpty) {
                ShkEmptyState(
                    title = stringResource(R.string.reminders_past_empty_title),
                    body = stringResource(R.string.reminders_past_empty_body),
                    modifier = Modifier.weight(1f),
                )
                return@ShkScreen
            }
            LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                items(screen.rows, key = { it.reminder.id }) { row ->
                    val open = formScreen.form?.reminderId == row.reminder.id
                    PastItem(row, screen.today, format, selected = open) { form.openEdit(row.reminder) }
                }
            }
        }
    }
    screen.question?.let { question ->
        // A form open beside the list on a reminder that goes closes with it. One that stays keeps what it holds.
        DeleteAllDialog(question, model, format, onDeleted = form::closeIfDeleted)
    }
}

/**
 * One past reminder: its title, and "Mon 16 Nov, 14:00" under it.
 * TalkBack reads it as one item, "Call the bank, Monday 16 November at
 * 14:00", with the action "Edit".
 */
@Composable
private fun PastItem(row: PastRow, today: LocalDate, format: RemindersFormat, selected: Boolean, onEdit: () -> Unit) {
    val title = row.reminder.title
    ReminderItem(
        title = title,
        supporting = format.dateTime(row.time, today),
        spoken = stringResource(R.string.reminders_row_spoken, title, format.dateTimeSpoken(row.time, today)),
        selected = selected,
        onEdit = onEdit,
    )
}

/**
 * "Delete all past reminders?", "This deletes 12 reminders.", with
 * **Delete** and **Cancel**. [onDeleted] gets the IDs of the reminders
 * that were deleted.
 */
@Composable
private fun DeleteAllDialog(
    question: DeleteAllQuestion,
    model: PastViewModel,
    format: RemindersFormat,
    onDeleted: (Set<String>) -> Unit,
) {
    ShkDialog(
        title = stringResource(R.string.reminders_delete_all_question),
        text = pluralStringResource(R.plurals.reminders_delete_all_text, question.count, format.number(question.count)),
        confirmAction = ShkDialogAction(
            text = stringResource(R.string.reminders_delete),
            onClick = { model.confirmDeleteAll(onDeleted) },
            destructive = true,
        ),
        dismissAction = ShkDialogAction(text = stringResource(R.string.reminders_cancel), onClick = model::cancelDeleteAll),
        onDismissRequest = model::cancelDeleteAll,
    )
}

/** Shows the snackbar after **Delete all** on [host]: "12 reminders deleted", with Undo. TalkBack announces it with its action. */
@Composable
private fun PastSnackbars(screen: PastScreen, model: PastViewModel, host: ShkSnackbarHostState, format: RemindersFormat) {
    val snackbar = screen.snackbar
    val message = snackbar?.let { pluralStringResource(R.plurals.reminders_all_deleted, it.count, format.number(it.count)) }
    val undo = stringResource(R.string.reminders_undo)
    LaunchedEffect(snackbar) {
        if (snackbar == null || message == null) return@LaunchedEffect
        when (host.show(message, undo)) {
            ShkSnackbarResult.ActionPerformed -> model.undo()
            ShkSnackbarResult.Dismissed -> model.snackbarDismissed()
        }
    }
}
