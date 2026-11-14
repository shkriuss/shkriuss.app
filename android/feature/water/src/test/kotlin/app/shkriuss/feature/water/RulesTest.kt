package app.shkriuss.feature.water

import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.water.data.GoalEntity
import app.shkriuss.feature.water.data.SettingsEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The goal of a day and the settings in use (docs/apps/water/spec.md,
 * "The goal of a day" and "The settings in use").
 */
class RulesTest {
    private val day = THE_DAY.asWaterDay()

    private fun fields(number: Long, updatedAt: Long, deletedAt: Long? = null) =
        RecordFields(TestIdSource.idNumber(number), createdAt = 1, updatedAt = updatedAt, deletedAt = deletedAt)

    private fun goal(number: Long, amountMl: Int, fromDay: Int, updatedAt: Long = number, deletedAt: Long? = null) =
        GoalEntity(fields(number, updatedAt, deletedAt), number, amountMl, fromDay)

    private fun settings(number: Long, updatedAt: Long, deletedAt: Long? = null, cup1Ml: Int = 150) = SettingsRules.recordWith(
        SettingsEntity(fields(number, updatedAt, deletedAt), number, 0, 0, 0, 0, false, 0, 0, 0),
        WaterSettings(cup1Ml = cup1Ml),
    )

    // The goal of a day.

    @Test
    fun withNoGoalTheGoalIsTwoThousandMillilitres() {
        assertEquals(2_000, GoalRules.goalOf(day, emptyList()))
    }

    @Test
    fun theGoalWithTheLatestFromDayOnOrBeforeTheDayCounts() {
        val goals = listOf(goal(1, 1_500, day - 10), goal(2, 2_500, day - 3), goal(3, 3_000, day + 1))
        assertEquals(2_000, GoalRules.goalOf(day - 11, goals))
        assertEquals(1_500, GoalRules.goalOf(day - 4, goals))
        assertEquals(2_500, GoalRules.goalOf(day - 3, goals))
        assertEquals(2_500, GoalRules.goalOf(day, goals))
        assertEquals(3_000, GoalRules.goalOf(day + 1, goals))
    }

    @Test
    fun aDeletedGoalNeverCounts() {
        val goals = listOf(goal(1, 1_500, day - 10), goal(2, 2_500, day - 3, deletedAt = 50))
        assertEquals(1_500, GoalRules.goalOf(day, goals))
    }

    @Test
    fun ofTwoGoalsFromTheSameDayTheLaterEditCountsAndThenTheLargerId() {
        assertEquals(1_800, GoalRules.goalOf(day, listOf(goal(2, 2_500, day, updatedAt = 10), goal(1, 1_800, day, updatedAt = 20))))
        assertEquals(2_500, GoalRules.goalOf(day, listOf(goal(2, 2_500, day, updatedAt = 10), goal(1, 1_800, day, updatedAt = 10))))
    }

    @Test
    fun theTimelineGivesTheSameGoalAsTheRuleForEveryDay() {
        val goals = listOf(
            goal(1, 1_500, day - 10), goal(2, 2_500, day - 3, updatedAt = 30), goal(3, 2_200, day - 3, updatedAt = 20),
            goal(4, 9_000, day - 5, deletedAt = 7),
        )
        val timeline = GoalRules.Timeline(goals)
        for (each in day - 12..day + 2) assertEquals(GoalRules.goalOf(each, goals), timeline.goalOf(each))
    }

    @Test
    fun aChangeUpdatesTheGoalOfTodayOrCreatesOneFromToday() {
        val fromToday = goal(1, 2_500, day)
        assertEquals(GoalChange.Update(fromToday.record.id), GoalRules.change(day, 3_000, listOf(fromToday)))
        assertEquals(GoalChange.Create, GoalRules.change(day, 3_000, listOf(goal(1, 2_500, day - 1))))
        assertEquals(GoalChange.Create, GoalRules.change(day, 3_000, emptyList()))
    }

    @Test
    fun aChangeToTheGoalTodayAlreadyHasWritesNothing() {
        assertEquals(GoalChange.NoChange, GoalRules.change(day, 2_000, emptyList()))
        assertEquals(GoalChange.NoChange, GoalRules.change(day, 2_500, listOf(goal(1, 2_500, day - 4))))
    }

