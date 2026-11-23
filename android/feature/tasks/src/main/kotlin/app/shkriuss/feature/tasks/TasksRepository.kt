package app.shkriuss.feature.tasks

import androidx.room3.withWriteTransaction
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.data.RecordTimes
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.core.data.isDeleted
import app.shkriuss.feature.tasks.data.TaskEntity
import app.shkriuss.feature.tasks.data.TaskListEntity
import app.shkriuss.feature.tasks.data.TasksDatabase
import java.time.LocalDate
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** What a write of [TasksRepository] changed, so that the notifications can follow it. */
data class TaskChange(
    /** What happened. */
    val kind: Kind,
    /** The tasks it happened to. */
    val ids: List<String>,
) {
    /** The writes of docs/apps/tasks/spec.md, "Reminders of a task", the table of changes. */
    enum class Kind {
        /** A new task. It counts from the minute it was saved. */
        ADDED,

        /** A new due day, repeat, days or reminder time, perhaps with a new title or list. It counts from now, and its notification goes. */
        NEW_TIME,

        /** A new title or list only. Nothing more: a notification on screen keeps the old title. */
        NEW_TITLE_OR_LIST,

        /** Done: no alarm. Its snooze, entries and notification go. */
        DONE,

        /** A repeating task moved to its next due day. It counts from now, and its notification goes. */
        MOVED,

        /** A done task opened again. It counts from now. */
        OPENED_AGAIN,

        /** Deleted. Its notification, snooze and entries go. */
        DELETED,

        /** Brought back by Undo. It counts from now. */
        BROUGHT_BACK,
    }
}

/**
 * What **Undo** acts on: the records of one snackbar, each with the change
 * number that the action's write gave it (docs/apps/tasks/spec.md, "A
 * press twice or late", Undo). A record changed since then, by an edit, a
 * tick or a restore, has another change number and stays as it is.
 */
class Undo internal constructor(internal val steps: List<UndoStep>) {
    /** How many tasks it brings back or puts back. */
    val taskCount: Int
        get() = steps.count { it !is UndoStep.BringBackList }
}

/** One record that [Undo] acts on. */
internal sealed interface UndoStep {
    /** The record's ID. */
    val id: String

    /** The change number the action's write gave it. Undo acts only while it is still this one. */
    val changeNumber: Long

    /** A deleted task comes back. */
    data class BringBackTask(override val id: String, override val changeNumber: Long) : UndoStep

    /** A deleted list comes back. */
    data class BringBackList(override val id: String, override val changeNumber: Long) : UndoStep

    /** A tick is undone: the task gets back the due day and the done time it had before. */
    data class PutBack(override val id: String, override val changeNumber: Long, val dueDay: Int?, val doneAt: Long?) : UndoStep
}

/** What a tick did (docs/apps/tasks/spec.md, "Today", point 5). */
data class Tick(
    /** The task as it is now: done, or moved to [next]. */
    val task: Task,
    /** The new due day of a repeating task, for "Next: Wed 18 Nov", or null when the task is done. */
    val next: LocalDate?,
    /** Undo in the snackbar. */
    val undo: Undo,
)

/**
 * A new due date, repeat, days or reminder time from the form. [due] is
 * what the form gives (docs/apps/tasks/spec.md, "Repeats", point 2). With
 * [datesChanged] false, the stored due day, repeat and days stay, and
 * only the reminder time is written; with [reminderChanged] false the
 * stored reminder time stays. So a save never puts back a due day that
 * **Done** on the notification moved while the form was open.
 */
data class DueEdit(
    /** The due day, repeat and reminder time the form gives, or null for no due date. */
    val due: Due?,
    /** True if the due date, the repeat or the days changed in the form. */
    val datesChanged: Boolean,
    /** True if **Remind me** or the time changed in the form. */
    val reminderChanged: Boolean,
)

/** What a save of the form changes in a stored task. Each part that is null stays as it is stored now. */
data class TaskEdit(
    /** The new title, as stored. */
    val title: String? = null,
    /** The new list, or [INBOX]. */
    val listId: String? = null,
    /** A new due date, repeat, days or reminder time. */
    val due: DueEdit? = null,
)

