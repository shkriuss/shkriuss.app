package app.shkriuss.feature.tasks

import java.time.DayOfWeek
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rules of the task form as plain code (docs/apps/tasks/spec.md, "The
 * task form" and "Repeats", point 2): where the reminder time starts, when
 * a time has passed, also in the two hours of summer time, and what Save
 * stores for a repeat.
 */
class FormRulesTest {
    private fun form(date: LocalDate?, repeat: Repeat = Repeat.ONCE, weekdays: Int = Weekdays.NONE, remindMinute: Int? = null, stored: Task? = null) =
        TaskForm(taskId = stored?.id, title = "Gym", listId = INBOX, date = date, repeat = repeat, weekdays = weekdays, remindMinute = remindMinute, stored = stored)

    @Test
    fun theReminderStartsAt0900() {
        assertEquals(9 * 60, FormRules.startMinute(day(1), readingAt(monday(10, 20))))
        assertEquals("today, before 09:00", 9 * 60, FormRules.startMinute(MONDAY, readingAt(monday(8, 59, 59))))
    }

    @Test
    fun onADueDayOfTodayAfter0900ItStartsAtTheNextFullHourOrAt2359() {
        assertEquals(11 * 60, FormRules.startMinute(MONDAY, readingAt(monday(10, 20))))
        assertEquals("at 09:00 itself 09:00 has passed", 10 * 60, FormRules.startMinute(MONDAY, readingAt(monday(9, 0, 30))))
        assertEquals("no full hour left", 23 * 60 + 59, FormRules.startMinute(MONDAY, readingAt(monday(23, 10))))
        // In the minute 23:59 that time has passed too, and Save says so.
        assertTrue(FormRules.hasPassed(MONDAY, FormRules.startMinute(MONDAY, readingAt(monday(23, 59, 30))), readingAt(monday(23, 59, 30))))
    }

    @Test
    fun aTimeHasPassedWhenItIsNotLaterThanTheCurrentMinute() {
        val now = readingAt(monday(9, 30, 15))
        assertTrue(FormRules.hasPassed(MONDAY, 9 * 60 + 30, now))
        assertFalse(FormRules.hasPassed(MONDAY, 9 * 60 + 31, now))
        assertTrue(FormRules.hasPassed(day(-1), 23 * 60, now))
    }

    @Test
    fun inTheHoursOfSummerTimeBothTheLocalTimeAndItsMomentMustBeLater() {
        // Berlin, 31 Oct 2027, in the second 02:00 to 03:00: 02:45 is the first 02:45, which has passed.
        val secondPass = ClockReading(readingAt(LocalDate.of(2027, 10, 31).atTime(1, 30)).millis, BERLIN)
        assertEquals(LocalDate.of(2027, 10, 31).atTime(2, 30), secondPass.local)
        assertTrue(FormRules.hasPassed(LocalDate.of(2027, 10, 31), 2 * 60 + 45, secondPass))
        // Berlin, 28 Mar 2027 at 03:10: 02:30 moves to 03:30, still to come, but its local time is not later than now.
        val afterJump = readingAt(LocalDate.of(2027, 3, 28).atTime(3, 10), BERLIN)
        assertTrue(FormRules.hasPassed(LocalDate.of(2027, 3, 28), 2 * 60 + 30, afterJump))
    }

    @Test
    fun aRepeatCountsFromTheDateInTheFormAndIsDueOnItsFirstDateOnOrAfterIt() {
        val sunday = MONDAY.minusDays(1)
        val days = Weekdays.of(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY)

        val due = FormRules.dueOf(form(sunday, Repeat.WEEKLY, days, 18 * 60 + 30))!!

        assertEquals("Gym saved with the date Sun 15 Nov is due Mon 16 Nov", MONDAY, due.day)
        assertEquals(TaskRepeat(Repeat.WEEKLY, sunday, days), due.repeat)
        assertEquals(18 * 60 + 30, due.remindMinute)
        assertEquals(listOf(MONDAY, day(2), day(4)), FormRules.datesOf(form(sunday, Repeat.WEEKLY, days)))
    }

    @Test
    fun withoutARepeatTheDueDayIsTheDateInTheForm() {
        assertEquals(Due(MONDAY, null, 540), FormRules.dueOf(form(MONDAY, remindMinute = 540)))
        assertEquals(emptyList<LocalDate>(), FormRules.datesOf(form(MONDAY)))
        assertNull(FormRules.dueOf(form(null)))
    }

    @Test
    fun theDaysOfOtherRepeatsAreNotStored() {
        val due = FormRules.dueOf(form(MONDAY, Repeat.DAILY, weekdays = Weekdays.of(DayOfWeek.FRIDAY)))!!
        assertEquals(TaskRepeat(Repeat.DAILY, MONDAY), due.repeat)
    }

    @Test
    fun whileTheDatesAreAsStoredTheStoredDueDayAndRepeatStay() {
        // "Rent" from Sat 31 Oct, now due Mon 30 Nov: the form shows 30 Nov, and every month still falls on the last day.
        val rent = Task("id", INBOX, "Rent", Due(LocalDate.of(2026, 11, 30), RENT, 600), null, 0)
        val unchanged = form(LocalDate.of(2026, 11, 30), Repeat.MONTHLY, remindMinute = 660, stored = rent)

        assertFalse(FormRules.datesChanged(unchanged))
        assertTrue(FormRules.reminderChanged(unchanged))
        assertEquals(Due(LocalDate.of(2026, 11, 30), RENT, 660), FormRules.dueOf(unchanged))
        assertEquals(LocalDate.of(2026, 12, 31), FormRules.datesOf(unchanged)[1])

        // A new date counts from it: from 30 Nov, every month falls on the 30th.
        val moved = unchanged.copy(date = LocalDate.of(2026, 11, 30).plusDays(1))
        assertTrue(FormRules.datesChanged(moved))
        assertEquals(LocalDate.of(2026, 12, 1), FormRules.dueOf(moved)!!.repeat!!.from)
    }

    @Test
    fun everyWeekWithNoDayGivesNothing() {
        assertNull(FormRules.dueOf(form(MONDAY, Repeat.WEEKLY, Weekdays.NONE)))
    }
}
