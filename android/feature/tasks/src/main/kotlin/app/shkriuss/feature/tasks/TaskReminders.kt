package app.shkriuss.feature.tasks

import app.shkriuss.core.data.isDeleted
import app.shkriuss.feature.tasks.data.TaskEntity
import java.time.LocalDateTime

/**
 * The reminder of a task (docs/apps/tasks/spec.md, "Reminders of a
 * task"). A task has a reminder when it is open and has a due day and a
 * reminder time. A done or deleted task has none.
 */
object TaskReminders {
    /** The highest reminder number: (2,932,896 × 8 + 4) × 1440 + 1439, for 9999-12-31, every year, at 23:59. */
    const val MOST_NUMBER: Long = 33_786_969_119L

    /**
     * The **reminder number** of [task]: (due day × 8 + `repeat`) × 1440 +
     * the reminder time in minutes, or null for a task with no reminder.
     * A change of the due day, the repeat or the time changes it, so the
     * entries of the phone-only file that were written for the old one
     * count as missing (point 4).
     */
    fun numberOf(task: Task): Long? = if (task.isOpen) task.due?.let(::numberOf) else null

    /** The reminder number of the stored [row], or null: also for a row that is deleted. */
    fun numberOf(row: TaskEntity): Long? {
        if (row.record.isDeleted || row.doneAt != null) return null
        val day = row.dueDay ?: return null
        val minute = row.remindMinute ?: return null
        return numberOf(day.toLong(), row.repeat, minute)
    }

    /** The reminder number of [due], as if its task were open, or null with no reminder time. */
    fun numberOf(due: Due): Long? = due.remindMinute?.let { numberOf(due.day.toEpochDay(), due.repeatKind.code, it) }

    /**
     * The **reminder moment** of [due]: the due day at the reminder time,
     * in the phone's time zone now, as a local minute. Its moment is
     * [ClockReading.millisOf]: a time that does not exist moves later by
     * the jump, and a time that happens twice is the first. Null with no
     * reminder time.
     */
    fun momentOf(due: Due): LocalDateTime? = due.remindMinute?.let { due.day.atStartOfDay().plusMinutes(it.toLong()) }

    private fun numberOf(day: Long, repeat: Int, minute: Int): Long = (day * REPEATS + repeat) * MINUTES_PER_DAY + minute

    /** The spec's factor for `repeat`: room for eight values, of which five are used. */
    private const val REPEATS = 8L

    private const val MINUTES_PER_DAY = 1_440L
}
