package app.shkriuss.feature.reminders

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.Year
import java.time.YearMonth

/**
 * The local dates and times that a [Schedule] gives, its occurrences
 * (docs/apps/reminders/spec.md, "Occurrences"). They are found with date
 * arithmetic from the time asked about, never by stepping day by day from
 * the schedule's date: a reminder that starts in 1970 or in 9999 costs the
 * same as one from today. Every week looks at most at eight days, every
 * month and every year at most at two months or years.
 *
 * Times here are local, as the phone's clock shows them. Where a time
 * falls as a moment is for [ReminderRule].
 */
object Occurrences {
    /** The first occurrence of [schedule] later than [after], or null if there is none. */
    fun firstAfter(schedule: Schedule, after: LocalDateTime): LocalDateTime? {
        val time = schedule.time
        return when (schedule.repeat) {
            Repeat.ONCE -> schedule.date.atTime(time).takeIf { it > after }
            Repeat.DAILY -> {
                val from = maxOf(schedule.date, after.toLocalDate())
                from.atTime(time).takeIf { it > after } ?: from.plusDays(1).atTime(time)
            }
            Repeat.WEEKLY -> {
                val from = maxOf(schedule.date, after.toLocalDate())
                (0L..DAYS_PER_WEEK).map { from.plusDays(it).atTime(time) }
                    .firstOrNull { Weekdays.has(schedule.weekdays, it.dayOfWeek) && it > after }
            }
            Repeat.MONTHLY -> {
                val from = maxOf(YearMonth.from(schedule.date), YearMonth.from(after))
                listOf(from, from.plusMonths(1)).map { inMonth(schedule, it) }.first { it > after }
            }
            Repeat.YEARLY -> {
                val from = maxOf(schedule.date.year, after.year)
                listOf(from, from + 1).map { inYear(schedule, it) }.first { it > after }
            }
        }
    }

    /** The last occurrence of [schedule] at or before [at], or null if there is none. */
    fun latestAtOrBefore(schedule: Schedule, at: LocalDateTime): LocalDateTime? {
        val time = schedule.time
        val start = schedule.date.atTime(time)
        if (at < start) return null
        return when (schedule.repeat) {
            Repeat.ONCE -> start
            Repeat.DAILY -> at.toLocalDate().atTime(time).takeIf { it <= at } ?: at.toLocalDate().minusDays(1).atTime(time)
            Repeat.WEEKLY ->
                (0L..DAYS_PER_WEEK).map { at.toLocalDate().minusDays(it) }
                    .takeWhile { it >= schedule.date }
                    .map { it.atTime(time) }
                    .firstOrNull { Weekdays.has(schedule.weekdays, it.dayOfWeek) && it <= at }
            Repeat.MONTHLY -> {
                val last = YearMonth.from(at)
                listOf(last, last.minusMonths(1)).map { inMonth(schedule, it) }.first { it <= at }
            }
            Repeat.YEARLY -> listOf(at.year, at.year - 1).map { inYear(schedule, it) }.first { it <= at }
        }
    }

    /** The occurrence of an Every month [schedule] in [month]: its day of the month, or the month's last day. */
    private fun inMonth(schedule: Schedule, month: YearMonth): LocalDateTime =
        dayIn(month, schedule.date.dayOfMonth).atTime(schedule.time)

    /** The occurrence of an Every year [schedule] in [year]: its month and day, or the month's last day. */
    private fun inYear(schedule: Schedule, year: Int): LocalDateTime =
        dayIn(Year.of(year).atMonth(schedule.date.month), schedule.date.dayOfMonth).atTime(schedule.time)

    private fun dayIn(month: YearMonth, dayOfMonth: Int): LocalDate = month.atDay(minOf(dayOfMonth, month.lengthOfMonth()))

    /** Eight days, from the day asked about, hold every weekday once and the same weekday a week later. */
    private const val DAYS_PER_WEEK = 7L
}
