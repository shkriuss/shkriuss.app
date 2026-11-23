package app.shkriuss.feature.tasks.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkEmptyState
import app.shkriuss.core.design.ShkErrorState
import app.shkriuss.core.design.ShkExtendedFloatingActionButton
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.rememberShkSnackbarHostState
import app.shkriuss.feature.tasks.NotificationsViewModel
import app.shkriuss.feature.tasks.R
import app.shkriuss.feature.tasks.TaskFormViewModel
import app.shkriuss.feature.tasks.TaskRow
import app.shkriuss.feature.tasks.TodayViewModel

/**
 * Today, the start screen (docs/apps/tasks/spec.md, "Today"): while an
 * open task has a reminder to come and notifications cannot show, the
 * line that says so; the sections Overdue and Today, each only while it
 * has a task (the owner's decision), or "Nothing due today."; a tick on a
 * row, with its snackbar; and the floating button "Add a task", which
 * opens the [form] due today, in Inbox. A tap on a row opens its form.
 * The form is a bottom sheet at every width ([TaskFormSheet]).
 */
@Composable
internal fun TodayContent(model: TodayViewModel, form: TaskFormViewModel, notifications: NotificationsViewModel) {
    val screen by model.state.collectAsState()
    val formScreen by form.state.collectAsState()
    val notificationsScreen by notifications.state.collectAsState()
    val format = rememberTasksFormat()
    val snackbars = rememberShkSnackbarHostState()
    TasksSnackbarOn(snackbars, screen.snackbar, screen.today, format, model::undo, model::snackbarDismissed)
    TasksSnackbarOn(snackbars, formScreen.snackbar, screen.today, format, form::undo, form::snackbarDismissed)
    // The list leaves room under its last row for the floating button, so that row can scroll clear of it.
    var buttonHeight by remember { mutableIntStateOf(0) }
    ShkScreen(
        topBar = { ShkTopBar(title = stringResource(R.string.tasks_today)) },
        floatingActionButton = {
            ShkExtendedFloatingActionButton(
                text = stringResource(R.string.tasks_add),
                icon = painterResource(R.drawable.tasks_icon_add),
                onClick = form::openNewDueToday,
                modifier = Modifier.onSizeChanged { buttonHeight = it.height },
            )
        },
        snackbarHostState = snackbars,
    ) {
        if (screen.loaded && !screen.failed && screen.reminderToCome) {
            notificationsScreen.line?.let { line ->
                NotificationLineRow(line, notifications, Modifier.padding(bottom = ShkSpacing.Small))
            }
        }
        when {
            !screen.loaded -> Unit
            screen.failed -> ShkErrorState(title = stringResource(R.string.tasks_could_not_open), modifier = Modifier.weight(1f))
            screen.isEmpty -> ShkEmptyState(title = stringResource(R.string.tasks_nothing_due_today), modifier = Modifier.weight(1f))
            else -> {
                val room = with(LocalDensity.current) { buttonHeight.toDp() } + ShkSpacing.Large
                val overdue = stringResource(R.string.tasks_overdue)
                val dueToday = stringResource(R.string.tasks_today)
                val item: @Composable (TaskRow) -> Unit = { row ->
                    TaskItem(
                        row = row,
                        place = RowPlace.TODAY,
                        today = screen.today,
                        doneOn = null,
                        format = format,
                        onTick = { model.tick(row) },
                        // Today shows only open tasks.
                        onReopen = {},
                        onEdit = { form.openEdit(row.task) },
                    )
                }
                LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                    taskSection(overdue, OVERDUE_KEY, screen.overdue, item)
                    taskSection(dueToday, TODAY_KEY, screen.dueToday, item)
                    roomForButton(room)
                }
            }
        }
    }
    TaskFormSheet(form, screen.today, format)
}

/** The keys of the two headings. No task has them as its `id`. */
private const val OVERDUE_KEY = "overdue"
private const val TODAY_KEY = "today"
