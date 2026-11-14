package app.shkriuss.feature.water

import app.shkriuss.core.data.BEFORE_FIRST_CHANGE
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.water.data.DayTotal
import app.shkriuss.feature.water.data.WaterDatabase
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The repository on a real database in memory: every write is stamped and
 * only marks deletes, every read leaves deleted drinks out, and the goal
 * and the settings change as the spec says.
 */
@RunWith(RobolectricTestRunner::class)
class WaterRepositoryTest {
    private val database: WaterDatabase = memoryDatabase()
    private val clock = clockAt(at(14, 5))
    private val repository = WaterRepository(database, clock, TestIdSource())

    @After
    fun closeTheDatabase() = database.close()

    private fun drinks() = runBlocking { repository.drinksOf(THE_DAY).first() }

    @Test
    fun aDrinkIsStoredWithItsDayTimeAndAmount() = runBlocking {
        val drink = repository.addDrink(THE_DAY, 14 * 60 + 5, 250)

        assertEquals(Drink(TestIdSource.idNumber(1), THE_DAY, 845, 250), drink)
        val row = database.intake().find(drink.id)!!
        assertEquals(THE_DAY.toEpochDay().toInt(), row.day)
        assertEquals(clock.nowMillis, row.record.createdAt)
        assertEquals(1L, row.changeNumber)
    }

    @Test
    fun theDrinksOfADayAreNewestFirstAndLeaveOutOtherDaysAndDeletedDrinks() = runBlocking {
        val early = repository.addDrink(THE_DAY, 9 * 60, 150)
        val late = repository.addDrink(THE_DAY, 13 * 60, 500)
        val sameMinuteLater = repository.addDrink(THE_DAY, 9 * 60, 250).also { clock.advanceBy(1) }
        repository.addDrink(THE_DAY.minusDays(1), 10 * 60, 300)
        val deleted = repository.addDrink(THE_DAY, 11 * 60, 400)
        repository.deleteDrink(deleted.id)

        assertEquals(listOf(late, sameMinuteLater, early).map { it.id }, drinks().map { it.id })
    }

    @Test
    fun deletingOnlyMarksAndUndoBringsTheDrinkBack() = runBlocking {
        val drink = repository.addDrink(THE_DAY, 600, 250)

        assertNotNull(repository.deleteDrink(drink.id))
        assertEquals(emptyList<Drink>(), drinks())
        assertNotNull("the row stays, marked", database.intake().find(drink.id)?.record?.deletedAt)
        assertNull("a deleted drink cannot be deleted again", repository.deleteDrink(drink.id))

        assertEquals(drink, repository.bringBackDrink(drink.id))
        assertEquals(listOf(drink), drinks())
    }

    @Test
    fun aChangeKeepsTheDayAndAChangeToNothingWritesNothing() = runBlocking {
        val drink = repository.addDrink(THE_DAY, 600, 250)
        clock.advanceBy(1_000)

        val changed = repository.changeDrink(drink.id, 610, 300)!!
        assertEquals(Drink(drink.id, THE_DAY, 610, 300), changed)
        val numberAfterChange = database.intake().find(drink.id)!!.changeNumber

        repository.changeDrink(drink.id, 610, 300)
        assertEquals(numberAfterChange, database.intake().find(drink.id)!!.changeNumber)
    }

    @Test
    fun amountsAndTimesOutsideTheirLimitsAreRefused() {
        assertThrows(IllegalArgumentException::class.java) { runBlocking { repository.addDrink(THE_DAY, 600, 0) } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { repository.addDrink(THE_DAY, 600, 3_001) } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { repository.addDrink(THE_DAY, 1_440, 250) } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { repository.setGoal(THE_DAY, 499) } }
        assertEquals(emptyList<Drink>(), drinks())
    }

