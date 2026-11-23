package app.shkriuss.feature.tasks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.time.LocalDate
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.plus

/** What Today shows (docs/apps/tasks/spec.md, "Today"). */
data class TodayScreen(
    /** False until the first read of the database is in. */
    val loaded: Boolean,
    /** True if the database could not be read: "Could not open your tasks." */
    val failed: Boolean = false,
    /** Today, so that a row of Overdue can say its date. */
    val today: LocalDate,
    /** Section Overdue: open tasks with a due day before today, oldest first. */
    val overdue: List<TaskRow> = emptyList(),
    /** Section Today: open tasks due today. */
    val dueToday: List<TaskRow> = emptyList(),
    /** The snackbar of a tick or an Undo, while it shows. */
    val snackbar: TasksSnackbar? = null,
) {
    /** True with nothing overdue and nothing due today: "Nothing due today." */
    val isEmpty: Boolean
        get() = loaded && !failed && overdue.isEmpty() && dueToday.isEmpty()
}

/**
 * The ViewModel of Today, the start destination. The sections follow the
 * database and [now], the one source of the clock: from midnight on, a
 * task due yesterday is overdue. A tick marks a task done, or moves a
 * repeating task to its next date, with a snackbar that offers Undo.
 * **Add a task** opens the [TaskFormViewModel], due today, in Inbox.
 *
 * Every change runs in [work] on top of the ViewModel's scope. Tests pass
 * `Dispatchers.Unconfined`.
 */
class TodayViewModel(
    repository: TasksRepository,
    time: TasksTime,
    now: TasksNow,
    work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    private val snackbar = MutableStateFlow<TasksSnackbar?>(null)
    private val rows = RowActions(repository, time, viewModelScope, work, snackbar)

    /** What the screen shows. */
    val state: StateFlow<TodayScreen> = combine(repository.tasks(), repository.lists(), now.reading, snackbar) { tasks, lists, reading, shown ->
        val sections = TaskOrder.today(tasks, lists, reading.today)
        TodayScreen(loaded = true, today = reading.today, overdue = sections.overdue, dueToday = sections.dueToday, snackbar = shown)
    }.onReadFailure { TodayScreen(loaded = true, failed = true, today = now.reading.value.today) }
        .stateIn(viewModelScope + work, SharingStarted.Eagerly, TodayScreen(loaded = false, today = now.reading.value.today))

    /** A tick on [row]. */
    fun tick(row: TaskRow) = rows.tick(row)

    /** **Undo** in the snackbar. */
    fun undo() = rows.undo()

    /** The snackbar went away without Undo. */
    fun snackbarDismissed() {
        snackbar.value = null
    }
}
