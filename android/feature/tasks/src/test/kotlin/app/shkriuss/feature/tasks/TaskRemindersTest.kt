package app.shkriuss.feature.tasks

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The reminder number and the reminder moment of a task
 * (docs/apps/tasks/spec.md, "Reminders of a task"), with the spec's
 * example, and the moment of a time in the two hours of summer time.
 */
class TaskRemindersTest {
    private fun task(due: Due?, doneAt: Long? = null) = Task("id", INBOX, "Pills", due, doneAt, createdAt = 0)

    @Test
    fun theNumberOfTheSpecsExample() {
        // Every day, due Mon 16 Nov at 09:00: (20773 × 8 + 1) × 1440 + 540.
        assertEquals(239_306_940L, TaskReminders.numberOf(task(Due(MONDAY, PILLS, 9 * 60))))
    }

    @Test
    fun theHighestNumberIsWithinTheLimitOfThePhoneOnlyFile() {
        val last = Due(TaskLimits.LAST_DAY, repeat(Repeat.YEARLY, TaskLimits.LAST_DAY), TaskLimits.LAST_MINUTE)
        assertEquals(TaskReminders.MOST_NUMBER, TaskReminders.numberOf(task(last)))
        assertEquals(33_786_969_119L, TaskReminders.MOST_NUMBER)
    }

    @Test
    fun aTaskThatIsDoneOrHasNoDueDayOrTimeHasNoNumber() {
        assertNull(TaskReminders.numberOf(task(null)))
        assertNull(TaskReminders.numberOf(task(Due(MONDAY))))
        assertNull(TaskReminders.numberOf(task(Due(MONDAY, null, 540), doneAt = 1L)))
    }

    @Test
    fun aNewDueDayRepeatOrTimeGivesANewNumber() {
        val pills = TaskReminders.numberOf(Due(MONDAY, PILLS, 540))
        val numbers = listOf(
            pills,
            TaskReminders.numberOf(Due(day(1), PILLS, 540)),
            TaskReminders.numberOf(Due(MONDAY, null, 540)),
            TaskReminders.numberOf(Due(MONDAY, PILLS, 541)),
        )
        assertEquals(numbers.size, numbers.toSet().size)
    }

    @Test
    fun theMomentIsTheDueDayAtTheTimeInThePhonesZoneNow() {
        val due = Due(MONDAY, null, 9 * 60)
        val moment = TaskReminders.momentOf(due)!!
        assertEquals(monday(9), moment)
        // 09:00 in Tbilisi is 05:00 UTC; in Berlin it is 08:00 UTC.
        assertEquals(readingAt(monday(5)).millis, readingAt(monday(0), TBILISI).millisOf(moment))
        assertEquals(readingAt(monday(8)).millis, readingAt(monday(0), BERLIN).millisOf(moment))
    }

    @Test
    fun aTimeThatDoesNotExistMovesLaterAndOneThatHappensTwiceIsTheFirst() {
        // Berlin: 28 March 2027 has no 02:30; on 31 October 2027 it happens twice.
        val spring = TaskReminders.momentOf(Due(LocalDate.of(2027, 3, 28), null, 2 * 60 + 30))!!
        val autumn = TaskReminders.momentOf(Due(LocalDate.of(2027, 10, 31), null, 2 * 60 + 30))!!
        val reading = readingAt(LocalDate.of(2027, 1, 1).atStartOfDay(), BERLIN)
        assertEquals(LocalDate.of(2027, 3, 28).atTime(3, 30), reading.local(reading.millisOf(spring)))
        // The first 02:30 is at 00:30 UTC, in summer time.
        assertEquals(readingAt(LocalDate.of(2027, 10, 31).atTime(0, 30)).millis, reading.millisOf(autumn))
        assertTrue(reading.millisOf(autumn) < readingAt(LocalDate.of(2027, 10, 31).atTime(1, 30)).millis)
    }
}
