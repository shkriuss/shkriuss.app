package app.shkriuss.feature.tasks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus

/** The questions of a list's menu (docs/apps/tasks/spec.md, "A list", points 6 and 7). */
sealed interface ListQuestion {
    /** "Delete the list Home?", and "This deletes 12 tasks." or "The list is empty." */
    data class DeleteList(val list: TaskList, val taskCount: Int) : ListQuestion

    /** "Delete 12 done tasks?": it deletes the done tasks [ids] that were shown when it opened. */
    data class DeleteDone(val ids: List<String>) : ListQuestion {
        /** How many it deletes. */
        val count: Int
            get() = ids.size
    }
}

/** What one open list shows (docs/apps/tasks/spec.md, "A list"). */
data class ListScreen(
    /** False until the first read of the database is in. */
    val loaded: Boolean,
    /** True if the database could not be read: "Could not open your tasks." */
    val failed: Boolean = false,
    /** Today, so that a row can say its date. */
    val today: LocalDate,
    /** The phone's time zone when [today] was read, so that a row of Done can say the day it was done. */
    val zone: ZoneId,
    /** The open list's `listId`: [INBOX], or a list's `id`. Null with no list open: "Choose a list." */
    val listId: String? = null,
    /** The open list, or null for Inbox. Its name is the top bar's. */
    val list: TaskList? = null,
    /** The open tasks, in the order of "A list", point 2. */
    val open: List<TaskRow> = emptyList(),
    /** Section Done: the last one done first. */
    val done: List<TaskRow> = emptyList(),
    /** The question of **Delete list** or **Delete done tasks**, while it shows. */
    val question: ListQuestion? = null,
    /** The snackbar of a tick, a delete or an Undo, while it shows. */
    val snackbar: TasksSnackbar? = null,
) {
    /** True for Inbox, which cannot be renamed or deleted. */
    val isInbox: Boolean
        get() = listId == INBOX

    /** True while the menu offers **Rename** and **Delete list**: not on Inbox. */
    val canRenameAndDelete: Boolean
        get() = list != null

    /** True while the menu offers **Delete done tasks**: there are done tasks. */
    val canDeleteDone: Boolean
        get() = done.isNotEmpty()

    /** True with no task: "No tasks in this list. Tap Add a task to make one." */
    val isEmpty: Boolean
        get() = loaded && !failed && listId != null && open.isEmpty() && done.isEmpty()

    /** The day [row] was done, by the phone's clock, for "Done Mon 16 Nov", or null while it is open. */
    fun doneOn(row: TaskRow): LocalDate? =
        row.task.doneAt?.let { LocalDateTime.ofInstant(Instant.ofEpochMilli(it), zone).toLocalDate() }
}

/**
 * The ViewModel of one open list, or Inbox. It follows the database and
 * [now]. A tick marks a task done or moves a repeating one, with Undo; a
 * cleared tick in Done opens the task again, with no snackbar. **Delete
 * list** and **Delete done tasks** ask first, and their snackbars offer
 * Undo. The list closes when it is deleted, here or by a restore.
 * **Add a task** opens the [TaskFormViewModel] in this list, with no due
 * day; **Rename** the [ListNameViewModel].
 *
 * Every change runs in [work] on top of the ViewModel's scope. Tests pass
 * `Dispatchers.Unconfined`.
 */
