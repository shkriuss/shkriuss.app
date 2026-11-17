package app.shkriuss.feature.reminders

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime

/** How often a reminder shows (docs/apps/reminders/spec.md, "Occurrences"). [code] is the value of `reminder.repeat`. */
enum class Repeat(val code: Int) {
    /** Once, on its date. */
    ONCE(0),

    /** Every day from its date on. */
    DAILY(1),

    /** Every chosen day of the week from its date on. */
    WEEKLY(2),

    /** Every month on the day of the month of its date, or on the last day of a shorter month. */
    MONTHLY(3),

    /** Every year on the month and day of its date. 29 February falls on 28 February in a year without it. */
    YEARLY(4),
    ;

    /** Finds a repeat by its stored value. */
    companion object {
        /** The repeat stored as [code], or null for a value no version knows. */
        fun ofCode(code: Int): Repeat? = entries.firstOrNull { it.code == code }
    }
}

/**
 * The days of the week of an Every week reminder, as the bits of
 * `reminder.weekdays`: Monday 1, Tuesday 2, Wednesday 4, Thursday 8,
 * Friday 16, Saturday 32, Sunday 64.
 */
object Weekdays {
    /** No day: the value of every repeat but Every week. */
    const val NONE: Int = 0

    /** Every day of the week. */
    const val ALL: Int = 127

    /** The bit of [day]. */
    fun bitOf(day: DayOfWeek): Int = 1 shl (day.value - 1)

    /** The bits of [days]. */
    fun of(vararg days: DayOfWeek): Int = days.fold(NONE) { bits, day -> bits or bitOf(day) }

    /** True if [weekdays] has [day]. */
    fun has(weekdays: Int, day: DayOfWeek): Boolean = weekdays and bitOf(day) != 0

    /** [weekdays] with [day] chosen or not. */
    fun with(weekdays: Int, day: DayOfWeek, chosen: Boolean): Int =
        if (chosen) weekdays or bitOf(day) else weekdays and bitOf(day).inv()
}

/**
 * When a reminder shows: its repeat, its date, its time and, for Every
 * week, its days (the columns `repeat`, `day`, `minuteOfDay` and
 * `weekdays` of table `reminder`). All of it is the phone's local time.
 */
data class Schedule(
    /** How often it shows. */
    val repeat: Repeat,
    /** Once: the date. A repeat: the date it starts from. */
    val date: LocalDate,
    /** The time, in minutes after midnight, 0 to 1439. */
    val minuteOfDay: Int,
    /** Every week: the days ([Weekdays]), 1 to 127. Any other repeat: 0. */
    val weekdays: Int = Weekdays.NONE,
) {
    /** The time as a [LocalTime]. */
    val time: LocalTime
        get() = LocalTime.of(minuteOfDay / MINUTES_PER_HOUR, minuteOfDay % MINUTES_PER_HOUR)

    private companion object {
        const val MINUTES_PER_HOUR = 60
    }
}
