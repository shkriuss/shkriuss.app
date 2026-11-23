package app.shkriuss.feature.tasks

import android.database.SQLException
import java.time.LocalDate
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch

/** The snackbars of Tasks (docs/apps/tasks/spec.md, "Screens" and "A write fails"). */
sealed interface TasksSnackbar {
    /** "Task done", with **Undo**. */
    data class Done(val undo: Undo) : TasksSnackbar

    /** "Next: Wed 18 Nov", with **Undo**: a repeating task moved to [date]. */
    data class Next(val date: LocalDate, val undo: Undo) : TasksSnackbar

    /** "Task deleted", with **Undo**. */
    data class TaskDeleted(val undo: Undo) : TasksSnackbar

    /** "List deleted", with **Undo**. */
    data class ListDeleted(val undo: Undo) : TasksSnackbar

    /** "12 tasks deleted", with **Undo**: done tasks of a list. */
    data class DoneTasksDeleted(val count: Int, val undo: Undo) : TasksSnackbar

    /** "Task added". */
    data object TaskAdded : TasksSnackbar

    /** "Could not change your tasks. Try again.": a tick, a delete or an Undo that the database refused. */
    data object CouldNotChange : TasksSnackbar
}

/** The [Undo] of a snackbar that offers it, or null. */
val TasksSnackbar.offeredUndo: Undo?
    get() = when (this) {
        is TasksSnackbar.Done -> undo
        is TasksSnackbar.Next -> undo
        is TasksSnackbar.TaskDeleted -> undo
        is TasksSnackbar.ListDeleted -> undo
        is TasksSnackbar.DoneTasksDeleted -> undo
        TasksSnackbar.TaskAdded, TasksSnackbar.CouldNotChange -> null
    }

/**
 * A tick, a cleared tick and **Undo** on a row, as Today and a list have
 * them (docs/apps/tasks/spec.md, "Today", point 5, and "A list", point
 * 3), with the snackbar they show in [snackbar]. A write the database
 * refuses changes nothing and shows "Could not change your tasks. Try
 * again." Each runs in [work] on [scope].
 */
internal class RowActions(
    private val repository: TasksRepository,
    private val time: TasksTime,
    private val scope: CoroutineScope,
    private val work: CoroutineContext,
    private val snackbar: MutableStateFlow<TasksSnackbar?>,
) {
    /**
     * A tick on [row]: it carries the due day and the repeat its row
     * showed, and counts only while the task is open with both. "Task
     * done", or "Next: Wed 18 Nov" for a repeating task, with Undo. One
     * that did not count changes nothing: the row goes or shows the change.
     */
    fun tick(row: TaskRow) {
        val task = row.task
        val now = time.reading()
        scope.launch(work) {
            changing { repository.tick(task.id, task.due?.day, task.due?.repeatKind ?: Repeat.ONCE, now) }?.let { tick ->
                snackbar.value = tick.next?.let { TasksSnackbar.Next(it, tick.undo) } ?: TasksSnackbar.Done(tick.undo)
            }
        }
    }

    /** A cleared tick in section Done: the task is open again, with no snackbar. */
    fun reopen(row: TaskRow) {
        val now = time.reading()
        scope.launch(work) { changing { repository.reopen(row.task.id, now) } }
    }

    /** **Undo** in the snackbar that offers it. The snackbar goes. */
    fun undo() {
        val undo = snackbar.value?.offeredUndo ?: return
        snackbar.value = null
        val now = time.reading()
        scope.launch(work) { changing { repository.undo(undo, now) } }
    }

    /** Runs [write]. If the database refuses it, nothing changed, and the snackbar says so. */
    suspend fun <T> changing(write: suspend () -> T?): T? = try {
        write()
    } catch (_: SQLException) {
        snackbar.value = TasksSnackbar.CouldNotChange
        null
    }
}

/**
 * A screen's state that becomes [failed] when the database cannot be read
 * (docs/apps/tasks/spec.md, "A write fails": `ShkErrorState`, "Could not
 * open your tasks."). Any other error goes on.
 */
internal fun <T> Flow<T>.onReadFailure(failed: () -> T): Flow<T> = catch { error ->
    if (error is SQLException) emit(failed()) else throw error
}

/** This flow without the error of a database read: it ends there. The screen's state shows the failure ([onReadFailure]). */
internal fun <T> Flow<T>.ignoreReadFailure(): Flow<T> = catch { error -> if (error !is SQLException) throw error }

/**
 * True if [find] finds no record: there is none, or it is deleted. False
 * also when the database cannot be read: then nothing closes, and the
 * screen's state shows the failure.
 */
internal suspend fun isGone(find: suspend () -> Any?): Boolean = try {
    find() == null
} catch (_: SQLException) {
    false
}

/** This flow, with null in place of the error of a database read, for a state that goes on after it. Any other error goes on. */
internal fun <T : Any> Flow<T>.orNullOnReadFailure(): Flow<T?> = catch<T?> { error ->
    if (error is SQLException) emit(null) else throw error
}
