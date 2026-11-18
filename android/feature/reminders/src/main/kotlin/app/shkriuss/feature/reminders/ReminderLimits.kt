package app.shkriuss.feature.reminders

import java.time.LocalDate

/** The limits of docs/apps/reminders/spec.md: of a title, a schedule and the number of reminders. */
object ReminderLimits {
    /** The form adds no reminder while this many are not deleted (spec, "The reminder form", point 4). */
    const val MOST_REMINDERS: Int = 500

    /** The longest title, in Unicode code points. */
    const val MOST_TITLE_CODE_POINTS: Int = 200

    /** The longest title in UTF-8: at most four bytes for each of 200 code points. */
    const val MOST_TITLE_BYTES: Int = 800

    /** The days `reminder.day` can hold: 1970-01-01, day 0, to 9999-12-31. */
    val DAYS: IntRange = 0..2_932_896

    /** The last minute of a day, 23:59. */
    const val LAST_MINUTE: Int = 1_439

    /** The last date the form's date picker offers. The first is today. */
    val LAST_PICKER_DATE: LocalDate = LocalDate.of(2100, 12, 31)
}

/** Why a title is refused: the words under the field. */
enum class TitleProblem {
    /** "Enter a title." */
    EMPTY,

    /** "A title has at most 200 characters." */
    TOO_LONG,
}

/**
 * A title: 1 to 200 code points, one line, with no space at either end
 * (spec, "The reminder form", point 1, and table `reminder`).
 */
object TitleRules {
    /** The title of what the user typed: without the spaces at either end. */
    fun clean(typed: String): String = typed.trim()

    /** [typed] on one line: each line break becomes a space. The title field has one line. */
    fun oneLine(typed: String): String =
        buildString(typed.length) { typed.forEach { append(if (it in LINE_BREAKS) ' ' else it) } }

    /** Why the title of [typed] is refused, or null if it is not. */
    fun problemOf(typed: String): TitleProblem? {
        val title = clean(oneLine(typed))
        return when {
            title.isEmpty() -> TitleProblem.EMPTY
            title.codePointCount(0, title.length) > ReminderLimits.MOST_TITLE_CODE_POINTS -> TitleProblem.TOO_LONG
            else -> null
        }
    }

    /** True if [title] is a title as it is stored: within its limits, on one line, without spaces at either end. */
    fun isStored(title: String): Boolean =
        title == clean(title) && title.none { it in LINE_BREAKS } && problemOf(title) == null

    /** The characters that end a line. */
    private val LINE_BREAKS = setOf('\n', '\r', '\u000B', '\u000C', '\u0085', '\u2028', '\u2029')
}

/** The limits of a [Schedule], as table `reminder` has them. */
object ScheduleRules {
    /** True if [schedule] can be stored. */
    fun isValid(schedule: Schedule): Boolean =
        schedule.date.toEpochDay() in ReminderLimits.DAYS.first.toLong()..ReminderLimits.DAYS.last.toLong() &&
            schedule.minuteOfDay in 0..ReminderLimits.LAST_MINUTE &&
            weekdaysAllowed(schedule.repeat, schedule.weekdays)

    /** True if [weekdays] go with [repeat]: 1 to 127 for every week, else 0. */
    fun weekdaysAllowed(repeat: Repeat, weekdays: Int): Boolean =
        if (repeat == Repeat.WEEKLY) weekdays in 1..Weekdays.ALL else weekdays == Weekdays.NONE
}
