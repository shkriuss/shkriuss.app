package app.shkriuss.feature.water

import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.water.data.WaterDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The ViewModels of Today, Day, History and Settings on a real database
 * in memory, at 14:05 on Friday, 13 November 2026. Their work runs at
 * once on the thread that starts it, and each test waits for the state it
 * expects.
 */
@RunWith(RobolectricTestRunner::class)
class ViewModelsTest {
    private val database: WaterDatabase = memoryDatabase()
    private val clock = clockAt(at(14, 5))
    private val time = WaterTime(clock) { UTC }
    private val repository = WaterRepository(database, clock, TestIdSource())

    @After
    fun closeTheDatabase() = database.close()

    private fun today() = DayViewModel(repository, time, work = Dispatchers.Unconfined)

    private fun dayOf(fixed: java.time.LocalDate) = DayViewModel(repository, time, fixed, Dispatchers.Unconfined)

    private fun history() = HistoryViewModel(repository, time, Dispatchers.Unconfined)

    private fun settings() = SettingsViewModel(repository, time, Dispatchers.Unconfined)

    private fun DayViewModel.loaded() = state.await { it.loaded }

    /**
     * Waits until the screen's state shows an open sheet that [condition]
     * accepts, and returns it. An action changes the sheet at once, and the
     * screen's state follows a moment later.
     */
    private fun DayViewModel.sheetThat(condition: (DrinkSheet) -> Boolean = { true }): DrinkSheet =
        state.await { screen -> screen.sheet?.let(condition) == true }.sheet!!

    /** Waits until the screen's state shows no sheet. */
    private fun DayViewModel.sheetClosed() = state.await { it.sheet == null }

    // Today and Day.

    @Test
    fun todayStartsEmptyWithTheDefaults() {
        val screen = today().loaded()
        assertEquals(THE_DAY, screen.day)
        assertTrue(screen.isToday)
        assertEquals(0, screen.totalMl)
        assertEquals(2_000, screen.goalMl)
        assertEquals(listOf(150, 250, 500), screen.quickAmountsMl)
        assertEquals(emptyList<Drink>(), screen.drinks)
    }

    @Test
    fun aQuickAmountLogsADrinkNowAndTheSnackbarOffersUndo() {
        val model = today()
        model.loaded()

        model.addQuick(1)
        val screen = model.state.await { it.drinks.isNotEmpty() && it.snackbar != null }

        assertEquals(Drink(TestIdSource.idNumber(1), THE_DAY, 14 * 60 + 5, 250), screen.drinks.single())
        assertEquals(DrinkSnackbar(DrinkSnackbar.Kind.ADDED, TestIdSource.idNumber(1), 250), screen.snackbar)
        assertEquals(250, screen.totalMl)
        assertEquals(12, screen.percent)

        model.undo()
        val undone = model.state.await { it.drinks.isEmpty() && it.snackbar == null }
        assertNull(undone.snackbar)
        assertNotNull("Undo only marks the drink as deleted", runBlocking { database.intake().find(TestIdSource.idNumber(1)) })
    }

    @Test
    fun theSummaryShowsGoalReachedFromTheGoalOn() {
        runBlocking {
            repository.setGoal(THE_DAY, 1_000)
            repository.addDrink(THE_DAY, 600, 999)
        }
        val model = today()
        assertFalse(model.state.await { it.loaded && it.totalMl == 999 }.goalReached)

        runBlocking { repository.addDrink(THE_DAY, 610, 1) }
        val met = model.state.await { it.totalMl == 1_000 }
        assertTrue(met.goalReached)
        assertEquals(100, met.percent)
    }

    @Test
    fun addADrinkStartsEmptyAtNowOnTodayAndAtNoonOnAnotherDay() {
        val model = today()
        model.loaded()
        model.openAdd()
        assertEquals(DrinkSheet(drinkId = null, day = THE_DAY, amountText = "", minuteOfDay = 14 * 60 + 5), model.sheetThat())

        val yesterday = dayOf(THE_DAY.minusDays(1))
        assertFalse(yesterday.loaded().isToday)
        yesterday.openAdd()
        assertEquals(12 * 60, yesterday.sheetThat().minuteOfDay)
    }

