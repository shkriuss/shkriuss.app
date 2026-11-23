package app.shkriuss.feature.tasks

import app.shkriuss.core.data.RecordTimes
import app.shkriuss.feature.tasks.data.TaskEntity
import app.shkriuss.feature.tasks.data.TaskListEntity
import java.time.LocalDate

/** The limits of docs/apps/tasks/spec.md: of a title, a name, a stored value and the number of tasks and lists. */
object TaskLimits {
    /** The form adds no task while this many are not deleted (spec, "The task form", rule 4). A restore can bring more. */
    const val MOST_TASKS: Int = 5_000

    /** **New list** adds no list while this many are not deleted. A restore can bring more. */
    const val MOST_LISTS: Int = 100

    /** The longest title, in Unicode code points. */
    const val MOST_TITLE_CODE_POINTS: Int = 200

    /** The longest list name, in Unicode code points. */
    const val MOST_NAME_CODE_POINTS: Int = 60

    /** The days `task.dueDay` and `task.repeatFrom` can hold: 1970-01-01, day 0, to 9999-12-31. */
    val DAYS: IntRange = 0..2_932_896

    /** The last day a task can be due: 9999-12-31. */
    val LAST_DAY: LocalDate = LocalDate.ofEpochDay(DAYS.last.toLong())

    /** The last minute of a day, 23:59. */
    const val LAST_MINUTE: Int = 1_439

    /** The last date the form's date picker offers. The first is today. */
    val LAST_PICKER_DATE: LocalDate = LocalDate.of(2100, 12, 31)
}

/** Why a title or a name is refused: the words under the field. */
enum class TextProblem {
    /** "Enter a title." or "Enter a name." */
    EMPTY,

    /** "A title has at most 200 characters." or "A name has at most 60 characters." */
    TOO_LONG,
}

/**
 * A line of text the user types, a title or a list name: 1 to
 * [mostCodePoints] code points, one line, with no space at either end
 * (spec, "The task form", rules 1 and 4, and the tables).
 */
class TextRules(private val mostCodePoints: Int) {
    /** The text as stored, from what the user typed: on one line, without the spaces at either end. */
    fun clean(typed: String): String = oneLine(typed).trim()

    /** [typed] on one line: each line break becomes a space. The field has one line. */
    fun oneLine(typed: String): String =
        buildString(typed.length) { typed.forEach { append(if (it in LINE_BREAKS) ' ' else it) } }

    /** Why the text of [typed] is refused, or null if it is not. */
    fun problemOf(typed: String): TextProblem? {
        val text = clean(typed)
        return when {
            text.isEmpty() -> TextProblem.EMPTY
            text.codePointCount(0, text.length) > mostCodePoints -> TextProblem.TOO_LONG
            else -> null
        }
    }

    /** True if [text] is as it is stored: within its limits, on one line, without spaces at either end. */
    fun isStored(text: String): Boolean = text == clean(text) && text.none { it in LINE_BREAKS } && problemOf(text) == null

    /** The rules of a title and of a list name. */
    companion object {
        /** A task's title: 1 to 200 code points. */
        val TITLE: TextRules = TextRules(TaskLimits.MOST_TITLE_CODE_POINTS)

        /** A list's name: 1 to 60 code points. */
        val NAME: TextRules = TextRules(TaskLimits.MOST_NAME_CODE_POINTS)

        /** The characters that end a line. */
        private val LINE_BREAKS = setOf('\n', '\r', '\u000B', '\u000C', '\u0085', ' ', ' ')
    }
}

/**
 * The limits of every column of the two tables, also the rules that join
 * two columns (docs/apps/tasks/spec.md, "Data" and "Every stored value
 * has limits"). The repository never writes a row outside them, and a
 * restore refuses one.
 */
object TaskRules {
    /** True if the list [row] can be stored. Its record fields are not checked here. */
    fun isStored(row: TaskListEntity): Boolean = TextRules.NAME.isStored(row.name)

    /** True if the task [row] can be stored. Its record fields are not checked here. */
    fun isStored(row: TaskEntity): Boolean =
        isListId(row.listId) &&
            TextRules.TITLE.isStored(row.title) &&
            whenIsStored(row) &&
            (row.doneAt == null || RecordTimes.allows(row.doneAt))

    /** True if [listId] is [INBOX], or 36 characters, lower case, a version 4 UUID. */
    fun isListId(listId: String): Boolean = listId == INBOX || UUID_V4.matches(listId)

    /** The due day, the repeat, its days, the day it counts from and the reminder time, and the rules that join them. */
    private fun whenIsStored(row: TaskEntity): Boolean {
        val dueDay = row.dueDay ?: return row.repeat == Repeat.ONCE.code &&
            row.weekdays == Weekdays.NONE &&
            row.repeatFrom == null &&
            row.remindMinute == null
        if (dueDay !in TaskLimits.DAYS) return false
        if (row.remindMinute != null && row.remindMinute !in 0..TaskLimits.LAST_MINUTE) return false
        val repeat = Repeat.ofCode(row.repeat) ?: return false
        if (!weekdaysAllowed(repeat, row.weekdays)) return false
        if (repeat == Repeat.ONCE) return row.repeatFrom == null
        val from = row.repeatFrom ?: return false
        if (from !in TaskLimits.DAYS.first..dueDay) return false
        return RepeatDates.isDateOf(TaskRepeat(repeat, day(from), row.weekdays), day(dueDay))
    }

    /** True if [weekdays] go with [repeat]: 1 to 127 for every week, else 0. */
    fun weekdaysAllowed(repeat: Repeat, weekdays: Int): Boolean =
        if (repeat == Repeat.WEEKLY) weekdays in 1..Weekdays.ALL else weekdays == Weekdays.NONE

    private fun day(epochDay: Int): LocalDate = LocalDate.ofEpochDay(epochDay.toLong())

    /** A version 4 UUID in its 36-character lower-case form, as `IdSource.RandomUuid` makes them. */
    private val UUID_V4 = Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
}
