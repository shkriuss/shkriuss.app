package app.shkriuss.feature.water

import java.time.LocalDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * The rule of the next reminder, one test for each row of the table in
 * docs/apps/water/spec.md, "When the next reminder comes", with its
 * example: reminder hours from 08:00 until 22:00, every hour.
 */
class NextReminderTest {
    private val hourly = WaterSettings(remindersOn = true, intervalMinutes = 60, fromMinute = 8 * 60, untilMinute = 22 * 60)
    private val tomorrowAtNine: LocalDateTime = THE_DAY.plusDays(1).atTime(9, 0)

    private fun facts(
        latestDrink: Int? = null,
        goalMet: Boolean = false,
        lastShown: LocalDateTime? = null,
        lastLater: LocalDateTime? = null,
        snooze: LocalDateTime? = null,
    ) = ReminderFacts(THE_DAY, latestDrink, goalMet, lastShown, lastLater, snooze)

    private fun next(now: LocalDateTime, facts: ReminderFacts = facts(), settings: WaterSettings = hourly) =
        NextReminder.after(now, settings, facts)

    private fun minute(hour: Int, minute: Int) = hour * 60 + minute

    @Test
    fun theStartOfReminderHoursWithNoDrinkIsFromPlusOneInterval() {
        assertEquals(at(9, 0), next(at(6, 30)))
        assertEquals(at(9, 0), next(at(8, 0)))
        assertEquals(at(9, 0), next(at(8, 59, 59)))
    }

    @Test
    fun aDrinkIsCountedFromOneIntervalAfterIt() {
        assertEquals(at(11, 20), next(at(10, 21), facts(latestDrink = minute(10, 20))))
    }

    @Test
    fun aDrinkWithAnEarlierTimeDoesNotMoveTheCountBack() {
        // At 11:00 a drink for 09:30 is added. The last reminder was at 10:30.
        assertEquals(at(11, 30), next(at(11, 0), facts(latestDrink = minute(9, 30), lastShown = at(10, 30))))
    }

    @Test
    fun whenTheLatestDrinkIsDeletedTheCountFallsBackToTheLatestOfTheFourThatIsLeft() {
        val before = facts(latestDrink = minute(10, 20), lastShown = at(9, 0))
        assertEquals(at(11, 20), next(at(10, 30), before))
        // The drink at 10:20 is deleted, or its time made earlier: the reminder at 09:00 is the latest now.
        assertEquals(at(11, 0), next(at(10, 30), before.copy(latestDrinkMinute = minute(8, 15))))
        assertEquals(at(11, 0), next(at(10, 30), before.copy(latestDrinkMinute = null)))
    }

    @Test
    fun aReminderThatIsNotAnsweredCountsFromItself() {
        assertEquals(at(12, 20), next(at(11, 20), facts(lastShown = at(11, 20))))
    }

    @Test
    fun laterSnoozesForFifteenMinutesAndThenTheSnoozedReminderCounts() {
        val pressed = at(12, 22, 40)
        val snooze = NextReminder.snoozeAfter(pressed, hourly)
        assertEquals(at(12, 37), snooze)
        assertEquals(at(12, 37), next(pressed, facts(lastShown = at(12, 0), lastLater = pressed, snooze = snooze)))
        // The snoozed reminder is shown at 12:37 and not answered either: 1 interval after it.
        assertEquals(at(13, 37), next(at(12, 37), facts(lastShown = at(12, 37), lastLater = pressed)))
    }

    @Test
    fun laterWhenTheSnoozeWouldBeAfterUntilSetsNoSnoozeAndNoMoreReminderComesToday() {
        val pressed = at(21, 50)
        assertNull(NextReminder.snoozeAfter(pressed, hourly))
        assertEquals(tomorrowAtNine, next(pressed, facts(lastShown = at(21, 30), lastLater = pressed)))
    }

    @Test
    fun aDrinkTimedAtOrAfterThePressOfLaterEndsTheSnooze() {
        // Later at 12:22, then a drink at 12:30: no reminder at 12:37, next at 13:30.
        val pressed = at(12, 22)
        val snooze = NextReminder.snoozeAfter(pressed, hourly)
        val withDrink = facts(latestDrink = minute(12, 30), lastShown = at(12, 0), lastLater = pressed, snooze = snooze)
        assertEquals(at(13, 30), next(at(12, 30), withDrink))
        // A drink at the minute of the press is at the press: it ends the snooze too.
        assertEquals(at(13, 22), next(at(12, 23), withDrink.copy(latestDrinkMinute = minute(12, 22))))
    }

