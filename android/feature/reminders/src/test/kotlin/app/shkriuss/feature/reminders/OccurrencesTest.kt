package app.shkriuss.feature.reminders

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The occurrences of each repeat (docs/apps/reminders/spec.md,
 * "Occurrences"), with the dates of the spec's examples, and the far ends
 * of the dates a reminder can hold.
 */
class OccurrencesTest {
    /** The occurrences of [schedule] from [from] on, [count] of them, by repeated [Occurrences.firstAfter]. */
    private fun occurrences(schedule: Schedule, from: LocalDateTime, count: Int): List<LocalDateTime> =
        generateSequence(Occurrences.firstAfter(schedule, from)) { Occurrences.firstAfter(schedule, it) }.take(count).toList()

    private fun at(date: String, hour: Int, minute: Int = 0): LocalDateTime = LocalDate.parse(date).atTime(hour, minute)

    @Test
    fun onceHasOneOccurrence() {
        assertEquals(monday(14), Occurrences.firstAfter(CALL_THE_BANK, monday(13, 59)))
        assertNull("not later than itself", Occurrences.firstAfter(CALL_THE_BANK, monday(14)))
        assertEquals(monday(14), Occurrences.latestAtOrBefore(CALL_THE_BANK, monday(14)))
        assertNull(Occurrences.latestAtOrBefore(CALL_THE_BANK, monday(13, 59)))
    }

    @Test
    fun everyDayStartsOnItsDate() {
        val pills = pills(from = MONDAY)
        assertEquals("before its date: the first day", monday(9), Occurrences.firstAfter(pills, monday(9).minusYears(1)))
        assertEquals(monday(9), Occurrences.firstAfter(pills, monday(8, 59)))
        assertEquals("at 09:00 itself: tomorrow", day(1, 9), Occurrences.firstAfter(pills, monday(9)))
        assertEquals(day(5, 9), Occurrences.latestAtOrBefore(pills, day(6, 8, 59)))
        assertEquals(day(6, 9), Occurrences.latestAtOrBefore(pills, day(6, 9)))
        assertNull("none before its date", Occurrences.latestAtOrBefore(pills, monday(8, 59)))
    }

    @Test
    fun gymIsOnMondayWednesdayAndFriday() {
        // "Gym" saved on Mon 16 Nov at 19:00: Wed 18 Nov at 18:30.
        assertEquals(
            listOf(day(2, 18, 30), day(4, 18, 30), day(7, 18, 30), day(9, 18, 30)),
            occurrences(gym(), monday(19), 4),
        )
        assertEquals("on Monday itself, before 18:30", monday(18, 30), Occurrences.firstAfter(gym(), monday(18)))
        assertEquals("the Friday before the next Monday", day(4, 18, 30), Occurrences.latestAtOrBefore(gym(), day(7, 18, 29)))
        assertNull("none before its date", Occurrences.latestAtOrBefore(gym(), MONDAY.minusDays(1).atTime(23, 59)))
    }

    @Test
    fun everyWeekWithOneDayIsAWeekApart() {
        val sundays = schedule(Repeat.WEEKLY, MONDAY, 10, 0, DayOfWeek.SUNDAY)
        assertEquals(listOf(day(6, 10), day(13, 10), day(20, 10)), occurrences(sundays, monday(0), 3))
        assertEquals(day(6, 10), Occurrences.latestAtOrBefore(sundays, day(13, 9, 59)))
    }

    @Test
    fun rentFallsOnTheLastDayOfAShorterMonth() {
        // "Rent": every month on the 31st at 10:00, from Sat 31 Oct 2026.
        val rent = schedule(Repeat.MONTHLY, LocalDate.of(2026, 10, 31), 10)
        assertEquals(
            listOf("2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31").map { at(it, 10) },
            occurrences(rent, at("2026-10-31", 9, 59), 6),
        )
        assertEquals(at("2027-02-28", 10), Occurrences.latestAtOrBefore(rent, at("2027-03-31", 9, 59)))
        assertEquals(at("2026-10-31", 10), Occurrences.latestAtOrBefore(rent, at("2026-11-30", 9, 59)))
        assertNull(Occurrences.latestAtOrBefore(rent, at("2026-10-31", 9, 59)))
    }