class ListViewModel(
    private val repository: TasksRepository,
    time: TasksTime,
    now: TasksNow,
    private val work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    private val openId = MutableStateFlow<String?>(null)
    private val question = MutableStateFlow<ListQuestion?>(null)
    private val snackbar = MutableStateFlow<TasksSnackbar?>(null)
    private val rows = RowActions(repository, time, viewModelScope, work, snackbar)

    /** The `id` of each list in this screen's last read of the lists. Read and written only by [closeIfGone]. */
    private var lastRead: Set<String> = emptySet()

    /** What the screen shows. */
    val state: StateFlow<ListScreen> = combine(
        repository.tasks(),
        // Before each read of the lists reaches the state, a deleted open list closes ([closeIfGone]).
        repository.lists().onEach(::closeIfGone),
        now.reading,
        openId,
        combine(question, snackbar, ::Pair),
    ) { tasks, lists, reading, listId, (openQuestion, shownSnackbar) ->
        val list = lists.firstOrNull { it.id == listId }
        // A list that is deleted closes: here, by Delete list, or by a restore.
        val shownId = listId?.takeIf { it == INBOX || list != null }
        val sections = shownId?.let { TaskOrder.inList(tasks, lists, it) }
        ListScreen(
            loaded = true,
            today = reading.today,
            zone = reading.zone,
            listId = shownId,
            list = list,
            open = sections?.open.orEmpty(),
            done = sections?.done.orEmpty(),
            question = openQuestion?.takeIf { shownId != null },
            snackbar = shownSnackbar,
        )
    }.onReadFailure { now.reading.value.let { ListScreen(loaded = true, failed = true, today = it.today, zone = it.zone, listId = openId.value) } }
        .stateIn(viewModelScope + work, SharingStarted.Eagerly, now.reading.value.let { ListScreen(loaded = false, today = it.today, zone = it.zone) })

    /** A tap on a row of Lists: the list [listId], or Inbox for [INBOX]. */
    fun open(listId: String) {
        question.value = null
        openId.value = listId
    }

    /** Back from the open list: Lists again. */
    fun close() {
        question.value = null
        openId.value = null
    }

    /**
     * A list deleted anywhere, here, by Undo on another screen, or by a
     * restore, closes with its question, and stays closed should it come
     * back: the screen is on Lists again. It runs on each read of [lists],
     * before the state takes it, so no read can show the list again first.
     *
     * An open list that the last read held and this one leaves out is
     * deleted: it closes at once. That holds also for a list the screen
     * read before it was opened, so an Undo that brings the list back
     * right after its delete cannot open it again. Lists may show a new
     * list a moment before this screen's read of the lists does, so an
     * open list that no read has held yet is looked up in the database
     * instead. A read that fails closes nothing: the state shows it.
     */
    private fun closeIfGone(lists: List<TaskList>) {
        val before = lastRead
        val read = lists.mapTo(HashSet()) { it.id }
        lastRead = read
        val listId = openId.value?.takeIf { it != INBOX } ?: return
        when (listId) {
            in read -> Unit
            in before -> closeIfOpen(listId)
            else -> viewModelScope.launch(work) { if (isGone { repository.findList(listId) }) closeIfOpen(listId) }
        }
    }

    /** The list [listId] is deleted. If it is open, it closes with its question. */
    private fun closeIfOpen(listId: String) {
        if (openId.compareAndSet(listId, null)) question.value = null
    }

    /** A tick on [row]. */
    fun tick(row: TaskRow) = rows.tick(row)

    /** A cleared tick on [row] in section Done. */
    fun reopen(row: TaskRow) = rows.reopen(row)

    /** **Delete list** in the menu: the question opens. Inbox has none. */
    fun askDeleteList() {
        val shown = state.value
        val list = shown.list ?: return
        question.value = ListQuestion.DeleteList(list, shown.open.size + shown.done.size)
    }

    /** **Delete done tasks** in the menu: the question opens, for the done tasks shown now. With none, nothing opens. */
    fun askDeleteDone() {
        val done = state.value.done
        if (done.isEmpty()) return
        question.value = ListQuestion.DeleteDone(done.map { it.task.id })
    }

    /** **Cancel** in the question: it closes and nothing is deleted. */
    fun cancelQuestion() {
        question.value = null
    }

    /**
     * **Delete** in the question. The question closes at the first press,
     * so a second does nothing. **Delete list** marks the list and all its
     * tasks as deleted, the list closes, and the snackbar "List deleted"
     * offers Undo. **Delete done tasks** marks those that are still done as
     * deleted, and the snackbar says how many went.
     */
    fun confirmDelete() {
        val asked = question.value ?: return
        question.value = null
        viewModelScope.launch(work) {
            val shown = rows.changing {
                when (asked) {
                    is ListQuestion.DeleteList -> repository.deleteList(asked.list.id)?.let(TasksSnackbar::ListDeleted)
                    is ListQuestion.DeleteDone -> repository.deleteDone(asked.ids)?.let { TasksSnackbar.DoneTasksDeleted(it.taskCount, it) }
                }
            } ?: return@launch
            // The deleted list closes, and stays closed after Undo: Undo brings it back on Lists.
            if (asked is ListQuestion.DeleteList) closeIfOpen(asked.list.id)
            snackbar.value = shown
        }
    }

    /** **Undo** in the snackbar. After Undo of Delete list, the list is back on Lists. */
    fun undo() = rows.undo()

    /** The snackbar went away without Undo. */
    fun snackbarDismissed() {
        snackbar.value = null
    }
}