    // The settings in use.

    @Test
    fun withNoSettingsRecordTheDefaultsCount() {
        assertNull(SettingsRules.inUse(emptyList()))
        val defaults = SettingsRules.settingsOf(null)
        assertEquals(WaterUnit.MILLILITRES, defaults.unit)
        assertEquals(listOf(150, 250, 500), defaults.quickAmountsMl)
        assertFalse(defaults.remindersOn)
        assertEquals(60, defaults.intervalMinutes)
        assertEquals(8 * 60, defaults.fromMinute)
        assertEquals(22 * 60, defaults.untilMinute)
    }

    @Test
    fun theRecordWithTheLatestUpdatedAtThatIsNotDeletedIsInUse() {
        val older = settings(1, updatedAt = 10, cup1Ml = 100)
        val newer = settings(2, updatedAt = 20, cup1Ml = 200)
        val deleted = settings(3, updatedAt = 30, deletedAt = 30, cup1Ml = 300)
        assertEquals(newer, SettingsRules.inUse(listOf(newer, older, deleted)))
        assertEquals(200, SettingsRules.settingsOf(SettingsRules.inUse(listOf(older, deleted, newer))).cup1Ml)
        // A tie, which only a restore or sync can bring: the larger ID, until step 5.1 decides.
        assertEquals(newer, SettingsRules.inUse(listOf(newer, settings(1, updatedAt = 20, cup1Ml = 100))))
    }

    @Test
    fun aChangeOfTheUnitChangesQuickAmountsThatAreStillTheDefaults() {
        val ounces = SettingsRules.withUnit(WaterSettings(), WaterUnit.US_FLUID_OUNCES)
        assertEquals(listOf(148, 237, 473), ounces.quickAmountsMl)
        assertEquals(listOf(150, 250, 500), SettingsRules.withUnit(ounces, WaterUnit.MILLILITRES).quickAmountsMl)
    }

    @Test
    fun aChangeOfTheUnitKeepsQuickAmountsTheUserChose() {
        val chosen = WaterSettings(cup1Ml = 150, cup2Ml = 330, cup3Ml = 500)
        assertEquals(listOf(150, 330, 500), SettingsRules.withUnit(chosen, WaterUnit.US_FLUID_OUNCES).quickAmountsMl)
        assertEquals(WaterUnit.US_FLUID_OUNCES, SettingsRules.withUnit(chosen, WaterUnit.US_FLUID_OUNCES).unit)
    }

    @Test
    fun untilIsAtLeastThirtyMinutesAfterFromOnTheSameDay() {
        assertTrue(SettingsRules.hoursAllowed(8 * 60, 8 * 60 + 30))
        assertFalse(SettingsRules.hoursAllowed(8 * 60, 8 * 60 + 29))
        assertTrue(SettingsRules.hoursAllowed(23 * 60 + 29, 23 * 60 + 59))
        assertFalse(SettingsRules.hoursAllowed(23 * 60 + 30, 23 * 60 + 59))
        assertFalse(SettingsRules.hoursAllowed(0, 24 * 60))
        assertFalse(SettingsRules.hoursAllowed(-1, 60))
    }

    @Test
    fun aReminderFitsOnlyIfFromPlusOneIntervalIsNotAfterUntil() {
        assertTrue(WaterSettings().reminderFits)
        assertTrue(WaterSettings(intervalMinutes = 180, fromMinute = 600, untilMinute = 780).reminderFits)
        assertFalse(WaterSettings(intervalMinutes = 180, fromMinute = 600, untilMinute = 779).reminderFits)
    }

    @Test
    fun onlySettingsInsideTheirLimitsAreValid() {
        assertTrue(SettingsRules.isValid(WaterSettings()))
        assertFalse(SettingsRules.isValid(WaterSettings(cup2Ml = 0)))
        assertFalse(SettingsRules.isValid(WaterSettings(cup3Ml = 3_001)))
        assertFalse(SettingsRules.isValid(WaterSettings(intervalMinutes = 50)))
        assertFalse(SettingsRules.isValid(WaterSettings(fromMinute = 600, untilMinute = 620)))
    }
}
