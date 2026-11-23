package app.shkriuss.feature.tasks

import app.shkriuss.feature.tasks.ui.RowPlace
import app.shkriuss.feature.tasks.ui.TasksFormat
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * How the screens write dates, times, repeats and the rows of tasks, and
 * what TalkBack reads for them (docs/apps/tasks/spec.md, "Screens" and
 * "TalkBack"), with the examples of the spec. Today is Monday 16 November
 * 2026. A row in a list says its due day and leaves out the list's name,
 * and a short date has its year only when it is not this year (the
 * owner's decisions).
 */
@RunWith(RobolectricTestRunner::class)
class TasksFormatTest {
    private val uk = TasksFormat(context.resources, Locale.UK, is24Hour = true)
    private val us = TasksFormat(context.resources, Locale.US, is24Hour = false)

    private fun row(title: String, due: Due?, listName: String? = null, doneAt: Long? = null) =
        TaskRow(Task(id = "id", listId = INBOX, title = title, due = due, doneAt = doneAt, createdAt = 0), listName)

    @Test
    fun timesFollowThePhonesClock() {
        assertEquals("09:00", uk.time(9 * 60))
        assertEquals("6:30 PM", us.time(LocalTime.of(18, 30)))
    }

    @Test
    fun theDueDateOfTheFormHasItsYear() {
        assertEquals("Mon, 16 Nov 2026", uk.date(MONDAY))
        assertEquals("Mon, Nov 16, 2026", us.date(MONDAY))
    }

    @Test
    fun aShortDateLeavesOutTheYearOfThisYear() {
        assertEquals("Wed 18 Nov", uk.day(day(2), MONDAY))
        assertEquals("Fri, 1 Jan 2027", uk.day(LocalDate.of(2027, 1, 1), MONDAY))
        assertEquals("Mon, 16 Nov 2026", uk.day(MONDAY, MONDAY.plusYears(1)))
    }

    @Test
    fun aRowOfTodaySaysItsListTheDateIfOverdueTheTimeAndTheRepeat() {
        val pills = row("Pills", Due(MONDAY, PILLS, 9 * 60), "Home")
        assertEquals("Home · 09:00 · Every day", uk.supporting(pills, RowPlace.TODAY, MONDAY, null))
        val gym = row("Gym", Due(MONDAY, GYM), listName = null)
        assertEquals("Inbox · Every week", uk.supporting(gym, RowPlace.TODAY, MONDAY, null))
        // The spec's example: overdue since Monday, seen on Wednesday.
        assertEquals("Inbox · Mon 16 Nov · Every week", uk.supporting(gym, RowPlace.TODAY, day(2), null))
        assertEquals("Inbox", uk.supporting(row("Call the bank", Due(MONDAY)), RowPlace.TODAY, MONDAY, null))
    }

    @Test
    fun aRowOfAListSaysItsDueDayAndNotItsList() {
        val pills = row("Pills", Due(MONDAY, PILLS, 9 * 60), "Home")
        assertEquals("Today · 09:00 · Every day", uk.supporting(pills, RowPlace.LIST, MONDAY, null))
        val gym = row("Gym", Due(day(4), GYM), "Home")
        assertEquals("Fri 20 Nov · Every week", uk.supporting(gym, RowPlace.LIST, MONDAY, null))
        assertEquals("Mon 16 Nov", uk.supporting(row("Report", Due(MONDAY), "Home"), RowPlace.LIST, day(1), null))
        assertEquals("Fri, 1 Jan 2027", uk.supporting(row("Taxes", Due(LocalDate.of(2027, 1, 1)), "Home"), RowPlace.LIST, MONDAY, null))
        assertNull("no due day, nothing under the title", uk.supporting(row("Fix the tap", null, "Home"), RowPlace.LIST, MONDAY, null))
    }

    @Test
    fun aDoneRowSaysTheDayItWasDone() {
        val done = row("Water the plants", null, "Home", doneAt = 1L)
        assertEquals("Done Mon 16 Nov", uk.supporting(done, RowPlace.LIST, MONDAY, MONDAY))
        assertEquals("done on Monday 16 November", uk.state(MONDAY, MONDAY))
        assertEquals("not done", uk.state(null, MONDAY))
    }

    @Test
    fun talkBackReadsARowAsTheSpecSays() {
        val rent = row("Pay rent", Due(MONDAY, RENT_FROM_MONDAY, 10 * 60), "Home")
        assertEquals("Pay rent, due today at 10:00, every month, Home", uk.spoken(rent, RowPlace.TODAY, MONDAY))
        assertEquals("Pay rent, due today at 10:00, every month", uk.spoken(rent, RowPlace.LIST, MONDAY))
        val gym = row("Gym", Due(day(4), GYM, 18 * 60 + 30), "Home")
        assertEquals("Gym, due Friday 20 November at 18:30, every week", uk.spoken(gym, RowPlace.LIST, MONDAY))
        assertEquals("Call the bank, due today, Inbox", uk.spoken(row("Call the bank", Due(MONDAY)), RowPlace.TODAY, MONDAY))
        assertEquals("Fix the tap", uk.spoken(row("Fix the tap", null, "Home"), RowPlace.LIST, MONDAY))
        // A done task: its title; its state says when it was done.
        assertEquals("Water the plants", uk.spoken(row("Water the plants", Due(MONDAY), "Home", doneAt = 1L), RowPlace.LIST, MONDAY))
    }

    @Test
    fun theLineOfARepeatShowsThreeDatesAndMore() {
        assertEquals(
            "Dates: Wed 18 Nov, Fri 20 Nov, Mon 23 Nov, …",
            uk.dates(listOf(day(2), day(4), day(7)), MONDAY),
        )
        // A repeat that ends at 9999-12-31 before three dates: no "…".
        assertEquals("Dates: Fri, 31 Dec 9999", uk.dates(listOf(TaskLimits.LAST_DAY), MONDAY))
    }

    @Test
    fun theWeekStartsOnThePhonesFirstDayAndTheChipsReadTheWholeDay() {
        assertEquals(DayOfWeek.MONDAY, uk.week.first())
        assertEquals(DayOfWeek.SUNDAY, us.week.first())
        assertEquals("Mon", uk.dayShort(DayOfWeek.MONDAY))
        assertEquals("Monday", uk.dayName(DayOfWeek.MONDAY))
    }

    @Test
    fun countsAreInThePhonesNumberFormat() {
        assertEquals("5,000", uk.number(TaskLimits.MOST_TASKS))
    }

    private companion object {
        /** "Pay rent": every month from Monday 16 November, so due that day. */
        val RENT_FROM_MONDAY = repeat(Repeat.MONTHLY, MONDAY)
    }
}
