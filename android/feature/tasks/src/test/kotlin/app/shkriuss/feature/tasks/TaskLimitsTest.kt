package app.shkriuss.feature.tasks

import app.shkriuss.core.data.RecordFields
import app.shkriuss.feature.tasks.data.TaskEntity
import app.shkriuss.feature.tasks.data.TaskListEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The limits of every stored value and the rules that join two of them
 * (docs/apps/tasks/spec.md, "Data" and "Every stored value has limits"),
 * and the rules of a title and a list name, counted in code points.
 */
class TaskLimitsTest {
    private val fields = RecordFields(id = "00000000-0000-4000-8000-000000000001", createdAt = 0, updatedAt = 0, deletedAt = null)

    /** "Gym", every Mon, Wed and Fri from Mon 16 Nov, due Wed 18 Nov at 18:30, in Inbox. */
    private val gym = TaskEntity(
        fields,
        changeNumber = 1,
        listId = INBOX,
        title = "Gym",
        dueDay = 20_775,
        repeat = Repeat.WEEKLY.code,
        weekdays = 1 + 4 + 16,
        repeatFrom = 20_773,
        remindMinute = 18 * 60 + 30,
        doneAt = null,
    )

    /** "Call the bank" with no due day. */
    private val bank = gym.copy(title = "Call the bank", dueDay = null, repeat = 0, weekdays = 0, repeatFrom = null, remindMinute = null)

    @Test
    fun aTitleHas1To200CodePointsOnOneLineWithoutSpacesAtEitherEnd() {
        val rules = TextRules.TITLE
        assertEquals(TextProblem.EMPTY, rules.problemOf("   "))
        assertNull(rules.problemOf("a".repeat(200)))
        assertEquals(TextProblem.TOO_LONG, rules.problemOf("a".repeat(201)))
        // 200 emoji are 400 UTF-16 units and 200 code points.
        assertNull(rules.problemOf("😀".repeat(200)))
        assertEquals("Pay rent", rules.clean("  Pay\nrent "))
        assertTrue(rules.isStored("Pay rent"))
        assertFalse(rules.isStored(" Pay rent"))
        assertFalse(rules.isStored("Pay\nrent"))
    }

    @Test
    fun aListNameHas1To60CodePoints() {
        assertNull(TextRules.NAME.problemOf("h".repeat(60)))
        assertEquals(TextProblem.TOO_LONG, TextRules.NAME.problemOf("h".repeat(61)))
        assertEquals(TextProblem.EMPTY, TextRules.NAME.problemOf(""))
        assertTrue(TaskRules.isStored(TaskListEntity(fields, 1, "Home")))
        assertFalse(TaskRules.isStored(TaskListEntity(fields, 1, "Home ")))
        assertFalse(TaskRules.isStored(TaskListEntity(fields, 1, "")))
    }

    @Test
    fun aTaskWithinItsLimitsCanBeStored() {
        assertTrue(TaskRules.isStored(gym))
        assertTrue(TaskRules.isStored(bank))
        assertTrue("done", TaskRules.isStored(gym.copy(doneAt = 253_402_300_799_999)))
        assertTrue("in a list", TaskRules.isStored(gym.copy(listId = "3f2b8c1e-5d4a-4f6b-9c7d-2e1a0b9c8d7e")))
        assertTrue("once, with no reminder", TaskRules.isStored(gym.copy(repeat = 0, weekdays = 0, repeatFrom = null, remindMinute = null)))
        assertTrue("the last day", TaskRules.isStored(bank.copy(dueDay = 2_932_896)))
    }

    @Test
    fun eachValueOutsideItsLimitsIsRefused() {
        listOf(
            "a list id that is no UUID" to gym.copy(listId = "home"),
            "a UUID that is not version 4" to gym.copy(listId = "3f2b8c1e-5d4a-1f6b-9c7d-2e1a0b9c8d7e"),
            "a UUID in upper case" to gym.copy(listId = "3F2B8C1E-5D4A-4F6B-9C7D-2E1A0B9C8D7E"),
            "an empty title" to gym.copy(title = ""),
            "a due day before 1970" to bank.copy(dueDay = -1),
            "a due day after 9999" to bank.copy(dueDay = 2_932_897),
            "a repeat no version knows" to gym.copy(repeat = 5),
            "a reminder time past 23:59" to gym.copy(remindMinute = 1_440),
            "a negative reminder time" to gym.copy(remindMinute = -1),
            "a done time before 1970" to gym.copy(doneAt = -1),
            "a done time after 9999" to gym.copy(doneAt = 253_402_300_800_000),
        ).forEach { (case, row) -> assertFalse(case, TaskRules.isStored(row)) }
    }

    @Test
    fun theRulesThatJoinTwoValuesAreKept() {
        listOf(
            "a repeat without a due day" to bank.copy(repeat = Repeat.DAILY.code, repeatFrom = 20_773),
            "a reminder without a due day" to bank.copy(remindMinute = 540),
            "a day it counts from without a due day" to bank.copy(repeatFrom = 20_773),
            "days for a repeat other than every week" to gym.copy(repeat = Repeat.DAILY.code),
            "every week with no day" to gym.copy(weekdays = 0),
            "days past Sunday" to gym.copy(weekdays = 128),
            "a repeat without the day it counts from" to gym.copy(repeatFrom = null),
            "the day it counts from with no repeat" to gym.copy(repeat = 0, weekdays = 0),
            "the day it counts from after the due day" to gym.copy(repeatFrom = 20_776),
            "the day it counts from before 1970" to gym.copy(repeatFrom = -1),
            "a due day that is not a date of the repeat: a Thursday" to gym.copy(dueDay = 20_776),
        ).forEach { (case, row) -> assertFalse(case, TaskRules.isStored(row)) }
    }
}