    @Test
    fun theTwentyNinthOfFebruaryFallsOnTheTwentyEighthInAYearWithoutIt() {
        // Every year from Tue 29 Feb 2028.
        val leap = schedule(Repeat.YEARLY, LocalDate.of(2028, 2, 29), 8)
        assertEquals(
            listOf("2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29").map { at(it, 8) },
            occurrences(leap, at("2028-01-01", 0), 5),
        )
        assertEquals(at("2029-02-28", 8), Occurrences.latestAtOrBefore(leap, at("2030-02-28", 7, 59)))
        assertNull(Occurrences.latestAtOrBefore(leap, at("2028-02-29", 7, 59)))
    }

    @Test
    fun aReminderFrom1970Or9999CostsTheSameAsOneFromToday() {
        // Date arithmetic, not a step per day: these would take millions of steps otherwise.
        val from1970 = Schedule(Repeat.DAILY, LocalDate.of(1970, 1, 1), 9 * 60)
        assertEquals(day(1, 9), Occurrences.firstAfter(from1970, monday(9)))
        assertEquals(monday(9), Occurrences.latestAtOrBefore(from1970, monday(12)))

        val weekly1970 = Schedule(Repeat.WEEKLY, LocalDate.of(1970, 1, 1), 9 * 60, Weekdays.of(DayOfWeek.MONDAY))
        assertEquals(day(7, 9), Occurrences.firstAfter(weekly1970, monday(9)))

        val monthly1970 = Schedule(Repeat.MONTHLY, LocalDate.of(1970, 1, 31), 9 * 60)
        assertEquals(at("2026-11-30", 9), Occurrences.firstAfter(monthly1970, monday(9)))

        val last = Schedule(Repeat.YEARLY, LocalDate.of(9999, 12, 31), 23 * 60 + 59)
        assertEquals(at("9999-12-31", 23, 59), Occurrences.firstAfter(last, monday(9)))
        assertEquals(LocalDate.of(10000, 12, 31).atTime(23, 59), Occurrences.firstAfter(last, at("9999-12-31", 23, 59)))
        assertNull(Occurrences.latestAtOrBefore(last, monday(9)))
    }

    @Test
    fun theLatestAtOrBeforeAndTheFirstAfterMeetForEveryRepeat() {
        // Each with its first time, worked out by hand.
        val schedules = listOf(
            pills() to day(-1, 9),
            gym() to day(0, 18, 30),
            CALL_THE_BANK to day(0, 14),
            schedule(Repeat.MONTHLY, LocalDate.of(2026, 1, 30), 7, 15) to at("2026-01-30", 7, 15),
            schedule(Repeat.YEARLY, LocalDate.of(2024, 2, 29), 23, 59) to at("2024-02-29", 23, 59),
        )
        val start = LocalDate.of(2026, 1, 1).atStartOfDay()
        schedules.forEach { (schedule, firstTime) ->
            var met = 0
            // Every 7 hours over two years: the first occurrence after a time is the one after the latest at or before it.
            generateSequence(start) { it.plusHours(7) }.takeWhile { it.year < 2028 }.forEach { time ->
                val latest = Occurrences.latestAtOrBefore(schedule, time)
                val first = Occurrences.firstAfter(schedule, time)
                // From its first time on there is always a latest one, so a function that gave none fails here.
                assertEquals("$schedule at $time has a latest one", time >= firstTime, latest != null)
                if (latest != null) {
                    assertEquals("$schedule at $time", first, Occurrences.firstAfter(schedule, latest))
                    met++
                }
                if (first != null && latest != null) assertEquals("$schedule at $time", latest, Occurrences.latestAtOrBefore(schedule, first.minusMinutes(1)))
            }
            assertTrue("$schedule is checked at more than a few times: $met", met > 1_000)
        }
    }
}
