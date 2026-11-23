package app.shkriuss.feature.tasks

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The reminder number, the reminder moment and the one alarm of a task
 * (docs/apps/tasks/spec.md, "Reminders of a task"), with the spec's
 * example, the moment of a time in the two hours of summer time, and
 * Reminders' rule for a one-time reminder with the moment as its one
 * occurrence.
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

    // The one alarm of a task: Reminders' rule for a one-time reminder.

    private val moment = monday(14)

    @Test
    fun aMomentLaterThanTheMarkAndStillToComeIsTheNext() {
        val now = readingAt(monday(8))
        assertEquals(TaskAlarm.Next(readingAt(moment).millis), TaskReminders.alarmOf(moment, monday(8), null, now))
    }

    @Test
    fun aMomentLaterThanTheMarkThatHasPassedIsDue() {
        val now = readingAt(monday(15))
        assertEquals(TaskAlarm.Due(readingAt(moment).millis), TaskReminders.alarmOf(moment, monday(8), null, now))
    }

    @Test
    fun aMomentAtOrBeforeTheMarkHasNoAlarmUnlessASnoozeIsSet() {
        val now = readingAt(monday(14, 5))
        assertNull(TaskReminders.alarmOf(moment, monday(14), null, now))
        val snooze = readingAt(monday(14, 12)).millis
        assertEquals(TaskAlarm.Snooze(snooze), TaskReminders.alarmOf(moment, monday(14), snooze, now))
        val passed = readingAt(monday(14, 1)).millis
        assertEquals("a snooze whose end has passed counts", TaskAlarm.Snooze(passed), TaskReminders.alarmOf(moment, monday(14), passed, now))
    }

    @Test
    fun aDueMomentComesBeforeASnoozeAndASnoozeBeforeAMomentStillToCome() {
        val snooze = readingAt(monday(13)).millis
        assertEquals(TaskAlarm.Due(readingAt(moment).millis), TaskReminders.alarmOf(moment, monday(8), snooze, readingAt(monday(14, 1))))
        assertEquals(TaskAlarm.Snooze(snooze), TaskReminders.alarmOf(moment, monday(8), snooze, readingAt(monday(12))))
        val later = readingAt(monday(15)).millis
        assertEquals(TaskAlarm.Next(readingAt(moment).millis), TaskReminders.alarmOf(moment, monday(8), later, readingAt(monday(12))))
    }

    @Test
    fun theMarkNeverStaysLaterThanNow() {
        assertEquals(monday(9, 30), TaskReminders.markNow(monday(14), readingAt(monday(9, 30, 20))))
        assertEquals(monday(9, 30), TaskReminders.markNow(null, readingAt(monday(9, 30, 20))))
        assertEquals(monday(8), TaskReminders.markNow(monday(8), readingAt(monday(9, 30))))
    }

    @Test
    fun aTaskWithNoReminderOrDoneHasNoAlarmAndAnEntryForAnotherNumberCountsAsMissing() {
        val now = readingAt(monday(8))
        assertNull(TaskReminders.alarmOf(task(Due(MONDAY)), null, now))
        assertNull(TaskReminders.alarmOf(task(Due(MONDAY, null, 14 * 60), doneAt = 1L), null, now))
        val bank = task(Due(MONDAY, null, 14 * 60))
        // Written for another number: its mark at 14:00 and its snooze count for nothing.
        val old = TaskEntry(number = 1L, mark = monday(14), snoozeMillis = readingAt(monday(9)).millis)
        assertEquals(TaskAlarm.Next(readingAt(moment).millis), TaskReminders.alarmOf(bank, old, now))
        val counted = TaskEntry(number = TaskReminders.numberOf(bank), mark = monday(14))
        assertNull(TaskReminders.alarmOf(bank, counted, readingAt(monday(14, 5))))
    }
}
