package app.shkriuss.feature.tasks

import java.text.Collator
import java.time.LocalDate
import java.util.Locale

/** One row of a task, on Today or in a list. */
data class TaskRow(
    /** The task. */
    val task: Task,
    /** The name of its list, or null for Inbox: also for a list that is deleted or not stored. */
    val listName: String?,
)

/** One row of Lists: Inbox, or a list, with its count of open tasks: "4 open". */
data class ListRow(
    /** The list, or null for Inbox. */
    val list: TaskList?,
    /** How many open tasks are in it. */
    val openCount: Int,
) {
    /** The `listId` its tasks have: the list's `id`, or [INBOX]. */
    val listId: String
        get() = list?.id ?: INBOX
}

/** The two sections of Today. */
data class TodaySections(
    /** Open tasks with a due day before today: oldest first. */
    val overdue: List<TaskRow>,
    /** Open tasks due today. */
    val dueToday: List<TaskRow>,
)

/** The two parts of one list. */
data class ListSections(
    /** The open tasks: those with a due day first, by due day, then those with none, oldest first. */
    val open: List<TaskRow>,
    /** Section Done: the last one done first. */
    val done: List<TaskRow>,
)

/**
 * Which tasks each screen shows, and in which order
 * (docs/apps/tasks/spec.md, "Screens"). A task whose `listId` names a
 * list that is deleted or not stored shows in Inbox (spec, "Data", point
 * 2).
 */
object TaskOrder {
    /**
     * Today's two sections, for [today]. Within a day: tasks with a
     * reminder first, by time, then the others, oldest first. Ties:
     * `createdAt`, then `id`.
     */
    fun today(tasks: List<Task>, lists: List<TaskList>, today: LocalDate): TodaySections {
        val names = lists.associate { it.id to it.name }
        val open = tasks.filter { it.isOpen && it.due != null }.sortedWith(BY_DUE_DAY)
        return TodaySections(
            overdue = open.filter { checkNotNull(it.due).day < today }.map { TaskRow(it, names[it.listId]) },
            dueToday = open.filter { checkNotNull(it.due).day == today }.map { TaskRow(it, names[it.listId]) },
        )
    }

    /**
     * The tasks of the list [listId], or of Inbox for [INBOX]. The open
     * ones: those with a due day first, by due day, then by reminder time,
     * those without one last; then those with no due day, oldest first.
     * Ties: `createdAt`, then `id`. The done ones: the last one done first.
     */
    fun inList(tasks: List<Task>, lists: List<TaskList>, listId: String): ListSections {
        val names = lists.associate { it.id to it.name }
        val rows = tasks.filter { listIdShown(it, names.keys) == listId }
        return ListSections(
            open = rows.filter { it.isOpen }.sortedWith(BY_DUE_DAY).map { TaskRow(it, names[it.listId]) },
            done = rows.filterNot { it.isOpen }.sortedWith(BY_DONE).map { TaskRow(it, names[it.listId]) },
        )
    }

    /**
     * The rows of Lists: Inbox first, then each list by name, in the
     * language order of [locale]. Ties: `createdAt`, then `id`. Two lists
     * may have the same name.
     */
    fun lists(tasks: List<Task>, lists: List<TaskList>, locale: Locale = Locale.getDefault()): List<ListRow> {
        val ids = lists.mapTo(HashSet()) { it.id }
        val open = tasks.filter { it.isOpen }.groupingBy { listIdShown(it, ids) }.eachCount()
        return listOf(ListRow(null, open[INBOX] ?: 0)) + byName(lists, locale).map { ListRow(it, open[it.id] ?: 0) }
    }

    /** [lists] by name in the language order of [locale], as Lists shows them and the form's list dialog. */
    fun byName(lists: List<TaskList>, locale: Locale = Locale.getDefault()): List<TaskList> {
        val collator = Collator.getInstance(locale)
        return lists.sortedWith(compareBy<TaskList, String>(collator) { it.name }.thenBy { it.createdAt }.thenBy { it.id })
    }

    /** The list [task] shows in: its own while it is among [liveIds], else Inbox. */
    fun listIdShown(task: Task, liveIds: Set<String>): String = if (task.listId in liveIds) task.listId else INBOX

    /** Due day first, those without one last; within a day a reminder first, by time, those without one last; then the oldest. */
    private val BY_DUE_DAY: Comparator<Task> = compareBy<Task, LocalDate?>(nullsLast()) { it.due?.day }
        .thenBy(nullsLast()) { it.due?.remindMinute }
        .thenBy { it.createdAt }
        .thenBy { it.id }

    /** The last one done first. Ties: `createdAt`, then `id`. */
    private val BY_DONE: Comparator<Task> = compareByDescending<Task> { it.doneAt }
        .thenBy { it.createdAt }
        .thenBy { it.id }
}
