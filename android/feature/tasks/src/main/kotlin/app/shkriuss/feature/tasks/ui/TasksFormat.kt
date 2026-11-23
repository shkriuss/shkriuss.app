package app.shkriuss.feature.tasks.ui

import android.content.res.Resources
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import app.shkriuss.feature.tasks.R
import app.shkriuss.feature.tasks.Repeat
import app.shkriuss.feature.tasks.TaskRow
import java.text.NumberFormat
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.time.temporal.WeekFields
import java.util.Locale

/** Where a task row shows: on Today, or in one list (docs/apps/tasks/spec.md, "Today", point 4, and "A list", point 2). */
enum class RowPlace {
    /** Today: the list's name, the date if overdue, the time and the repeat. */
    TODAY,

    /** One list: the due day, "Today" or its date, the time and the repeat, and no list's name (the owner's decision). */
    LIST,
}

/**
 * Every date, time, repeat and count that Tasks' screens show, and the
 * words TalkBack reads for them (docs/apps/tasks/spec.md, "Screens" and
 * "TalkBack"). Times are in the phone's 12-hour or 24-hour format, dates
 * and the names of the days in its language, and the days of the week
 * start on its first day of the week. A short date leaves out its year
 * when it is this year, as in Reminders; the due date of the form always
 * has it.
 *
 * It is plain code, so the rules are tested without a screen.
 */