    @Test
    fun saveRefusesAnAmountOutsideTheLimitsAndATimeThatHasNotComeYet() {
        val model = today()
        model.loaded()
        model.openAdd()

        model.save()
        model.sheetThat { it.amountError } // An empty amount is refused.
        model.onAmountChange("3001")
        assertTrue(model.sheetThat { it.amountText == "3001" }.amountError)
        model.onAmountChange("300")
        assertFalse("the error follows what is typed", model.sheetThat { it.amountText == "300" }.amountError)

        model.onTimeChange(14 * 60 + 6)
        assertTrue("one minute after now, on today", model.sheetThat { it.minuteOfDay == 14 * 60 + 6 }.timeError)
        model.save()

        // Save did nothing: the sheet is still open, so it takes the next change.
        model.onTimeChange(9 * 60)
        assertFalse(model.sheetThat { it.minuteOfDay == 9 * 60 }.timeError)
        model.save()
        val saved = model.state.await { it.drinks.isNotEmpty() && it.sheet == null }
        assertNull(saved.sheet)
        assertEquals(Drink(TestIdSource.idNumber(1), THE_DAY, 9 * 60, 300), saved.drinks.single())
    }

    @Test
    fun aTimeLaterThanNowIsAllowedOnAnotherDay() {
        val model = dayOf(THE_DAY.minusDays(1))
        model.loaded()
        model.openAdd()
        model.onAmountChange("250")
        model.onTimeChange(23 * 60 + 30)
        assertFalse(model.sheetThat { it.minuteOfDay == 23 * 60 + 30 }.timeError)

        model.save()
        val saved = model.state.await { it.drinks.isNotEmpty() }
        assertEquals(THE_DAY.minusDays(1), saved.drinks.single().day)
        assertEquals(DrinkSnackbar.Kind.ADDED, saved.snackbar?.kind)
    }

    @Test
    fun editADrinkSavesItsNewTimeAndAmountAndKeepsItsDay() {
        val drink = runBlocking { repository.addDrink(THE_DAY, 600, 250) }
        val model = today()
        model.state.await { it.drinks.isNotEmpty() }

        model.openEdit(drink)
        val sheet = model.sheetThat()
        assertTrue(sheet.isEdit)
        assertEquals("250", sheet.amountText)
        model.onAmountChange("400")
        model.onTimeChange(615)
        model.save()

        val edited = model.state.await { it.drinks.single().amountMl == 400 }
        assertEquals(Drink(drink.id, THE_DAY, 615, 400), edited.drinks.single())
        assertNull("an edit shows no snackbar", edited.snackbar)
    }

    @Test
    fun saveWithNoChangeClosesTheSheetAndWritesNothingAlsoInFluidOunces() {
        // 250 ml shows as 8 fl oz. Saving 8 again must not turn it into 237 ml.
        val drink = runBlocking {
            repository.changeSettings { it.copy(unit = WaterUnit.US_FLUID_OUNCES) }
            repository.addDrink(THE_DAY, 600, 250)
        }
        val model = today()
        model.state.await { it.drinks.isNotEmpty() && it.unit == WaterUnit.US_FLUID_OUNCES }
        val numberBefore = runBlocking { database.intake().find(drink.id)!!.changeNumber }

        model.openEdit(drink)
        assertEquals("8", model.sheetThat().amountText)
        model.save()
        model.sheetClosed()

        model.openEdit(drink)
        model.onTimeChange(620)
        model.save()
        val moved = model.state.await { it.drinks.single().minuteOfDay == 620 }
        assertEquals("the amount stays as stored", 250, moved.drinks.single().amountMl)
        assertTrue(runBlocking { database.intake().find(drink.id)!!.changeNumber } > numberBefore)
    }