    @Test
    fun theTotalsOfEveryDayLeaveOutDeletedDrinks() = runBlocking {
        repository.addDrink(THE_DAY, 600, 250)
        repository.addDrink(THE_DAY, 700, 500)
        repository.addDrink(THE_DAY.minusDays(2), 700, 150)
        repository.deleteDrink(repository.addDrink(THE_DAY, 800, 1_000).id)

        val totals = repository.dayTotals().first().sortedBy { it.day }
        assertEquals(listOf(DayTotal(THE_DAY.minusDays(2).asWaterDay(), 150), DayTotal(THE_DAY.asWaterDay(), 750)), totals)
        assertEquals(DayFacts(totalMl = 750, goalMl = 2_000, latestDrinkMinute = 700), repository.factsOf(THE_DAY))
        assertEquals(DayFacts(totalMl = 0, goalMl = 2_000, latestDrinkMinute = null), repository.factsOf(THE_DAY.minusDays(1)))
    }

    @Test
    fun aNewGoalCountsFromTodayAndPastDaysKeepTheirs() = runBlocking {
        repository.setGoal(THE_DAY.minusDays(3), 1_500)
        repository.setGoal(THE_DAY, 2_500)

        val goals = repository.goals().first()
        assertEquals(2_000, goals.goalOf(THE_DAY.minusDays(4).asWaterDay()))
        assertEquals(1_500, goals.goalOf(THE_DAY.minusDays(1).asWaterDay()))
        assertEquals(2_500, goals.goalOf(THE_DAY.asWaterDay()))
        assertEquals(2, database.goals().all().size)
    }

    @Test
    fun aSecondChangeOnTheSameDayUpdatesThatDaysGoal() = runBlocking {
        repository.setGoal(THE_DAY, 2_500)
        clock.advanceBy(1_000)
        repository.setGoal(THE_DAY, 3_000)
        repository.setGoal(THE_DAY, 3_000)

        val stored = database.goals().all()
        assertEquals(1, stored.size)
        assertEquals(3_000, stored.single().amountMl)
        assertEquals("the same goal again writes nothing", 2L, stored.single().changeNumber)
    }

    @Test
    fun theFirstChangeOfASettingCreatesTheRecordAndLaterChangesUpdateIt() = runBlocking {
        assertEquals(WaterSettings(), repository.settings().first())

        repository.changeSettings { it.copy(remindersOn = true) }
        clock.advanceBy(1_000)
        repository.changeSettings { it.copy(intervalMinutes = 90) }

        val stored = database.settings().all()
        assertEquals(1, stored.size)
        assertEquals(WaterSettings(remindersOn = true, intervalMinutes = 90), repository.settings().first())
        assertEquals(clock.nowMillis, stored.single().record.updatedAt)
    }

    @Test
    fun aChangeToNothingCreatesNoSettingsRecord() = runBlocking {
        repository.changeSettings { it }
        assertEquals(emptyList<Any>(), database.settings().all())
    }

    @Test
    fun settingsOutsideTheirLimitsAreRefusedAndNothingIsWritten() = runBlocking {
        assertThrows(IllegalArgumentException::class.java) { runBlocking { repository.changeSettings { it.copy(intervalMinutes = 50) } } }
        assertEquals(emptyList<Any>(), database.settings().all())
    }

    @Test
    fun everyWriteOfEveryTableTakesTheNextChangeNumber() = runBlocking {
        val drink = repository.addDrink(THE_DAY, 600, 250)
        repository.setGoal(THE_DAY, 2_500)
        repository.changeSettings { it.copy(remindersOn = true) }
        repository.deleteDrink(drink.id)

        val numbers = database.intake().changedSince(BEFORE_FIRST_CHANGE, 10).map { it.changeNumber } +
            database.goals().changedSince(BEFORE_FIRST_CHANGE, 10).map { it.changeNumber } +
            database.settings().changedSince(BEFORE_FIRST_CHANGE, 10).map { it.changeNumber }
        assertEquals(listOf(4L, 2L, 3L), numbers)
    }
}
