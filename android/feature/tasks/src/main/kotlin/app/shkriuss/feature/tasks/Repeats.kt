package app.shkriuss.feature.tasks

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.Year
import java.time.YearMonth

/** How often a task comes due (docs/apps/tasks/spec.md, "Repeats"). [code] is the value of `task.repeat`. */
enum class Repeat(val code: Int) {
    /** Once: no repeat. */
    ONCE(0),

    /** Every day. */
    DAILY(1),

    /** Every chosen day of the week. */
    WEEKLY(2),

    /** Every month on the day of the month it counts from, or on the last day of a shorter month. */
    MONTHLY(3),

    /** Every year on the month and day it counts from. 29 February falls on 28 February in a year without it. */
    YEARLY(4),
    ;

    /** Finds a repeat by its stored value. */
    companion object {
        /** The repeat stored as [code], or null for a value no version knows. */
        fun ofCode(code: Int): Repeat? = entries.firstOrNull { it.code == code }
    }
}

/**
 * The days of the week of an Every week task, as the bits of
 * `task.weekdays`: Monday 1, Tuesday 2, Wednesday 4, Thursday 8, Friday
 * 16, Saturday 32, Sunday 64, as in Reminders.
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
 * The repeat of a task: how often, the day it counts from (`repeatFrom`)
 * and, for Every week, the days. Its **dates** are Reminders'
 * occurrences with [from] in place of the reminder's date
 * (docs/apps/tasks/spec.md, "Repeats", point 1): each day, each chosen
 * weekday, the same day of each month (the last day of a shorter month),
 * or the same day of each year (28 February for 29 February), from
 * [from] on. [repeat] is never [Repeat.ONCE].
 */
data class TaskRepeat(
    /** How often. Not [Repeat.ONCE]. */
    val repeat: Repeat,
    /** The day the repeat counts from: its first date, or the day before it for Every week. */
    val from: LocalDate,
    /** Every week: the days ([Weekdays]), 1 to 127. Any other repeat: 0. */
    val weekdays: Int = Weekdays.NONE,
) {
    init {
        require(repeat != Repeat.ONCE) { "Once is no repeat" }
    }
}

/**
 * The dates of a [TaskRepeat], found with date arithmetic from the day
 * asked about, never day by day from [TaskRepeat.from]
 * (docs/apps/tasks/spec.md, "Repeats", point 4): a repeat from 1970 costs
 * the same as one from today. Every week looks at most at seven days,
 * every month and every year at most at two months or years. No date is
 * later than [TaskLimits.LAST_DAY], 9999-12-31.
 */
object RepeatDates {
    /** The first date of [repeat] on or after [day], or null if there is none up to 9999-12-31. */
    fun firstOnOrAfter(repeat: TaskRepeat, day: LocalDate): LocalDate? {
        val start = maxOf(repeat.from, day)
        val date = when (repeat.repeat) {
            Repeat.ONCE -> error("Once is no repeat")
            Repeat.DAILY -> start
            Repeat.WEEKLY -> (0L until DAYS_PER_WEEK).map { start.plusDays(it) }.firstOrNull { Weekdays.has(repeat.weekdays, it.dayOfWeek) }
            Repeat.MONTHLY -> {
                val month = YearMonth.from(start)
                listOf(month, month.plusMonths(1)).map { dayIn(it, repeat.from.dayOfMonth) }.first { it >= start }
            }
            Repeat.YEARLY -> listOf(start.year, start.year + 1).map { inYear(repeat, it) }.first { it >= start }
        }
        return date?.takeIf { it <= TaskLimits.LAST_DAY }
    }

    /** The first date of [repeat] later than [day], or null if there is none up to 9999-12-31. */
    fun firstAfter(repeat: TaskRepeat, day: LocalDate): LocalDate? =
        if (day >= TaskLimits.LAST_DAY) null else firstOnOrAfter(repeat, day.plusDays(1))

    /** The first [count] dates of [repeat] on or after [day]: fewer if the repeat ends at 9999-12-31 first. */
    fun datesFrom(repeat: TaskRepeat, day: LocalDate, count: Int): List<LocalDate> = buildList {
        var next = firstOnOrAfter(repeat, day)
        while (next != null && size < count) {
            add(next)
            next = firstAfter(repeat, next)
        }
    }

    /** True if [day] is one of the dates of [repeat]. */
    fun isDateOf(repeat: TaskRepeat, day: LocalDate): Boolean = day >= repeat.from && firstOnOrAfter(repeat, day) == day

    /** The date of an Every year [repeat] in [year]: its month and day, or the month's last day. */
    private fun inYear(repeat: TaskRepeat, year: Int): LocalDate =
        dayIn(Year.of(year).atMonth(repeat.from.month), repeat.from.dayOfMonth)

    private fun dayIn(month: YearMonth, dayOfMonth: Int): LocalDate = month.atDay(minOf(dayOfMonth, month.lengthOfMonth()))

    /** Seven days, from the day asked about, hold every weekday once. */
    private const val DAYS_PER_WEEK = 7L
}
