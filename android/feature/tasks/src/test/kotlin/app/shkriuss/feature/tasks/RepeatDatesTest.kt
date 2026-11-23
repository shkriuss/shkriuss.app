package app.shkriuss.feature.tasks

import java.time.DayOfWeek
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The dates of each repeat (docs/apps/tasks/spec.md, "Repeats"), with the
 * spec's examples: the last day of a shorter month, 29 February, the days
 * of the week, and the end at 9999-12-31.
 */
class RepeatDatesTest {
    @Test
    fun rentOnThe31stFallsOnTheLastDayOfAShorterMonth() {
        assertEquals(
            listOf("2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31").map(LocalDate::parse),
            RepeatDates.datesFrom(RENT, RENT.from, 6),
        )
    }

    @Test
    fun everyYearFrom29FebruaryFallsOn28FebruaryInAYearWithoutIt() {
        val leap = repeat(Repeat.YEARLY, LocalDate.of(2028, 2, 29))
        assertEquals(
            listOf("2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29").map(LocalDate::parse),
            RepeatDates.datesFrom(leap, leap.from, 5),
        )
    }

    @Test
    fun everyDayIsEachDayFromTheDayItCountsFrom() {
        assertEquals(MONDAY, RepeatDates.firstOnOrAfter(PILLS, MONDAY.minusDays(10)))
        assertEquals(day(4), RepeatDates.firstAfter(PILLS, day(3)))
    }

    @Test
    fun everyWeekIsEachChosenDay() {
        assertEquals(listOf(MONDAY, day(2), day(4), day(7)), RepeatDates.datesFrom(GYM, MONDAY, 4))
        // Saved with the date Sun 15 Nov: the first date on or after it is Mon 16 Nov.
        val fromSunday = repeat(Repeat.WEEKLY, MONDAY.minusDays(1), DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY)
        assertEquals(MONDAY, RepeatDates.firstOnOrAfter(fromSunday, fromSunday.from))
    }

    @Test
    fun aDateIsOneOfTheRepeatOnlyOnOrAfterTheDayItCountsFrom() {
        assertTrue(RepeatDates.isDateOf(GYM, day(2)))
        assertFalse("a Tuesday", RepeatDates.isDateOf(GYM, day(1)))
        assertFalse("a Monday before it counts", RepeatDates.isDateOf(GYM, MONDAY.minusDays(7)))
        assertTrue(RepeatDates.isDateOf(RENT, LocalDate.of(2027, 2, 28)))
        assertFalse(RepeatDates.isDateOf(RENT, LocalDate.of(2027, 2, 27)))
    }

    @Test
    fun aRepeatFrom1970CostsTheSameAsOneFromToday() {
        val old = repeat(Repeat.WEEKLY, LocalDate.EPOCH, DayOfWeek.SUNDAY)
        assertEquals(LocalDate.of(9999, 12, 26), RepeatDates.firstOnOrAfter(old, LocalDate.of(9999, 12, 20)))
        assertEquals(LocalDate.of(9999, 12, 31), RepeatDates.firstOnOrAfter(repeat(Repeat.MONTHLY, LocalDate.EPOCH.plusDays(30)), LocalDate.of(9999, 12, 1)))
    }

    @Test
    fun noDateIsLaterThan9999December31() {
        val last = TaskLimits.LAST_DAY
        assertEquals(LocalDate.of(9999, 12, 31), last)
        assertNull(RepeatDates.firstAfter(repeat(Repeat.DAILY, LocalDate.EPOCH), last))
        // 9999-12-31 is a Friday: a Monday after it is past the end.
        assertNull(RepeatDates.firstOnOrAfter(repeat(Repeat.WEEKLY, LocalDate.EPOCH, DayOfWeek.MONDAY), LocalDate.of(9999, 12, 28)))
        assertNull(RepeatDates.firstAfter(repeat(Repeat.YEARLY, LocalDate.of(2000, 12, 31)), last))
        assertEquals(listOf(last), RepeatDates.datesFrom(repeat(Repeat.DAILY, LocalDate.EPOCH), last, 3))
    }

    @Test
    fun onceIsNoRepeat() {
        assertThrows(IllegalArgumentException::class.java) { TaskRepeat(Repeat.ONCE, MONDAY) }
    }

    @Test
    fun theStoredCodesOfTheRepeatsNeverChange() {
        assertEquals(listOf(0, 1, 2, 3, 4), Repeat.entries.map { it.code })
        assertNull(Repeat.ofCode(5))
        assertEquals(1 + 4 + 16, Weekdays.of(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY))
    }
}
