package app.shkriuss.feature.reminders.ui

import android.content.res.Resources
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import app.shkriuss.feature.reminders.R
import app.shkriuss.feature.reminders.Repeat
import app.shkriuss.feature.reminders.Schedule
import app.shkriuss.feature.reminders.Weekdays
import java.text.NumberFormat
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.time.temporal.WeekFields
import java.util.Locale

/**
 * Every date, time, repeat and count that Reminders' screens show, and
 * the words TalkBack reads for them (docs/apps/reminders/spec.md,
 * "Screens" and "TalkBack"). Times are in the phone's 12-hour or 24-hour
 * format, dates and the names of the days in its language, and the days
 * of the week start on its first day of the week. A date leaves out its
 * year when it is this year.
 *
 * It is plain code, so the rules are tested without a screen.
 */
class RemindersFormat(
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
    private val longDate = DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale)

    /** The seven days of the week from the phone's first day, as the day chips of the form and the rows list them. */
    val week: List<DayOfWeek> = WeekFields.of(locale).firstDayOfWeek.let { first -> List(DAYS_PER_WEEK) { first.plus(it.toLong()) } }

    /** [number] in the phone's format: "1,250". */
    fun number(number: Int): String = numbers.format(number.toLong())

    /** How many reminders a backup holds, in the phone's number format, for the plurals of the backup dialogs: "1,250". */
    fun count(count: Long): String = numbers.format(count)

    /**
     * When a backup was made, in the phone's long date format and its
     * clock, for the question before a restore: "16 November 2026, 14:05".
     */
    fun madeAt(at: LocalDateTime): String =
        resources.getString(R.string.reminders_made_at, longDate.format(at), clock.format(at.toLocalTime()))

    /** A time of day in the phone's 12-hour or 24-hour format: "09:00". */
    fun time(time: LocalTime): String = clock.format(time)

    /** The date row of the form, always with its year: "Mon 16 Nov 2026". */
    fun date(date: LocalDate): String = shortDateWithYear.format(date)

    /**
     * A date and its time, with the year when it is not this year: "Wed
     * 18 Nov, 18:30". A row of Past, the line "Next" of the form and the
     * snackbar after a Save say it so.
     */
    fun dateTime(at: LocalDateTime, today: LocalDate): String =
        resources.getString(R.string.reminders_date_at, dayOf(at.toLocalDate(), today), time(at.toLocalTime()))

    /** [dateTime] as TalkBack reads it: "Wednesday 18 November at 18:30". */
    fun dateTimeSpoken(at: LocalDateTime, today: LocalDate): String =
        resources.getString(R.string.reminders_date_at_spoken, spokenDayOf(at.toLocalDate(), today), time(at.toLocalTime()))

    /** When an upcoming reminder shows next: "Today, 09:00", "Tomorrow, 09:00", or "Wed 18 Nov, 18:30". */
    fun next(at: LocalDateTime, today: LocalDate): String = when (at.toLocalDate()) {
        today -> resources.getString(R.string.reminders_today_at, time(at.toLocalTime()))
        today.plusDays(1) -> resources.getString(R.string.reminders_tomorrow_at, time(at.toLocalTime()))
        else -> dateTime(at, today)
    }

    /** [next] as TalkBack reads it: "today at 09:00", "tomorrow at 09:00", "Wednesday 18 November at 18:30". */
    fun nextSpoken(at: LocalDateTime, today: LocalDate): String = when (at.toLocalDate()) {
        today -> resources.getString(R.string.reminders_today_at_spoken, time(at.toLocalTime()))
        today.plusDays(1) -> resources.getString(R.string.reminders_tomorrow_at_spoken, time(at.toLocalTime()))
        else -> dateTimeSpoken(at, today)
    }

    /**
     * The time alone today, "09:12", or [dateTime] on another day, "Mon 16
     * Nov, 09:00". The end of a snooze in a row of Upcoming, and the time
     * in "Missed: 09:00" and "Snoozed. It was due at 09:00." of a
     * notification, say it so.
     */
    fun timeOrDateTime(at: LocalDateTime, today: LocalDate): String =
        if (at.toLocalDate() == today) time(at.toLocalTime()) else dateTime(at, today)

    /** When a snooze ends: the time alone today, "09:12", or [dateTime] on another day. */
    fun snoozeEnd(at: LocalDateTime, today: LocalDate): String = timeOrDateTime(at, today)

    /** [snoozeEnd] as TalkBack reads it. */
    fun snoozeEndSpoken(at: LocalDateTime, today: LocalDate): String =
        if (at.toLocalDate() == today) time(at.toLocalTime()) else dateTimeSpoken(at, today)

    /** The name of [repeat] in the form: "Every week". */
    fun repeatName(repeat: Repeat): String = resources.getString(
        when (repeat) {
            Repeat.ONCE -> R.string.reminders_once
            Repeat.DAILY -> R.string.reminders_every_day
            Repeat.WEEKLY -> R.string.reminders_every_week
            Repeat.MONTHLY -> R.string.reminders_every_month
            Repeat.YEARLY -> R.string.reminders_every_year
        },
    )

    /** The repeat of [schedule] in a row: "Every day", "Mon, Wed, Fri". None for Once. */
    fun repeat(schedule: Schedule): String? = when (schedule.repeat) {
        Repeat.ONCE -> null
        Repeat.WEEKLY -> days(schedule.weekdays, ::dayShort)
        else -> repeatName(schedule.repeat)
    }

    /**
     * The repeat of [schedule] in the text of its notification, on time:
     * "Every day", "Every Mon, Wed, Fri", "Every month", "Every year".
     * None for Once (docs/apps/reminders/spec.md, "The notification").
     */
    fun repeatOfNotification(schedule: Schedule): String? = when (schedule.repeat) {
        Repeat.WEEKLY -> resources.getString(R.string.reminders_every_days, days(schedule.weekdays, ::dayShort))
        else -> repeat(schedule)
    }

    /** [repeat] as TalkBack reads it: "every day", "Monday, Wednesday, Friday". */
    fun repeatSpoken(schedule: Schedule): String? = when (schedule.repeat) {
        Repeat.ONCE -> null
        Repeat.DAILY -> resources.getString(R.string.reminders_every_day_spoken)
        Repeat.WEEKLY -> days(schedule.weekdays, ::dayName)
        Repeat.MONTHLY -> resources.getString(R.string.reminders_every_month_spoken)
        Repeat.YEARLY -> resources.getString(R.string.reminders_every_year_spoken)
    }

    /** The short name of [day] on its chip: "Mon". */
    fun dayShort(day: DayOfWeek): String = day.getDisplayName(TextStyle.SHORT, locale)

    /** The whole name of [day], as TalkBack reads its chip: "Monday". */
    fun dayName(day: DayOfWeek): String = day.getDisplayName(TextStyle.FULL, locale)

    /**
     * The days of [weekdays], from the phone's first day of the week, each
     * named by [name], one after the other. A stored Every week always has
     * a day (table `reminder`), so the empty text is never shown.
     */
    private fun days(weekdays: Int, name: (DayOfWeek) -> String): String =
        week.filter { Weekdays.has(weekdays, it) }
            .map(name)
            .reduceOrNull { list, day -> resources.getString(R.string.reminders_day_list, list, day) }
            .orEmpty()

    private fun dayOf(date: LocalDate, today: LocalDate): String =
        (if (date.year == today.year) shortDate else shortDateWithYear).format(date)

    private fun spokenDayOf(date: LocalDate, today: LocalDate): String =
        (if (date.year == today.year) spokenDate else spokenDateWithYear).format(date)

    private fun pattern(skeleton: String): DateTimeFormatter =
        DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, skeleton), locale)

    private companion object {
        const val DAYS_PER_WEEK = 7
    }
}

/** The [RemindersFormat] of the screen: the phone's language and its 12-hour or 24-hour clock. */
@Composable
internal fun rememberRemindersFormat(): RemindersFormat {
    val resources = LocalResources.current
    val locale = LocalConfiguration.current.locales[0]
    val is24Hour = DateFormat.is24HourFormat(LocalContext.current)
    return remember(resources, locale, is24Hour) { RemindersFormat(resources, locale, is24Hour) }
}
