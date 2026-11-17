package app.shkriuss.feature.reminders

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The rule and the mark (docs/apps/reminders/spec.md, "The mark", "The
 * rule" and "Examples"), one test per row of the examples that the rule
 * decides. In Tbilisi unless the test says Berlin. What the handler and
 * the buttons write is written here by hand: the mark after a reminder
 * showed, the end of a snooze.
 */
class ReminderRuleTest {
    /** The alarm of [schedule] with the mark [mark] and the snooze [snooze] at the local time [now] in [zone]. */
    private fun alarm(
        schedule: Schedule,
        mark: LocalDateTime?,
        now: LocalDateTime,
        snooze: LocalDateTime? = null,
        zone: ZoneId = TBILISI,
    ): ReminderAlarm? {
        val reading = readingAt(now, zone)
        return ReminderRule.alarmOf(schedule, ReminderRule.markNow(mark, reading), snooze?.let { millisAt(it, zone) }, reading)
    }

    private fun next(at: LocalDateTime, zone: ZoneId = TBILISI) = ReminderAlarm.Next(at, millisAt(at, zone))

    private fun due(at: LocalDateTime, zone: ZoneId = TBILISI) = ReminderAlarm.Due(at, millisAt(at, zone))

    private fun snooze(until: LocalDateTime, zone: ZoneId = TBILISI) = ReminderAlarm.Snooze(millisAt(until, zone))

    // The mark.

    @Test
    fun noMarkCountsFromTheCurrentMinute() {
        val reading = readingAt(monday(9, 30, 45))
        assertEquals(monday(9, 30), ReminderRule.markNow(null, reading))
    }

    @Test
    fun aMarkLaterThanNowCountsAsTheCurrentMinute() {
        val reading = readingAt(monday(8, 30, 10))
        assertEquals(monday(8, 30), ReminderRule.markNow(monday(9), reading))
        assertEquals("a mark at or before now stays", monday(8, 30), ReminderRule.markNow(monday(8, 30), reading))
        assertEquals(monday(8, 0), ReminderRule.markNow(monday(8, 0), reading))
    }

    // The examples.

    @Test
    fun pillsSavedOnSundayAt0930FirstShowOnMondayAt0900() {
        // Saving sets the mark to the current minute.
        assertEquals(next(monday(9)), alarm(pills(), mark = day(-1, 9, 30), now = day(-1, 9, 30)))
    }

    @Test
    fun gymSavedOnMondayAt1900FirstShowsOnWednesday() {
        assertEquals(next(day(2, 18, 30)), alarm(gym(), mark = monday(19), now = monday(19)))
    }

    @Test
    fun aSnoozeIsTheAlarmUntilItEnds() {
        // Snooze 10 min at 09:02: 09:12.
        assertEquals(snooze(monday(9, 12)), alarm(pills(), mark = monday(9), now = monday(9, 2), snooze = monday(9, 12)))
    }

    @Test
    fun afterDoneASwipeOrNoAnswerTheNextIsTomorrow() {
        assertEquals(next(day(1, 9)), alarm(pills(), mark = monday(9), now = monday(9, 5)))
    }

    @Test
    fun withThePhoneOffFromMondayToWednesdayOnlyWednesdayShowsLate() {
        // Off from Mon 08:00 to Wed 11:00. Monday and Tuesday are skipped.
        assertEquals(due(day(2, 9)), alarm(pills(), mark = day(-1, 9), now = day(2, 11)))
    }

    @Test
    fun aOneTimeReminderMissedWhileThePhoneWasLockedShowsAfterTheUnlock() {
        // A restart on Mon at 13:00, the unlock at 15:10.
        assertEquals(due(monday(14)), alarm(CALL_THE_BANK, mark = monday(8), now = monday(15, 10)))
    }

    @Test
    fun afterAForceStopTheMorningsPillsShowWhenTheAppOpens() {
        assertEquals(due(monday(9)), alarm(pills(), mark = day(-1, 9), now = monday(12)))
    }

    @Test
    fun aSnoozeThatEndedWhileThePhoneWasOffShowsAfterTheUnlock() {
        // Snoozed until 09:12, the phone off from 09:10 to 10:00.
        assertEquals(snooze(monday(9, 12)), alarm(pills(), mark = monday(9), now = monday(10), snooze = monday(9, 12)))
    }

    @Test
    fun aSnoozeOfYesterdaysReminderGivesWayToTodaysOnTime() {
        // Monday's "Pills" is still on screen on Tuesday. Snooze 10 min at 08:55: until 09:05.
        assertEquals(next(day(1, 9)), alarm(pills(), mark = monday(9), now = day(1, 8, 55), snooze = day(1, 9, 5)))
        // An occurrence that comes due during a snooze shows.
        assertEquals(due(day(1, 9)), alarm(pills(), mark = monday(9), now = day(1, 9, 1), snooze = day(1, 9, 5)))
    }

    @Test
    fun aTimeThatDoesNotExistShowsLaterByTheJump() {
        // Berlin, Sun 28 Mar 2027, every day at 02:30: that day at 03:30.
        val sunday = LocalDate.of(2027, 3, 28)
        val daily = schedule(Repeat.DAILY, sunday.minusDays(7), 2, 30)
        val jump = ReminderAlarm.Next(sunday.atTime(2, 30), millisAt(sunday.atTime(3, 30), BERLIN))
        assertEquals(jump, alarm(daily, mark = sunday.minusDays(1).atTime(2, 30), now = sunday.atTime(1, 0), zone = BERLIN))
        // At 03:10, after the jump, it is not due yet: it shows at 03:30.
        assertEquals(jump, alarm(daily, mark = sunday.minusDays(1).atTime(2, 30), now = sunday.atTime(3, 10), zone = BERLIN))
        assertEquals(
            ReminderAlarm.Due(sunday.atTime(2, 30), millisAt(sunday.atTime(3, 30), BERLIN)),
            alarm(daily, mark = sunday.minusDays(1).atTime(2, 30), now = sunday.atTime(3, 30), zone = BERLIN),
        )
        // The next at 02:30.
        assertEquals(
            next(sunday.plusDays(1).atTime(2, 30), BERLIN),
            alarm(daily, mark = sunday.atTime(2, 30), now = sunday.atTime(3, 31), zone = BERLIN),
        )
    }

    @Test
    fun aTimeThatHappensTwiceShowsOnceAtTheFirst() {
        // Berlin, Sun 31 Oct 2027, every day at 02:30.
        val sunday = LocalDate.of(2027, 10, 31)
        val daily = schedule(Repeat.DAILY, sunday.minusDays(7), 2, 30)
        val first = sunday.atTime(2, 30).atOffset(ZoneOffset.ofHours(2)).toInstant().toEpochMilli()
        assertEquals(ReminderAlarm.Next(sunday.atTime(2, 30), first), alarm(daily, mark = sunday.minusDays(1).atTime(2, 30), now = sunday.atTime(1, 0), zone = BERLIN))

        // It showed at the first 02:30, and the handler moved the mark there. At the second 02:30 the mark stays.
        val secondPass = sunday.atTime(2, 31).atOffset(ZoneOffset.ofHours(1)).toInstant().toEpochMilli()
        val reading = ClockReading(secondPass, BERLIN)
        assertEquals(sunday.atTime(2, 30), ReminderRule.markNow(sunday.atTime(2, 30), reading))
        assertEquals(
            next(sunday.plusDays(1).atTime(2, 30), BERLIN),
            ReminderRule.alarmOf(daily, ReminderRule.markNow(sunday.atTime(2, 30), reading), null, reading),
        )
    }

    @Test
    fun pillsFollowTheZoneThePhoneIsIn() {
        // "Pills" showed on Mon at 09:00 in Tbilisi. At 13:00 Tbilisi time the phone is in Berlin, where it is 10:00.
        assertEquals(next(day(1, 9), BERLIN), alarm(pills(), mark = monday(9), now = monday(10), zone = BERLIN))
    }

    @Test
    fun inAZoneFurtherWestTheMorningShowsAgain() {
        // At 11:00 Tbilisi time the phone is in Berlin, where it is 08:00: the mark is later than now, so it counts from now.
        assertEquals(next(monday(9), BERLIN), alarm(pills(), mark = monday(9), now = monday(8), zone = BERLIN))
    }

    @Test
    fun offInBerlinAndOnInTbilisiShowsTheMorningLate() {
        // Off from Mon 07:00 in Berlin, on in Tbilisi at 15:00.
        assertEquals(due(monday(9)), alarm(pills(), mark = day(-1, 9), now = monday(15)))
    }

    @Test
    fun aOneTimeReminderMadeInTbilisiShowsAtItsTimeInBerlin() {
        assertEquals(next(monday(14), BERLIN), alarm(CALL_THE_BANK, mark = monday(8), now = monday(10), zone = BERLIN))
    }

    @Test
    fun aClockSetBackShowsTheSameTimeAgain() {
        // After 09:00 showed, the clock is set back from 09:30 to 08:30.
        assertEquals(next(monday(9)), alarm(pills(), mark = monday(9), now = monday(8, 30)))
    }

    @Test
    fun aClockSetForwardShowsWhatItPassedAtOnce() {
        // On Mon at 10:00 the clock is set forward to 15:00.
        assertEquals(due(monday(14)), alarm(CALL_THE_BANK, mark = monday(10), now = monday(15)))
    }

    @Test
    fun aRestoreCountsFromItsMoment() {
        // A restore on Mon at 12:00: "Pills" on Tue, and a one-time reminder whose time passed is past.
        assertEquals(next(day(1, 9)), alarm(pills(), mark = monday(12), now = monday(12)))
        assertNull(alarm(schedule(Repeat.ONCE, MONDAY, 10), mark = monday(12), now = monday(12)))
        assertEquals(next(monday(14)), alarm(CALL_THE_BANK, mark = monday(12), now = monday(12)))
    }

    @Test
    fun aOneTimeReminderThatShowedIsPastAndASnoozeKeepsItUpcoming() {
        assertNull(alarm(CALL_THE_BANK, mark = monday(14), now = monday(14, 1)))
        assertEquals(snooze(monday(14, 11)), alarm(CALL_THE_BANK, mark = monday(14), now = monday(14, 1), snooze = monday(14, 11)))
    }

    @Test
    fun onlyTheLatestOfManyDueOccurrencesShows() {
        // A restored reminder that starts in 1970, with a mark in 1970.
        val old = Schedule(Repeat.DAILY, LocalDate.of(1970, 1, 1), 9 * 60)
        assertEquals(due(monday(9)), alarm(old, mark = LocalDate.of(1970, 1, 1).atTime(9, 0), now = monday(12)))
    }
}
