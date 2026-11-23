package app.shkriuss.feature.tasks

import java.time.LocalDate
import java.time.LocalTime

/** The `listId` of a task in Inbox, the fixed list of tasks that are in no list. Inbox is no record. */
const val INBOX: String = ""

/**
 * When a task is due: its due day, its repeat if it has one, and its
 * reminder time if it has one. A task with no due day has none of the
 * three (table `task`: `repeat` is 0 and `remindMinute` null when
 * `dueDay` is null).
 */
data class Due(
    /** The due day: a local date. */
    val day: LocalDate,
    /** The repeat, or null for once. With a repeat, [day] is one of its dates. */
    val repeat: TaskRepeat? = null,
    /** The reminder time, in minutes after midnight, 0 to 1439, or null for no reminder. */
    val remindMinute: Int? = null,
) {
    /** How often: [Repeat.ONCE] without a repeat. */
    val repeatKind: Repeat
        get() = repeat?.repeat ?: Repeat.ONCE

    /** The reminder time as a [LocalTime], or null. */
    val remindTime: LocalTime?
        get() = remindMinute?.let { LocalTime.of(it / MINUTES_PER_HOUR, it % MINUTES_PER_HOUR) }

    private companion object {
        const val MINUTES_PER_HOUR = 60
    }
}

/** One task, as the screens show it. */
data class Task(
    /** The record's ID. */
    val id: String,
    /** The `id` of its list as stored, or [INBOX]. It may name a list that is deleted or not stored: then the task shows in Inbox. */
    val listId: String,
    /** The title. */
    val title: String,
    /** When it is due, or null for no due day. */
    val due: Due?,
    /** When it was done, in milliseconds since 1970 UTC, or null while it is open. */
    val doneAt: Long?,
    /** When it was created, in milliseconds since 1970 UTC. Of two at the same moment, the one with the lower `id` comes first. */
    val createdAt: Long,
) {
    /** True while it is not ticked. */
    val isOpen: Boolean
        get() = doneAt == null
}

/** One list that the user made, as the screens show it. Inbox is none of them. */
data class TaskList(
    /** The record's ID. */
    val id: String,
    /** The name. */
    val name: String,
    /** When it was created, in milliseconds since 1970 UTC. */
    val createdAt: Long,
)

/** What a new task holds, from the form. */
data class NewTask(
    /** The title, as stored: within its limits, on one line, without spaces at either end. */
    val title: String,
    /** The list, or [INBOX]. */
    val listId: String,
    /** When it is due, or null. */
    val due: Due?,
)
