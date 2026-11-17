package app.shkriuss.feature.reminders

import java.time.LocalDate
import java.time.ZoneOffset
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "That time has passed." for a one-time reminder
 * (docs/apps/reminders/spec.md, "The reminder form", point 2), also in the
 * two hours of the year where the phone's clock and the moment part ways.
 */
class FormRulesTest {
    @Test
    fun aTimeHasPassedWhenItIsNotLaterThanTheCurrentMinute() {
        val now = readingAt(monday(9, 30, 15))
        assertTrue(FormRules.hasPassed(MONDAY, 9 * 60 + 29, now))
        assertTrue("the current minute itself", FormRules.hasPassed(MONDAY, 9 * 60 + 30, now))
        assertFalse(FormRules.hasPassed(MONDAY, 9 * 60 + 31, now))
        assertFalse(FormRules.hasPassed(MONDAY.plusDays(1), 0, now))
        assertTrue(FormRules.hasPassed(MONDAY.minusDays(1), 23 * 60 + 59, now))
    }

    @Test
    fun inTheSecondPassOfTheHourThatHappensTwiceItsTimesHavePassed() {
        // Berlin, Sun 31 Oct 2027, at the second 02:30. 02:45 is the first 02:45, which has passed.
        val sunday = LocalDate.of(2027, 10, 31)
        val secondPass = ClockReading(sunday.atTime(2, 30).atOffset(ZoneOffset.ofHours(1)).toInstant().toEpochMilli(), BERLIN)
        assertTrue(FormRules.hasPassed(sunday, 2 * 60 + 45, secondPass))
        assertFalse(FormRules.hasPassed(sunday, 3 * 60, secondPass))
        // In the first pass, 02:45 is still to come.
        val firstPass = ClockReading(sunday.atTime(2, 30).atOffset(ZoneOffset.ofHours(2)).toInstant().toEpochMilli(), BERLIN)
        assertFalse(FormRules.hasPassed(sunday, 2 * 60 + 45, firstPass))
    }

    @Test
    fun afterTheJumpATimeOfTheHourThatDoesNotExistHasPassed() {
        // Berlin, Sun 28 Mar 2027, at 03:10, after the jump from 02:00 to 03:00. 02:30 would move to 03:30, still to
        // come, but it is not later than the current minute, so it would never show.
        val sunday = LocalDate.of(2027, 3, 28)
        val now = readingAt(sunday.atTime(3, 10), BERLIN)
        assertTrue(FormRules.hasPassed(sunday, 2 * 60 + 30, now))
        assertFalse(FormRules.hasPassed(sunday, 3 * 60 + 30, now))
        // Before the jump, 02:30 is still to come: it shows at 03:30.
        assertFalse(FormRules.hasPassed(sunday, 2 * 60 + 30, readingAt(sunday.atTime(1, 50), BERLIN)))
    }
}