    @Test
    fun aDrinkEnteredWithAnEarlierTimeLeavesTheSnooze() {
        // Later at 12:22, then at 12:25 a drink for 11:00 is added: next at 12:37, then 13:37.
        val pressed = at(12, 22)
        val snooze = NextReminder.snoozeAfter(pressed, hourly)
        val withDrink = facts(latestDrink = minute(11, 0), lastShown = at(12, 0), lastLater = pressed, snooze = snooze)
        assertEquals(at(12, 37), next(at(12, 25), withDrink))
        assertEquals(at(13, 37), next(at(12, 37), withDrink.copy(lastShown = at(12, 37), snooze = null)))
    }

    @Test
    fun aNextTimeAfterUntilIsTomorrowAtFromPlusOneInterval() {
        assertEquals(tomorrowAtNine, next(at(21, 31), facts(latestDrink = minute(21, 30))))
        // A reminder at "Until" itself still comes.
        assertEquals(at(22, 0), next(at(21, 1), facts(latestDrink = minute(21, 0))))
    }

    @Test
    fun withTheGoalMetNoMoreReminderComesToday() {
        assertEquals(tomorrowAtNine, next(at(10, 0), facts(latestDrink = minute(9, 50), goalMet = true)))
        // A snooze does not come either.
        val snooze = at(10, 15)
        assertEquals(tomorrowAtNine, next(at(10, 1), facts(goalMet = true, lastLater = at(10, 0), snooze = snooze)))
    }

    @Test
    fun aDrinkDeletedOrChangedSoThatTheGoalIsNoLongerMetGivesTheRuleAgainFromNow() {
        val met = facts(latestDrink = minute(10, 0), goalMet = true)
        assertEquals(tomorrowAtNine, next(at(10, 5), met))
        assertEquals(at(11, 0), next(at(10, 5), met.copy(goalMet = false)))
    }

    @Test
    fun afterARestartRemindersAndASnoozeWhoseTimePassedAreSkipped() {
        // The last reminder at 10:00, the phone off from 10:30 to 12:20: no reminder at 11:00 or 12:00.
        assertEquals(at(13, 0), next(at(12, 20), facts(lastShown = at(10, 0))))
        // A snooze for 12:00 that passed while the phone was off: the next one counts from the press of Later.
        assertEquals(at(12, 45), next(at(12, 20), facts(lastShown = at(11, 0), lastLater = at(11, 45), snooze = at(12, 0))))
    }

    @Test
    fun remindersTurnedOnOrChangedGiveTheRuleAgainFromNow() {
        // Turned on at 14:10, the last drink at 13:50.
        assertEquals(at(14, 50), next(at(14, 10), facts(latestDrink = minute(13, 50))))
        // "Every" changed to 30 minutes at 14:10.
        assertEquals(at(14, 20), next(at(14, 10), facts(latestDrink = minute(13, 50)), hourly.copy(intervalMinutes = 30)))
    }

    @Test
    fun theRuleWorksInTheLocalTimeItIsGiven() {
        // After a change of the time zone the same facts give the rule in the new local time.
        val facts = facts(latestDrink = minute(10, 20))
        assertEquals(at(11, 20), next(at(9, 0), facts))
        assertEquals(at(12, 20), next(at(11, 40), facts))
    }

    @Test
    fun atMidnightTheCountStartsAtFromOfTheNewDay() {
        val newDay = THE_DAY.plusDays(1)
        val facts = ReminderFacts(newDay, latestDrinkMinute = null, goalMet = false, lastShown = at(21, 0), lastLater = at(21, 50))
        assertEquals(newDay.atTime(9, 0), NextReminder.after(newDay.atTime(0, 1), hourly, facts))
    }

    @Test
    fun withRemindersOffThereIsNoAlarm() {
        assertNull(next(at(10, 0), settings = hourly.copy(remindersOn = false)))
    }

    @Test
    fun whenNoReminderFitsBetweenFromAndUntilThereIsNoAlarm() {
        val short = hourly.copy(fromMinute = 8 * 60, untilMinute = 8 * 60 + 45)
        assertNull(next(at(7, 0), settings = short))
        assertEquals(at(8, 45), next(at(7, 0), settings = short.copy(intervalMinutes = 45)))
    }

    @Test
    fun theFactsMustBeAboutTheDayOfNow() {
        assertThrows(IllegalArgumentException::class.java) {
            NextReminder.after(THE_DAY.plusDays(1).atTime(9, 0), hourly, facts())
        }
    }
}
