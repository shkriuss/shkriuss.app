package app.shkriuss.feature.reminders

import app.shkriuss.feature.reminders.ui.RemindersFormat
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
 * How the screens write dates, times, repeats and counts, and what
 * TalkBack reads for them (docs/apps/reminders/spec.md, "Screens" and
 * "TalkBack"), with the examples of the spec. Today is Monday 16 November
 * 2026.
 */
@RunWith(RobolectricTestRunner::class)
class RemindersFormatTest {
    private val uk = RemindersFormat(context.resources, Locale.UK, is24Hour = true)
    private val us = RemindersFormat(context.resources, Locale.US, is24Hour = false)

    @Test
    fun timesFollowThePhonesClock() {
        assertEquals("09:00", uk.time(LocalTime.of(9, 0)))
        assertEquals("6:30 PM", us.time(LocalTime.of(18, 30)))
    }

    @Test
    fun theDateRowOfTheFormHasItsYear() {
        assertEquals("Mon, 16 Nov 2026", uk.date(MONDAY))
        assertEquals("Sat, 1 Jan 2028", uk.date(MONDAY.withYear(2028).withMonth(1).withDayOfMonth(1)))
    }

    @Test
    fun aDateAndTimeLeavesOutTheYearOfThisYear() {
        assertEquals("Wed 18 Nov, 18:30", uk.dateTime(day(2, 18, 30), MONDAY))
        assertEquals("Mon 16 Nov, 14:00", uk.dateTime(monday(14), MONDAY))
        assertEquals("Sun, 31 Jan 2027, 10:00", uk.dateTime(day(76, 10), MONDAY))
        assertEquals("Mon, 16 Nov 2026, 14:00", uk.dateTime(monday(14), MONDAY.plusYears(1)))
    }

    @Test
    fun talkBackReadsTheWholeDate() {
        assertEquals("Wednesday 18 November at 18:30", uk.dateTimeSpoken(day(2, 18, 30), MONDAY))
        assertEquals("Sunday, 31 January 2027 at 10:00", uk.dateTimeSpoken(day(76, 10), MONDAY))
    }

    @Test
    fun theNextTimeSaysTodayAndTomorrow() {
        assertEquals("Today, 09:00", uk.next(monday(9), MONDAY))
        assertEquals("Tomorrow, 09:00", uk.next(day(1, 9), MONDAY))
        assertEquals("Wed 18 Nov, 18:30", uk.next(day(2, 18, 30), MONDAY))
        assertEquals("today at 09:00", uk.nextSpoken(monday(9), MONDAY))
        assertEquals("tomorrow at 09:00", uk.nextSpoken(day(1, 9), MONDAY))
        assertEquals("Wednesday 18 November at 18:30", uk.nextSpoken(day(2, 18, 30), MONDAY))
    }

    @Test
    fun theEndOfASnoozeIsATimeTodayAndADateOnAnotherDay() {
        assertEquals("09:12", uk.snoozeEnd(monday(9, 12), MONDAY))
        assertEquals("Tue 17 Nov, 00:05", uk.snoozeEnd(day(1, 0, 5), MONDAY))
        assertEquals("Tuesday 17 November at 00:05", uk.snoozeEndSpoken(day(1, 0, 5), MONDAY))
    }

    @Test
    fun theRepeatOfARow() {
        assertNull(uk.repeat(CALL_THE_BANK))
        assertEquals("Every day", uk.repeat(pills()))
        assertEquals("Mon, Wed, Fri", uk.repeat(gym()))
        assertEquals("Every month", uk.repeat(schedule(Repeat.MONTHLY, MONDAY, 10)))
        assertEquals("Every year", uk.repeat(schedule(Repeat.YEARLY, MONDAY, 10)))
    }

    @Test
    fun theRepeatOfANotificationOnTime() {
        assertNull(uk.repeatOfNotification(CALL_THE_BANK))
        assertEquals("Every day", uk.repeatOfNotification(pills()))
        assertEquals("Every Mon, Wed, Fri", uk.repeatOfNotification(gym()))
        assertEquals("Every month", uk.repeatOfNotification(schedule(Repeat.MONTHLY, MONDAY, 10)))
        assertEquals("Every year", uk.repeatOfNotification(schedule(Repeat.YEARLY, MONDAY, 10)))
    }

    @Test
    fun aTimeOfANotificationIsATimeTodayAndADateOnAnotherDay() {
        assertEquals("09:00", uk.timeOrDateTime(monday(9), MONDAY))
        assertEquals("Mon 16 Nov, 09:00", uk.timeOrDateTime(monday(9), MONDAY.plusDays(1)))
        assertEquals("Mon, 16 Nov 2026, 09:00", uk.timeOrDateTime(monday(9), LocalDate.of(2027, 1, 1)))
    }

    @Test
    fun talkBackReadsTheRepeatInWords() {
        assertNull(uk.repeatSpoken(CALL_THE_BANK))
        assertEquals("every day", uk.repeatSpoken(pills()))
        assertEquals("Monday, Wednesday, Friday", uk.repeatSpoken(gym()))
        assertEquals("every month", uk.repeatSpoken(schedule(Repeat.MONTHLY, MONDAY, 10)))
        assertEquals("every year", uk.repeatSpoken(schedule(Repeat.YEARLY, MONDAY, 10)))
    }

    @Test
    fun theWeekStartsOnThePhonesFirstDay() {
        assertEquals(DayOfWeek.entries, uk.week)
        assertEquals(listOf(DayOfWeek.SUNDAY) + DayOfWeek.entries.dropLast(1), us.week)
        val weekend = schedule(Repeat.WEEKLY, MONDAY, 10, 0, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY)
        assertEquals("Sat, Sun", uk.repeat(weekend))
        assertEquals("Sun, Sat", us.repeat(weekend))
    }

    @Test
    fun aDayChipShowsTheShortNameAndIsReadByTheWholeDay() {
        assertEquals("Mon", uk.dayShort(DayOfWeek.MONDAY))
        assertEquals("Monday", uk.dayName(DayOfWeek.MONDAY))
    }

    @Test
    fun theRepeatsOfTheForm() {
        assertEquals(
            listOf("Once", "Every day", "Every week", "Every month", "Every year"),
            Repeat.entries.map(uk::repeatName),
        )
    }

    @Test
    fun countsAreInThePhonesFormat() {
        assertEquals("500", uk.number(500))
        assertEquals("1,250", uk.number(1_250))
    }
}