/**
 * The lists and tasks of Tasks. Every write goes through a `RecordWriter`,
 * so it is stamped, gets a change number and never removes a row
 * (docs/architecture/data.md). Every read that shows records leaves
 * deleted ones out.
 *
 * Tasks writes to two places: the database, one transaction per action,
 * and the phone-only [book] (docs/apps/tasks/spec.md, "Stopped between
 * two writes"). The database comes first and is the truth; then the
 * entries; then [onChange], so that the notifications follow
 * (its notification goes, then `notify.sync()`). One exception: an action
 * that brings a task back to a reminder, **Undo** or opening a done task
 * again, writes the entries first, for the reminder number the task will
 * have. If Tasks stops before the database write, the task does not have
 * that number, so the entries count for nothing.
 *
 * "Now" is the current minute of the moment the action was asked for: the
 * caller reads the clock once, before the write. The work on the book
 * takes its turn on [turns], the one lock that the handler of an alarm
 * and a press of a button take too, and runs in [work], off the main
 * thread.
 *
 * Once a write has begun, it runs to its end, from the database through
 * [onChange], also when its caller is cancelled. A write the database
 * refuses throws its `android.database.SQLException`, and nothing of the
 * action is written (spec, "A write fails"). A write of the book that the
 * disk refuses is not an error: the book keeps the change.
 */