    @Test
    fun deleteClosesTheSheetAndUndoBringsTheDrinkBack() {
        val drink = runBlocking { repository.addDrink(THE_DAY, 600, 250) }
        val model = today()
        model.state.await { it.drinks.isNotEmpty() }

        model.openEdit(drink)
        model.delete()
        val deleted = model.state.await { it.drinks.isEmpty() && it.snackbar != null && it.sheet == null }
        assertNull(deleted.sheet)
        assertEquals(DrinkSnackbar(DrinkSnackbar.Kind.DELETED, drink.id, 250), deleted.snackbar)

        model.undo()
        assertEquals(listOf(drink), model.state.await { it.drinks.isNotEmpty() }.drinks)
    }

    @Test
    fun cancelClosesTheSheetAndWritesNothing() {
        val model = today()
        model.loaded()
        model.openAdd()
        model.onAmountChange("250")
        model.sheetThat { it.amountText == "250" }
        model.cancel()
        model.sheetClosed()
        assertEquals(emptyList<Drink>(), runBlocking { repository.drinksOf(THE_DAY).first() })
    }

    @Test
    fun aPastDayKeepsTheGoalItHadAfterTheGoalChanges() {
        runBlocking {
            repository.setGoal(THE_DAY.minusDays(2), 1_500)
            repository.setGoal(THE_DAY, 3_000)
        }
        assertEquals(1_500, dayOf(THE_DAY.minusDays(1)).state.await { it.loaded }.goalMl)
        assertEquals(3_000, today().state.await { it.loaded && it.goalMl == 3_000 }.goalMl)
    }

    @Test
    fun atMidnightTodayMovesToTheNewDay() {
        val model = today()
        runBlocking { repository.addDrink(THE_DAY, 600, 250) }
        model.state.await { it.drinks.isNotEmpty() }

        clock.setTo(THE_DAY.plusDays(1).atTime(0, 1))
        model.checkTheDay()

        val newDay = model.state.await { it.day == THE_DAY.plusDays(1) }
        assertEquals(emptyList<Drink>(), newDay.drinks)
        assertTrue(newDay.isToday)
    }

    @Test
    fun aFixedDayDoesNotMoveAtMidnight() {
        val model = dayOf(THE_DAY)
        model.loaded()
        clock.setTo(THE_DAY.plusDays(1).atTime(0, 1))
        model.checkTheDay()
        assertEquals(THE_DAY, model.state.value.day)
    }

    // History.

    @Test
    fun historyIsEmptyWithNoDrinkEver() {
        val screen = history().state.await { it.loaded }
        assertTrue(screen.isEmpty)
    }

    @Test
    fun historyHasEveryDayFromTheFirstDrinkToTodayNewestFirstEmptyDaysToo() {
        runBlocking {
            repository.setGoal(THE_DAY.minusDays(3), 1_000)
            repository.addDrink(THE_DAY.minusDays(3), 600, 1_200)
            repository.addDrink(THE_DAY, 600, 250)
            repository.deleteDrink(repository.addDrink(THE_DAY.minusDays(5), 600, 400).id)
        }
        val screen = history().state.await { it.loaded && it.days.isNotEmpty() }

        assertEquals(
            listOf(
                HistoryDay(THE_DAY, 250, 1_000),
                HistoryDay(THE_DAY.minusDays(1), 0, 1_000),
                HistoryDay(THE_DAY.minusDays(2), 0, 1_000),
                HistoryDay(THE_DAY.minusDays(3), 1_200, 1_000),
            ),
            screen.days,
        )
        assertTrue(screen.days.last().goalReached)
        assertFalse(screen.days.first().goalReached)
    }

    @Test
    fun aDayOfHistoryOpensAndCloses() {
        val model = history()
        model.state.await { it.loaded }
        model.open(THE_DAY.minusDays(1))
        assertEquals(THE_DAY.minusDays(1), model.state.await { it.openDay != null }.openDay)
        model.close()
        assertNull(model.state.await { it.openDay == null }.openDay)
    }