class TasksFormat(
    private val resources: Resources,
    private val locale: Locale,
    is24Hour: Boolean,
) {
    private val numbers = NumberFormat.getIntegerInstance(locale)
    private val clock = pattern(if (is24Hour) "Hm" else "hm")
    private val shortDate = pattern("EEEdMMM")
    private val shortDateWithYear = pattern("EEEdMMMy")
    private val spokenDate = pattern("EEEEdMMMM")
    private val spokenDateWithYear = pattern("EEEEdMMMMy")

    /** The seven days of the week from the phone's first day, as the day chips of the form list them. */
    val week: List<DayOfWeek> = WeekFields.of(locale).firstDayOfWeek.let { first -> List(DAYS_PER_WEEK) { first.plus(it.toLong()) } }

    /** [number] in the phone's format: "1,250". */
    fun number(number: Int): String = numbers.format(number.toLong())

    /** A reminder time, in minutes after midnight, in the phone's 12-hour or 24-hour format: "09:00". */
    fun time(minuteOfDay: Int): String = time(LocalTime.of(minuteOfDay / MINUTES_PER_HOUR, minuteOfDay % MINUTES_PER_HOUR))

    /** A time of day in the phone's 12-hour or 24-hour format: "09:00". */
    fun time(time: LocalTime): String = clock.format(time)

    /** The due date of the form, always with its year: "Mon 16 Nov 2026". */
    fun date(date: LocalDate): String = shortDateWithYear.format(date)

    /** A short date, with the year when it is not this year: "Mon 16 Nov", "Fri 1 Jan 2027". */
    fun day(date: LocalDate, today: LocalDate): String = (if (date.year == today.year) shortDate else shortDateWithYear).format(date)

    /** [day] as TalkBack reads it: "Monday 16 November", "Friday 1 January 2027". */
    fun daySpoken(date: LocalDate, today: LocalDate): String =
        (if (date.year == today.year) spokenDate else spokenDateWithYear).format(date)

    /** The name of [repeat] in the form and in a row: "Every week". */
    fun repeatName(repeat: Repeat): String = resources.getString(
        when (repeat) {
            Repeat.ONCE -> R.string.tasks_once
            Repeat.DAILY -> R.string.tasks_every_day
            Repeat.WEEKLY -> R.string.tasks_every_week
            Repeat.MONTHLY -> R.string.tasks_every_month
            Repeat.YEARLY -> R.string.tasks_every_year
        },
    )

    /** [repeatName] as TalkBack reads it in a row: "every week". None for Once. */
    private fun repeatSpoken(repeat: Repeat): String? = when (repeat) {
        Repeat.ONCE -> null
        Repeat.DAILY -> resources.getString(R.string.tasks_every_day_spoken)
        Repeat.WEEKLY -> resources.getString(R.string.tasks_every_week_spoken)
        Repeat.MONTHLY -> resources.getString(R.string.tasks_every_month_spoken)
        Repeat.YEARLY -> resources.getString(R.string.tasks_every_year_spoken)
    }

    /** The short name of [day] on its chip: "Mon". */
    fun dayShort(day: DayOfWeek): String = day.getDisplayName(TextStyle.SHORT, locale)

    /** The whole name of [day], as TalkBack reads its chip: "Monday". */
    fun dayName(day: DayOfWeek): String = day.getDisplayName(TextStyle.FULL, locale)

    /** The line of a repeat in the form: "Dates: Wed 18 Nov, Fri 20 Nov, Mon 23 Nov, ...". Three dates end in "...". */
    fun dates(dates: List<LocalDate>, today: LocalDate): String {
        val listed = joined(dates.map { day(it, today) })
        val shown = if (dates.size >= DATES_SHOWN) resources.getString(R.string.tasks_dates_more, listed) else listed
        return resources.getString(R.string.tasks_dates, shown)
    }

    /**
     * The line under the title of [row] at [place]. Today: "Home · 09:00
     * · Every day", "Inbox · Mon 16 Nov · Every week": the list, the date
     * if overdue, the time and the repeat. A list: "Today · 09:00 · Every
     * day", "Fri 20 Nov · Every week", and none with no due day. A done
     * task: "Done Mon 16 Nov", by the phone's clock.
     */
    fun supporting(row: TaskRow, place: RowPlace, today: LocalDate, doneOn: LocalDate?): String? {
        if (doneOn != null) return resources.getString(R.string.tasks_done_on, day(doneOn, today))
        val due = row.task.due
        val parts = buildList {
            if (place == RowPlace.TODAY) add(listName(row))
            if (due != null) {
                when {
                    place == RowPlace.LIST && due.day == today -> add(resources.getString(R.string.tasks_due_today))
                    place == RowPlace.LIST || due.day < today -> add(day(due.day, today))
                }
                due.remindMinute?.let { add(time(it)) }
                due.repeat?.let { add(repeatName(it.repeat)) }
            }
        }
        return parts.reduceOrNull { line, part -> resources.getString(R.string.tasks_row_parts, line, part) }
    }

    /**
     * What TalkBack reads for [row] at [place], before its state: "Pay
     * rent, due today at 10:00, every month, Home" on Today, "Gym, due
     * Friday 20 November at 18:30, every week" in a list. A done task: its
     * title; [state] says when it was done.
     */
    fun spoken(row: TaskRow, place: RowPlace, today: LocalDate): String {
        val task = row.task
        val due = task.due
        val parts = buildList {
            add(task.title)
            if (task.isOpen && due != null) {
                val time = due.remindMinute?.let(::time)
                add(
                    when {
                        due.day == today && time == null -> resources.getString(R.string.tasks_due_today_spoken)
                        due.day == today -> resources.getString(R.string.tasks_due_today_at_spoken, time)
                        time == null -> resources.getString(R.string.tasks_due_on_spoken, daySpoken(due.day, today))
                        else -> resources.getString(R.string.tasks_due_on_at_spoken, daySpoken(due.day, today), time)
                    },
                )
                repeatSpoken(due.repeatKind)?.let(::add)
            }
            if (place == RowPlace.TODAY) add(listName(row))
        }
        return parts.reduce { line, part -> resources.getString(R.string.tasks_spoken_parts, line, part) }
    }

    /** What TalkBack reads after a row: "not done", or "done on Monday 16 November". */
    fun state(doneOn: LocalDate?, today: LocalDate): String =
        if (doneOn == null) {
            resources.getString(R.string.tasks_not_done_spoken)
        } else {
            resources.getString(R.string.tasks_done_on_spoken, daySpoken(doneOn, today))
        }

    /** The name of the list a row shows in: its own, or "Inbox". */
    fun listName(row: TaskRow): String = row.listName ?: resources.getString(R.string.tasks_inbox)

    /** [items] one after the other: "Mon, Wed, Fri". */
    private fun joined(items: List<String>): String =
        items.reduceOrNull { list, item -> resources.getString(R.string.tasks_list_of_two, list, item) }.orEmpty()

    private fun pattern(skeleton: String): DateTimeFormatter =
        DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, skeleton), locale)

    private companion object {
        const val DAYS_PER_WEEK = 7
        const val MINUTES_PER_HOUR = 60

        /** The form's line shows the first three dates of a repeat. */
        const val DATES_SHOWN = 3
    }
}

/** The [TasksFormat] of the screen: the phone's language and its 12-hour or 24-hour clock. */
@Composable
internal fun rememberTasksFormat(): TasksFormat {
    val resources = LocalResources.current
    val locale = LocalConfiguration.current.locales[0]
    val is24Hour = DateFormat.is24HourFormat(LocalContext.current)
    return remember(resources, locale, is24Hour) { TasksFormat(resources, locale, is24Hour) }
}
