package app.shkriuss.feature.reminders

import java.time.DayOfWeek
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The limits of a title, a schedule and the days of the week (docs/apps/reminders/spec.md, table `reminder`). */
class ReminderLimitsTest {
    @Test
    fun aTitleIsCountedInCodePointsWithoutTheSpacesAtEitherEnd() {
        assertEquals(TitleProblem.EMPTY, TitleRules.problemOf(""))
        assertEquals(TitleProblem.EMPTY, TitleRules.problemOf(" \t "))
        assertNull(TitleRules.problemOf("  ${"x".repeat(200)}  "))
        assertEquals(TitleProblem.TOO_LONG, TitleRules.problemOf("x".repeat(201)))
        // A bell is one code point and two UTF-16 units.
        assertNull(TitleRules.problemOf("🔔".repeat(200)))
        assertEquals(TitleProblem.TOO_LONG, TitleRules.problemOf("🔔".repeat(201)))
        assertEquals("Pills", TitleRules.clean("  Pills \n"))
    }

    @Test
    fun aStoredTitleIsOnOneLineWithNoSpaceAtEitherEnd() {
        assertTrue(TitleRules.isStored("Call the bank"))
        listOf("", " Pills", "Pills ", "Two\nlines", "Two lines", "x".repeat(201)).forEach {
            assertFalse(it, TitleRules.isStored(it))
        }
        assertEquals("Two lines and three", TitleRules.oneLine("Two\r\nlines and three").replace("  ", " "))
    }

    @Test
    fun theDaysOfTheWeekAreOneBitEach() {
        assertEquals(1, Weekdays.bitOf(DayOfWeek.MONDAY))
        assertEquals(64, Weekdays.bitOf(DayOfWeek.SUNDAY))
        assertEquals(0x15, Weekdays.of(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY))
        assertEquals(Weekdays.ALL, Weekdays.of(*DayOfWeek.entries.toTypedArray()))
        assertTrue(Weekdays.has(0x15, DayOfWeek.FRIDAY))
        assertFalse(Weekdays.has(0x15, DayOfWeek.TUESDAY))
        assertEquals(0x14, Weekdays.with(0x15, DayOfWeek.MONDAY, chosen = false))
        assertEquals(0x17, Weekdays.with(0x15, DayOfWeek.TUESDAY, chosen = true))
    }

    @Test
    fun aScheduleIsWithinTheLimitsOfTheTable() {
        assertTrue(ScheduleRules.isValid(gym()))
        assertTrue(ScheduleRules.isValid(Schedule(Repeat.ONCE, LocalDate.of(1970, 1, 1), 0)))
        assertTrue(ScheduleRules.isValid(Schedule(Repeat.YEARLY, LocalDate.of(9999, 12, 31), 1_439)))
        listOf(
            Schedule(Repeat.ONCE, LocalDate.of(1969, 12, 31), 0),
            Schedule(Repeat.ONCE, LocalDate.of(10_000, 1, 1), 0),
            Schedule(Repeat.ONCE, MONDAY, 1_440),
            Schedule(Repeat.ONCE, MONDAY, -1),
            Schedule(Repeat.WEEKLY, MONDAY, 0, 0),
            Schedule(Repeat.WEEKLY, MONDAY, 0, 128),
            Schedule(Repeat.DAILY, MONDAY, 0, 1),
        ).forEach { assertFalse(it.toString(), ScheduleRules.isValid(it)) }
    }

    @Test
    fun theStoredRepeatsAreTheFiveOfTheSpec() {
        assertEquals(listOf(0, 1, 2, 3, 4), Repeat.entries.map { it.code })
        assertNull(Repeat.ofCode(5))
        assertEquals(Repeat.WEEKLY, Repeat.ofCode(2))
    }
}
