package app.shkriuss.feature.tasks

import app.shkriuss.core.data.isDeleted
import app.shkriuss.feature.tasks.data.TaskEntity
import java.time.LocalDateTime

/**
 * Where the one alarm of a task is, and why (docs/apps/tasks/spec.md,
 * "Reminders of a task", point 2). [atMillis] is its moment, in
 * milliseconds since 1970 UTC.
 */
sealed interface TaskAlarm {
    /** The moment of the alarm. */
    val atMillis: Long

    /** Rule 1: the reminder moment is pending and has passed, so it shows late. */
    data class Due(override val atMillis: Long) : TaskAlarm

    /** Rule 2: the end of a snooze, earlier than a pending moment. It counts also when it has passed. */
    data class Snooze(override val atMillis: Long) : TaskAlarm

    /** Rule 3: the pending reminder moment, still to come. */
    data class Next(override val atMillis: Long) : TaskAlarm
}

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

    /** The reminder moment of [task], as a local minute, or null if it has no reminder: also when it is done. */
    fun momentOf(task: Task): LocalDateTime? = if (task.isOpen) task.due?.let(::momentOf) else null

    /**
     * The mark the rule uses now, as in Reminders: **the mark never stays
     * later than now** (docs/apps/reminders/spec.md, "The mark", point 3).
     * A mark whose moment is later than now, because the clock was set
     * back or the phone moved to a zone further west, counts as the
     * current minute. So does no mark at all. The moment of a mark is
     * found as for a reminder moment: of a time that happens twice it is
     * the first, so in the hour that happens twice the mark stays.
     */
    fun markNow(stored: LocalDateTime?, now: ClockReading): LocalDateTime =
        if (stored == null || now.millisOf(stored) > now.millis) now.currentMinute else stored

    /**
     * The one alarm of a task's reminder at [moment], with the mark
     * [mark] and the snooze [snoozeMillis], now, or null for none
     * (docs/apps/tasks/spec.md, "Reminders of a task", point 2). It is
     * Reminders' rule for a **one-time reminder**, with the moment as its
     * one occurrence, pending while it is later than the mark:
     *
     * 1. **Due first.** A pending moment that is at or before now: the
     *    alarm is then, so it fires within seconds, late.
     * 2. **Then a snooze.** Otherwise, the end of a snooze, or the pending
     *    moment, whichever is earlier. The end counts also when it has
     *    passed.
     * 3. **Then the next.** Otherwise, the pending moment.
     * 4. With neither, no alarm: the reminder is dealt with.
     */
    fun alarmOf(moment: LocalDateTime, mark: LocalDateTime, snoozeMillis: Long?, now: ClockReading): TaskAlarm? {
        val pending = moment > mark
        val atMillis = now.millisOf(moment)
        if (pending && atMillis <= now.millis) return TaskAlarm.Due(atMillis)
        val next = if (pending) TaskAlarm.Next(atMillis) else null
        if (snoozeMillis != null && (next == null || snoozeMillis <= next.atMillis)) return TaskAlarm.Snooze(snoozeMillis)
        return next
    }

    /**
     * The alarm of [task], whose entry on this phone is [entry], now, or
     * null for none: also for a task with no reminder. [entry] counts only
     * if it was written for the task's reminder number now.
     */
    fun alarmOf(task: Task, entry: TaskEntry?, now: ClockReading): TaskAlarm? {
        val moment = momentOf(task) ?: return null
        val counted = TaskBook.countingEntry(entry, numberOf(task))
        return alarmOf(moment, markNow(counted.mark, now), counted.snoozeMillis, now)
    }

    private fun numberOf(day: Long, repeat: Int, minute: Int): Long = (day * REPEATS + repeat) * MINUTES_PER_DAY + minute

    /** The spec's factor for `repeat`: room for eight values, of which five are used. */
    private const val REPEATS = 8L

    private const val MINUTES_PER_DAY = 1_440L
}