class TasksRepository(
    private val database: TasksDatabase,
    clock: Clock,
    ids: IdSource,
    private val time: TasksTime,
    private val book: TaskBook,
    private val turns: Mutex = Mutex(),
    private val work: CoroutineContext = Dispatchers.IO,
    private val onChange: suspend (TaskChange) -> Unit = {},
) {
    private val lists = database.lists()
    private val tasks = database.tasks()
    private val listWriter = RecordWriter(database, lists, clock, ids)
    private val taskWriter = RecordWriter(database, tasks, clock, ids)

    /** The lists that are not deleted, in no order. */
    fun lists(): Flow<List<TaskList>> = lists.observeLive().map { rows -> rows.map(::taskListOf) }

    /** The tasks that are not deleted, in no order. */
    fun tasks(): Flow<List<Task>> = tasks.observeLive().map { rows -> rows.map(::taskOf) }

    /** The phone-only entries, by task `id`, as written. They change after every write, and when an alarm or a button changes them. */
    val entries: StateFlow<Map<String, TaskEntry>> = book.entries

    /** The task with [id], or null if there is none or it is deleted. */
    suspend fun findTask(id: String): Task? = tasks.find(id)?.takeUnless { it.record.isDeleted }?.let(::taskOf)

    /** The list with [id], or null if there is none or it is deleted. */
    suspend fun findList(id: String): TaskList? = lists.find(id)?.takeUnless { it.record.isDeleted }?.let(::taskListOf)

    /** Adds a list named [name], unless [TaskLimits.MOST_LISTS] are kept: then it adds none and returns null. */
    suspend fun addList(name: String): TaskList? = withContext(NonCancellable) {
        database.withWriteTransaction<TaskListEntity?> {
            if (lists.liveCount() >= TaskLimits.MOST_LISTS) {
                null
            } else {
                listWriter.create { fields, number -> stored(TaskListEntity(fields, number, name)) }
            }
        }?.let(::taskListOf)
    }

    /** Gives the list [id] the name [name]. Nothing is written if it had it. Null if there is no such list, or it is deleted. */
    suspend fun renameList(id: String, name: String): TaskList? = withContext(NonCancellable) {
        listWriter.update(id) { stored(it.copy(name = name)) }?.let(::taskListOf)
    }

    /**
     * Adds [task], unless [TaskLimits.MOST_TASKS] are kept: then it adds
     * none and returns null. With a reminder, it counts from the current
     * minute of [now], the moment of the save. A list that was deleted in
     * that moment puts the task in Inbox ([listToWrite]).
     */
    suspend fun addTask(task: NewTask, now: ClockReading = time.reading()): Task? = withContext(NonCancellable) {
        val created = database.withWriteTransaction<TaskEntity?> {
            if (tasks.liveCount() >= TaskLimits.MOST_TASKS) {
                null
            } else {
                val listId = listToWrite(task.listId)
                taskWriter.create { fields, number ->
                    val row = TaskEntity(
                        fields,
                        number,
                        listId = listId,
                        title = task.title,
                        dueDay = null,
                        repeat = Repeat.ONCE.code,
                        weekdays = Weekdays.NONE,
                        repeatFrom = null,
                        remindMinute = null,
                        doneAt = null,
                    )
                    stored(withDue(row, task.due))
                }
            }
        } ?: return@withContext null
        countFrom(now, listOf(created))
        onChange(TaskChange(TaskChange.Kind.ADDED, listOf(created.record.id)))
        taskOf(created)
    }

    /**
     * Changes the task [id] as [edit] says, and keeps every other part as
     * it is stored now. A new due day, repeat, days or reminder time counts
     * from the current minute of [now]: the mark is now, with no snooze and
     * nothing on screen; with no reminder, its entries go. A new title or
     * list only writes no entries. Nothing is written if nothing changed.
     * Null if there is no such task, or it is deleted. A new list that was
     * deleted in that moment puts the task in Inbox ([listToWrite]); with
     * no new list, the stored `listId` stays, also one of a list that is
     * gone (spec, "Data", point 2).
     */
    suspend fun changeTask(id: String, edit: TaskEdit, now: ClockReading = time.reading()): Task? = withContext(NonCancellable) {
        // The write and its entries take one turn, so a cleared tick on another screen cannot come between them.
        val written = inTurn {
            val pair = database.withWriteTransaction<Pair<TaskEntity, TaskEntity>?> {
                val before = tasks.find(id)?.takeUnless { it.record.isDeleted } ?: return@withWriteTransaction null
                val checked = edit.listId?.let { edit.copy(listId = listToWrite(it)) } ?: edit
                val after = taskWriter.update(id) { stored -> stored(edited(stored, checked)) } ?: return@withWriteTransaction null
                before to after
            }
            if (pair != null && !sameWhen(pair.first, pair.second)) writeCounting(now, listOf(pair.second))
            pair
        } ?: return@withContext null
        val (before, after) = written
        val kind = when {
            !sameWhen(before, after) -> TaskChange.Kind.NEW_TIME
            before.title != after.title || before.listId != after.listId -> TaskChange.Kind.NEW_TITLE_OR_LIST
            else -> return@withContext taskOf(after)
        }
        onChange(TaskChange(kind, listOf(id)))
        taskOf(after)
    }

    /**
     * A tick on the task [id], whose row showed the due day [shownDue] and
     * the repeat [shownRepeat] (docs/apps/tasks/spec.md, "A press twice or
     * late"). It counts only while the task is open with both: a repeating
     * task moves one date, a done task is done once. Null if it did not
     * count, also for a task that is deleted.
     *
     * A repeating task moves to the first date of its repeat later than
     * both its old due day and today, by the clock of [now], and counts
     * from now. With no such date up to 9999-12-31, it is done instead.
     * Any other task is done at [now] ("Repeats", point 3).
     */
    suspend fun tick(id: String, shownDue: LocalDate?, shownRepeat: Repeat, now: ClockReading = time.reading()): Tick? =
        withContext(NonCancellable) {
            // The write and its entries take one turn: a cleared tick on another screen, which opens the task again and
            // writes its new mark, comes before both or after both, never between them.
            val written = inTurn {
                val triple = database.withWriteTransaction<Triple<TaskEntity, TaskEntity, LocalDate?>?> {
                    val before = tasks.find(id) ?: return@withWriteTransaction null
                    val shown = before.dueDay == shownDue?.let(::epochDayOf) && before.repeat == shownRepeat.code
                    if (before.record.isDeleted || before.doneAt != null || !shown) return@withWriteTransaction null
                    val due = taskOf(before).due
                    val next = due?.repeat?.let { RepeatDates.firstAfter(it, maxOf(due.day, now.today)) }
                    val after = taskWriter.update(id) { stored ->
                        if (next != null) stored.copy(dueDay = epochDayOf(next)) else stored.copy(doneAt = doneAtOf(now))
                    } ?: return@withWriteTransaction null
                    Triple(before, after, next)
                }
                if (triple != null) {
                    if (triple.third != null) writeCounting(now, listOf(triple.second)) else book.remove(listOf(id))
                }
                triple
            } ?: return@withContext null
            val (before, after, next) = written
            onChange(TaskChange(if (next != null) TaskChange.Kind.MOVED else TaskChange.Kind.DONE, listOf(id)))
            Tick(taskOf(after), next, Undo(listOf(UndoStep.PutBack(id, after.changeNumber, before.dueDay, before.doneAt))))
        }

    /**
     * Opens the done task [id] again: a cleared tick, with no snackbar. It
     * writes the entries first, for the reminder number the task will
     * have, counting from [now]; then the task. Null if the task is not
     * done, deleted or not stored, or changed in that moment: a cleared
     * tick twice opens it once.
     *
     * The read, the entries and the write take their turn on [turns] as
     * one, so a second cleared tick waits for the first and then finds the
     * task open: it writes no entries, and the mark stays that of the
     * press that counted.
     */
    suspend fun reopen(id: String, now: ClockReading = time.reading()): Task? = withContext(NonCancellable) {
        val after = inTurn {
            val before = tasks.find(id)?.takeIf { !it.record.isDeleted && it.doneAt != null } ?: return@inTurn null
            writeCounting(now, listOf(before.copy(doneAt = null)))
            database.withWriteTransaction<TaskEntity?> {
                if (tasks.find(id)?.changeNumber != before.changeNumber) null else taskWriter.update(id) { it.copy(doneAt = null) }
            }
        } ?: return@withContext null
        onChange(TaskChange(TaskChange.Kind.OPENED_AGAIN, listOf(id)))
        taskOf(after)
    }

    /** Marks the task [id] as deleted. The row stays, with its content. Its entries go. Null if it was deleted or not stored. */
    suspend fun deleteTask(id: String): Undo? = withContext(NonCancellable) {
        val deleted = taskWriter.markDeleted(id) ?: return@withContext null
        afterDelete(listOf(deleted))
        Undo(listOf(UndoStep.BringBackTask(id, deleted.changeNumber)))
    }

    /**
     * Marks the list [id] and every task in it as deleted, open and done,
     * in one transaction (the owner's decision 4). Their entries go. Null
     * if the list was deleted or not stored.
     */
    suspend fun deleteList(id: String): Undo? = withContext(NonCancellable) {
        val written = database.withWriteTransaction<Pair<TaskListEntity, List<TaskEntity>>?> {
            val list = listWriter.markDeleted(id) ?: return@withWriteTransaction null
            list to tasks.liveIn(id).mapNotNull { taskWriter.markDeleted(it.record.id) }
        } ?: return@withContext null
        val (list, deleted) = written
        afterDelete(deleted)
        Undo(listOf(UndoStep.BringBackList(list.record.id, list.changeNumber)) + deleted.map { UndoStep.BringBackTask(it.record.id, it.changeNumber) })
    }

    /**
     * **Delete done tasks**: marks those of the tasks [ids] that are still
     * done as deleted, in one transaction. Their entries go. Null if none
     * of them was.
     */
    suspend fun deleteDone(ids: List<String>): Undo? = withContext(NonCancellable) {
        val deleted = database.withWriteTransaction<List<TaskEntity>> {
            ids.distinct().mapNotNull { id ->
                tasks.find(id)?.takeIf { !it.record.isDeleted && it.doneAt != null }?.let { taskWriter.markDeleted(id) }
            }
        }
        if (deleted.isEmpty()) return@withContext null
        afterDelete(deleted)
        Undo(deleted.map { UndoStep.BringBackTask(it.record.id, it.changeNumber) })
    }

    /**
     * **Undo** in a snackbar. It acts only on the records of [undo], and
     * only on those whose change number is still the one the action's
     * write gave them. It writes the entries first, for the reminder
     * number each task will have, counting from [now]; then the records,
     * in one transaction. Returns the tasks it brought back or put back.
     * Undo may bring the count past the limits of the form. As in
     * [reopen], the reads, the entries and the write take their turn on
     * [turns] as one, so an Undo that does not count writes no entries.
     */
    suspend fun undo(undo: Undo, now: ClockReading = time.reading()): List<Task> = withContext(NonCancellable) {
        val taskSteps = undo.steps.filter { it !is UndoStep.BringBackList }
        val done = inTurn {
            val coming = taskSteps.mapNotNull { step ->
                tasks.find(step.id)?.takeIf { it.changeNumber == step.changeNumber }?.let { undone(it, step) }
            }
            writeCounting(now, coming)
            database.withWriteTransaction<List<TaskEntity>> {
                undo.steps.filterIsInstance<UndoStep.BringBackList>().forEach { step ->
                    if (lists.find(step.id)?.changeNumber == step.changeNumber) listWriter.restore(step.id)
                }
                taskSteps.mapNotNull { step -> if (tasks.find(step.id)?.changeNumber == step.changeNumber) undoTask(step) else null }
            }
        }
        if (done.isNotEmpty()) onChange(TaskChange(TaskChange.Kind.BROUGHT_BACK, done.map { it.record.id }))
        done.map(::taskOf)
    }

    /**
     * The list a task the form saves goes in: [listId] while it is
     * [INBOX] or a list that is not deleted, else Inbox. Called inside the
     * write transaction, so no delete of the list comes between the check
     * and the write. Only a restore, or later sync, can make a task whose
     * list is gone (docs/apps/tasks/spec.md, "Data", point 2): a save that
     * comes just after its list was deleted, from a form opened before,
     * keeps the task, in Inbox.
     */
    private suspend fun listToWrite(listId: String): String = when {
        // Not an ID at all: the limits of the table refuse it, and nothing is written.
        listId == INBOX || !TaskRules.isListId(listId) -> listId
        lists.find(listId)?.record?.isDeleted == false -> listId
        else -> INBOX
    }

    /** The task of [row] after [step]: back from its delete, or with the due day and done time it had before its tick. */
    private fun undone(row: TaskEntity, step: UndoStep): TaskEntity = when (step) {
        is UndoStep.BringBackTask -> row.copy(record = row.record.copy(deletedAt = null))
        is UndoStep.PutBack -> row.copy(dueDay = step.dueDay, doneAt = step.doneAt)
        is UndoStep.BringBackList -> row
    }

    private suspend fun undoTask(step: UndoStep): TaskEntity? = when (step) {
        is UndoStep.BringBackTask -> taskWriter.restore(step.id)
        is UndoStep.PutBack -> taskWriter.update(step.id) { it.copy(dueDay = step.dueDay, doneAt = step.doneAt) }
        is UndoStep.BringBackList -> null
    }

    private suspend fun afterDelete(deleted: List<TaskEntity>) {
        val deletedIds = deleted.map { it.record.id }
        forget(deletedIds)
        onChange(TaskChange(TaskChange.Kind.DELETED, deletedIds))
    }

    /**
     * Each task of [rows] counts from the current minute of [now], for the
     * reminder number its row has: that is its mark, with no snooze and
     * nothing on screen. A row with no reminder loses its entries.
     */
    private suspend fun countFrom(now: ClockReading, rows: List<TaskEntity>) {
        if (rows.isEmpty()) return
        inTurn { writeCounting(now, rows) }
    }

    /** [countFrom], for a caller that already has its turn on [turns]. */
    private fun writeCounting(now: ClockReading, rows: List<TaskEntity>) {
        if (rows.isEmpty()) return
        val numbers = rows.associate { it.record.id to TaskReminders.numberOf(it) }
        book.update(numbers.keys) { id, _ -> numbers[id]?.let { TaskEntry.countingFrom(it, now.currentMinute) } ?: TaskEntry() }
    }

    /** Runs [block] in [work], in its turn on [turns]: the one lock of the book's work, the alarms and the buttons. */
    private suspend fun <T> inTurn(block: suspend () -> T): T = withContext(work) { turns.withLock { block() } }

    /** The entries of [ids] go: their marks, snoozes and notifications on screen. */
    private suspend fun forget(ids: List<String>) {
        if (ids.isEmpty()) return
        withContext(work) { turns.withLock { book.remove(ids) } }
    }

    /** How the repository turns rows into what the screens show, and back. */
    internal companion object {
        /** A stored list row as a [TaskList]. */
        fun taskListOf(row: TaskListEntity): TaskList = TaskList(row.record.id, row.name, row.record.createdAt)

        /** A stored task row as a [Task]. Every stored row is within the limits of [TaskRules]. */
        fun taskOf(row: TaskEntity): Task = Task(
            id = row.record.id,
            listId = row.listId,
            title = row.title,
            due = row.dueDay?.let { dueDay ->
                Due(
                    day = dayOf(dueDay),
                    repeat = row.repeatFrom?.let { from ->
                        TaskRepeat(checkNotNull(Repeat.ofCode(row.repeat)) { "A stored task has a repeat this version knows" }, dayOf(from), row.weekdays)
                    },
                    remindMinute = row.remindMinute,
                )
            },
            doneAt = row.doneAt,
            createdAt = row.record.createdAt,
        )

        /** [row] with the due day, repeat, days, the day it counts from and the reminder time of [due]. */
        fun withDue(row: TaskEntity, due: Due?): TaskEntity = withDates(row, due).copy(remindMinute = due?.remindMinute)

        /** [row] with the due day, repeat, days and the day it counts from of [due]. Its reminder time stays. */
        private fun withDates(row: TaskEntity, due: Due?): TaskEntity = row.copy(
            dueDay = due?.day?.let(::epochDayOf),
            repeat = due?.repeatKind?.code ?: Repeat.ONCE.code,
            weekdays = due?.repeat?.weekdays ?: Weekdays.NONE,
            repeatFrom = due?.repeat?.from?.let(::epochDayOf),
        )

        /**
         * [stored] with what [edit] changes. Should the parts that changed
         * not fit the stored parts, as a reminder time on a task whose due
         * date a restore removed meanwhile, the whole due date of the form
         * is written.
         */
        private fun edited(stored: TaskEntity, edit: TaskEdit): TaskEntity {
            var row = stored.copy(title = edit.title ?: stored.title, listId = edit.listId ?: stored.listId)
            val due = edit.due ?: return row
            if (due.datesChanged) row = withDates(row, due.due)
            if (due.reminderChanged) row = row.copy(remindMinute = due.due?.remindMinute)
            return if (TaskRules.isStored(row)) row else withDue(row, due.due)
        }

        /** True if [a] and [b] have the same due day, repeat, days, day it counts from and reminder time. */
        private fun sameWhen(a: TaskEntity, b: TaskEntity): Boolean =
            a.dueDay == b.dueDay && a.repeat == b.repeat && a.weekdays == b.weekdays && a.repeatFrom == b.repeatFrom && a.remindMinute == b.remindMinute

        private fun stored(row: TaskListEntity): TaskListEntity = row.also {
            require(TaskRules.isStored(it)) { "A list name is 1 to 60 code points on one line, without spaces at either end" }
        }

        private fun stored(row: TaskEntity): TaskEntity = row.also {
            require(TaskRules.isStored(it)) { "A value of the task is outside its limits" }
        }

        /** The moment [now] as a done time, within the times a record can hold. */
        private fun doneAtOf(now: ClockReading): Long = now.millis.coerceIn(0L, RecordTimes.LAST_MILLIS)

        private fun epochDayOf(day: LocalDate): Int = Math.toIntExact(day.toEpochDay())

        private fun dayOf(epochDay: Int): LocalDate = LocalDate.ofEpochDay(epochDay.toLong())
    }
}