    @Test
    fun atMidnightHistoryGainsTheNewDay() {
        runBlocking { repository.addDrink(THE_DAY, 600, 250) }
        val model = history()
        model.state.await { it.days.size == 1 }
        clock.setTo(THE_DAY.plusDays(1).atTime(0, 1))
        model.checkTheDay()
        val screen = model.state.await { it.days.size == 2 }
        assertEquals(HistoryDay(THE_DAY.plusDays(1), 0, 2_000), screen.days.first())
    }

    // Settings.

    @Test
    fun settingsShowTheDefaultsAndTheGoalOfToday() {
        val screen = settings().state.await { it.loaded }
        assertEquals(WaterSettings(), screen.settings)
        assertEquals(2_000, screen.goalMl)
        assertFalse(screen.noReminderFits)
    }

    @Test
    fun theGoalIsTypedInTheUnitShownAndRefusedOutsideItsLimits() {
        val model = settings()
        model.state.await { it.loaded }
        assertFalse(model.setGoal("499"))
        assertFalse(model.setGoal("10001"))
        assertFalse(model.setGoal("two"))
        assertTrue(model.setGoal("2500"))
        assertEquals(2_500, model.state.await { it.goalMl == 2_500 }.goalMl)

        model.setUnit(WaterUnit.US_FLUID_OUNCES)
        model.state.await { it.settings.unit == WaterUnit.US_FLUID_OUNCES }
        assertFalse(model.setGoal("16"))
        assertTrue(model.setGoal("68"))
        assertEquals(2_011, model.state.await { it.goalMl == 2_011 }.goalMl)
    }

    @Test
    fun aChangeOfTheUnitTakesTheDefaultQuickAmountsOfTheNewUnit() {
        val model = settings()
        model.state.await { it.loaded }
        model.setUnit(WaterUnit.US_FLUID_OUNCES)
        assertEquals(listOf(148, 237, 473), model.state.await { it.settings.unit == WaterUnit.US_FLUID_OUNCES }.settings.quickAmountsMl)
    }

    @Test
    fun quickAmountsAreWrittenOnlyWhenAllThreeAreInsideTheLimits() {
        val model = settings()
        model.state.await { it.loaded }
        assertEquals(listOf(1, 2), model.setQuickAmounts(listOf("200", "0", "3001")))
        assertEquals(emptyList<Int>(), model.setQuickAmounts(listOf("200", "330", "750")))
        assertEquals(listOf(200, 330, 750), model.state.await { it.settings.cup1Ml == 200 }.settings.quickAmountsMl)
    }

    @Test
    fun theRemindersSwitchAndTheIntervalChangeAtOnce() {
        val model = settings()
        model.state.await { it.loaded }
        model.setRemindersOn(true)
        model.setInterval(90)
        val screen = model.state.await { it.settings.remindersOn && it.settings.intervalMinutes == 90 }
        assertTrue(screen.settings.remindersOn)
    }

    @Test
    fun fromAndUntilKeepTheOldTimeWhenUntilWouldBeLessThanThirtyMinutesAfterFrom() {
        val model = settings()
        model.state.await { it.loaded }
        assertFalse(model.setUntil(8 * 60 + 29))
        assertFalse(model.setFrom(21 * 60 + 31))
        assertTrue(model.setFrom(21 * 60 + 30))
        assertEquals(21 * 60 + 30, model.state.await { it.settings.fromMinute == 21 * 60 + 30 }.settings.fromMinute)
        assertEquals(22 * 60, model.state.value.settings.untilMinute)
    }

    @Test
    fun whenNoReminderFitsSettingsSaySoAndTheChangeIsKept() {
        val model = settings()
        model.state.await { it.loaded }
        model.setFrom(21 * 60)
        model.state.await { it.settings.fromMinute == 21 * 60 }
        model.setInterval(180)
        val screen = model.state.await { it.settings.intervalMinutes == 180 }
        assertTrue(screen.noReminderFits)
    }
}
