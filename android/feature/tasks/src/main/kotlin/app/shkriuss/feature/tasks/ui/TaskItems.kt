package app.shkriuss.feature.tasks.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkSnackbarHostState
import app.shkriuss.core.design.ShkSnackbarResult
import app.shkriuss.feature.tasks.R
import app.shkriuss.feature.tasks.TaskRow
import app.shkriuss.feature.tasks.TasksSnackbar
import java.time.LocalDate

/**
 * One task, on Today or in a list (docs/apps/tasks/spec.md, "Today",
 * point 4, "A list", points 2 and 3, and "TalkBack", point 1): a tick
 * box, the title, and the line under it ([TasksFormat.supporting]). A
 * tick on an open task calls [onTick]; a cleared tick on a done one,
 * [onReopen]; a tap on the row, [onEdit]. [doneOn] is the day a done task
 * was done.
 *
 * TalkBack reads it as one item, "Pay rent, due today at 10:00, every
 * month, Home, not done", and offers "Mark as done" (or "Mark as not
 * done") and "Edit".
 */
@Composable
internal fun TaskItem(
    row: TaskRow,
    place: RowPlace,
    today: LocalDate,
    doneOn: LocalDate?,
    format: TasksFormat,
    onTick: () -> Unit,
    onReopen: () -> Unit,
    onEdit: () -> Unit,
) {
    val open = row.task.isOpen
    val spoken = format.spoken(row, place, today)
    val editLabel = stringResource(R.string.tasks_edit)
    ShkListItem(
        headline = row.task.title,
        supportingText = format.supporting(row, place, today, doneOn),
        onClick = onEdit,
        checked = !open,
        onCheckedChange = { ticked -> if (ticked) onTick() else onReopen() },
        checkedDescription = format.state(doneOn, today),
        checkActionLabel = stringResource(if (open) R.string.tasks_mark_done else R.string.tasks_mark_not_done),
        modifier = Modifier.semantics {
            contentDescription = spoken
            onClick(label = editLabel) {
                onEdit()
                true
            }
        },
    )
}

/** A section of a list of tasks under its [heading]: [rows], each a [TaskItem]. With no row, none at all (the owner's decision). */
internal fun LazyListScope.taskSection(heading: String?, key: String, rows: List<TaskRow>, item: @Composable (TaskRow) -> Unit) {
    if (rows.isEmpty()) return
    if (heading != null) item(key = key) { ShkSectionHeader(heading) }
    items(rows, key = { it.task.id }) { item(it) }
}

/** Room under the last row of a list, so it can scroll clear of the floating button. */
internal fun LazyListScope.roomForButton(height: Dp) {
    item(key = ROOM_FOR_BUTTON) { Spacer(Modifier.height(height)) }
}

/**
 * Shows [snackbar] on [host]: "Task done", "Next: Wed 18 Nov", "Task
 * deleted", "List deleted" or "12 tasks deleted", each with **Undo**;
 * "Task added"; or "Could not change your tasks. Try again." TalkBack
 * announces it with its action. [onUndo] runs when Undo is tapped,
 * [onDismissed] when it goes by itself.
 */
@Composable
internal fun TasksSnackbarOn(
    host: ShkSnackbarHostState,
    snackbar: TasksSnackbar?,
    today: LocalDate,
    format: TasksFormat,
    onUndo: () -> Unit,
    onDismissed: () -> Unit,
) {
    val message = when (snackbar) {
        is TasksSnackbar.Done -> stringResource(R.string.tasks_task_done)
        is TasksSnackbar.Next -> stringResource(R.string.tasks_next, format.day(snackbar.date, today))
        is TasksSnackbar.TaskDeleted -> stringResource(R.string.tasks_task_deleted)
        is TasksSnackbar.ListDeleted -> stringResource(R.string.tasks_list_deleted)
        is TasksSnackbar.DoneTasksDeleted -> pluralStringResource(R.plurals.tasks_done_deleted, snackbar.count, format.number(snackbar.count))
        TasksSnackbar.TaskAdded -> stringResource(R.string.tasks_task_added)
        TasksSnackbar.CouldNotChange -> stringResource(R.string.tasks_could_not_change)
        null -> null
    }
    val undo = when (snackbar) {
        is TasksSnackbar.Done,
        is TasksSnackbar.Next,
        is TasksSnackbar.TaskDeleted,
        is TasksSnackbar.ListDeleted,
        is TasksSnackbar.DoneTasksDeleted,
        -> stringResource(R.string.tasks_undo)
        TasksSnackbar.TaskAdded, TasksSnackbar.CouldNotChange, null -> null
    }
    LaunchedEffect(snackbar) {
        if (snackbar == null || message == null) return@LaunchedEffect
        when (host.show(message, undo)) {
            ShkSnackbarResult.ActionPerformed -> onUndo()
            ShkSnackbarResult.Dismissed -> onDismissed()
        }
    }
}

/** The key of the room under the last row. No task has it as its `id`. */
private const val ROOM_FOR_BUTTON = "room-for-button"
