package app.shkriuss.feature.water

import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.water.data.WaterDatabase
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
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

    /** The phone's time zone. A test changes it as a trip does. */
    private var zone: ZoneId = UTC
    private val time = WaterTime(clock) { zone }
    private val repository = WaterRepository(database, clock, TestIdSource())

    /** How long the source of today's date asked to wait, each time, in milliseconds. */
    private val waits = CopyOnWriteArrayList<Long>()
    private val waitEnds = Channel<Unit>(Channel.UNLIMITED)
    private val sourceScope = CoroutineScope(Dispatchers.Unconfined)

    /** The one source of today's date, as `WaterServices` builds it, with a wait that the test ends. */
    private val date = WaterToday(time, sourceScope) { millis ->
        waits += millis
        waitEnds.receive()
    }

    /** The time the source waits for has passed: it reads the clock again, by itself. */
    private fun theWaitEnds() {
        waitEnds.trySend(Unit)
    }

    @After
    fun closeTheDatabase() {
        sourceScope.cancel()
        database.close()
    }

    private fun today() = DayViewModel(repository, time, date, work = Dispatchers.Unconfined)

    private fun dayOf(fixed: java.time.LocalDate) = DayViewModel(repository, time, date, fixed, Dispatchers.Unconfined)

    private fun history() = HistoryViewModel(repository, date, Dispatchers.Unconfined)

    private fun settings() = SettingsViewModel(repository, date, Dispatchers.Unconfined)

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

        model.undo(screen.snackbar!!)
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
        // The snackbar comes when the drink is written, the list when Room tells of it: either can come first.
        val saved = model.state.await { it.drinks.isNotEmpty() && it.snackbar != null }
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

        model.undo(deleted.snackbar!!)
        assertEquals(listOf(drink), model.state.await { it.drinks.isNotEmpty() }.drinks)
    }

    @Test
    fun undoOnAnOlderSnackbarDeletesTheDrinkItNamedAndLeavesTheNewerSnackbar() {
        val model = today()
        model.loaded()
        model.addQuick(1)
        val first = model.state.await { it.snackbar != null }.snackbar!!
        model.addQuick(2)
        val second = model.state.await { it.drinks.size == 2 && it.snackbar != first }.snackbar!!

        // Undo on "Added 250 ml" comes after the second drink was stored, before its snackbar replaced the first.
        model.undo(first)

        val after = model.state.await { it.drinks.size == 1 }
        assertEquals("the drink the message named is gone", second.drinkId, after.drinks.single().id)
        assertEquals("the newer snackbar stays", second, after.snackbar)
        model.snackbarDismissed(first)
        assertEquals(second, model.state.value.snackbar)
    }

    @Test
    fun anAmountInThePhonesOwnDigitsIsSaved() {
        val model = today()
        model.loaded()
        model.openAdd()

        // 250 in Arabic-Indic digits, as a keyboard of a phone in Arabic types it.
        model.onAmountChange("\u0662\u0665\u0660")
        assertFalse(model.sheetThat { it.amountText == "\u0662\u0665\u0660" }.amountError)
        model.save()

        assertEquals(listOf(250), model.state.await { it.drinks.isNotEmpty() }.drinks.map { it.amountMl })
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
    fun atMidnightTodayMovesToTheNewDayByItself() {
        clock.setTo(at(23, 59, 30))
        val model = today()
        runBlocking { repository.addDrink(THE_DAY, 600, 250) }
        model.state.await { it.drinks.isNotEmpty() }
        assertEquals("the source waits until midnight", listOf(30_000L), waits)

        clock.setTo(THE_DAY.plusDays(1).atTime(0, 0))
        theWaitEnds()

        val newDay = model.state.await { it.day == THE_DAY.plusDays(1) }
        assertEquals(emptyList<Drink>(), newDay.drinks)
        assertTrue(newDay.isToday)
    }

    @Test
    fun theSourceOfTodaysDateReadsTheClockAtLeastOnceAMinuteAndOnlyWhileAScreenObservesIt() {
        assertEquals("no screen, no wait", emptyList<Long>(), waits)

        today().loaded()
        theWaitEnds()
        theWaitEnds()

        assertEquals("at 14:05 midnight is far, so a minute each time", listOf(60_000L, 60_000L, 60_000L), waits)
    }

    @Test
    fun afterAChangeOfTheTimeZoneTodayMovesAndOtherAmountSavesADrinkOnTheNewDay() {
        val model = today()
        assertEquals(THE_DAY, model.loaded().day)

        // 14:05 in UTC is 04:05 on the next day fourteen hours further east.
        zone = ZoneOffset.ofHours(14)
        theWaitEnds()

        val moved = model.state.await { it.loaded && it.day == THE_DAY.plusDays(1) }
        assertTrue(moved.isToday)
        model.openAdd()
        model.onAmountChange("300")
        model.save()
        val drink = model.state.await { it.drinks.isNotEmpty() }.drinks.single()
        assertEquals(THE_DAY.plusDays(1), drink.day)
        assertEquals(4 * 60 + 5, drink.minuteOfDay)
    }

    @Test
    fun anOpenDayKeepsItsDayAtMidnightAndIsNoLongerToday() {
        val model = dayOf(THE_DAY)
        assertTrue(model.loaded().isToday)

        clock.setTo(THE_DAY.plusDays(1).atTime(0, 1))
        theWaitEnds()

        val after = model.state.await { !it.isToday }
        assertEquals("the day that was opened stays", THE_DAY, after.day)
        assertTrue(after.loaded)
    }

    @Test
    fun whenTheScreenComesToTheFrontTheDateIsReadAtOnce() {
        val model = today()
        model.loaded()

        clock.setTo(THE_DAY.plusDays(1).atTime(7, 0))
        date.check()

        assertEquals(THE_DAY.plusDays(1), model.state.await { it.day != THE_DAY }.day)
    }

    @Test
    fun fromShowUntilTheNewDaysDrinksAreReadTheDayIsNotLoadedAndNothingOfTheDayBeforeShows() {
        val before = THE_DAY.minusDays(2)
        val opened = THE_DAY.minusDays(1)
        runBlocking {
            repository.addDrink(before, 600, 300)
            repository.addDrink(opened, 610, 400)
        }
        val model = dayOf(before)
        model.state.await { it.loaded && it.totalMl == 300 }
        // Every state the screen gets from now on.
        val seen = CopyOnWriteArrayList<DayScreen>()
        val watching = CoroutineScope(Dispatchers.Unconfined).launch { model.state.collect { seen += it } }
        try {
            seen.clear()

            model.show(opened)

            // From the moment show() returns: the new day, with nothing of the day before. Room reads the drinks on
            // its own thread, and the ViewModel's work runs there too in this test, so the new day can already be
            // loaded by the time the test reads the state (CI run 143). That the first state after show() is not
            // loaded is checked below, on every state the screen got.
            val right = model.state.value
            assertEquals(opened, right.day)
            if (right.loaded) {
                assertEquals(400, right.totalMl)
                assertEquals(listOf(400), right.drinks.map { it.amountMl })
            } else {
                assertEquals(0, right.totalMl)
                assertEquals(emptyList<Drink>(), right.drinks)
            }
            // Then the new day's drinks.
            assertEquals(400, model.state.await { it.loaded }.totalMl)
            assertTrue("no state shows the day before: $seen", seen.none { it.day == before })
            assertTrue("a loaded state is the new day's: $seen", seen.filter { it.loaded }.all { it.day == opened && it.totalMl == 400 })
            assertFalse("the first state after show() is not loaded", seen.first().loaded)
        } finally {
            watching.cancel()
        }
    }

    @Test
    fun theOpenDayMovesToTheDayHistoryOpensAndClosesTheSheetAndSnackbarOfTheDayBefore() {
        runBlocking {
            repository.addDrink(THE_DAY.minusDays(2), 600, 300)
            repository.addDrink(THE_DAY.minusDays(1), 610, 400)
        }
        val model = dayOf(THE_DAY)
        model.loaded()

        model.show(THE_DAY.minusDays(2))
        assertEquals(300, model.state.await { it.day == THE_DAY.minusDays(2) && it.totalMl == 300 }.totalMl)
        model.openAdd()
        model.sheetThat()

        model.show(THE_DAY.minusDays(1))
        val next = model.state.await { it.day == THE_DAY.minusDays(1) && it.totalMl == 400 }
        assertNull("The sheet of the day before closed", next.sheet)
        assertNull(next.snackbar)
        assertFalse(next.isToday)
    }

    @Test(expected = IllegalStateException::class)
    fun todayFollowsTheClockAndRefusesToShowAnotherDay() {
        today().show(THE_DAY.minusDays(1))
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
    fun atMidnightHistoryGainsTheNewDayByItself() {
        runBlocking { repository.addDrink(THE_DAY, 600, 250) }
        val model = history()
        model.state.await { it.days.size == 1 }
        clock.setTo(THE_DAY.plusDays(1).atTime(0, 1))
        theWaitEnds()
        val screen = model.state.await { it.days.size == 2 }
        assertEquals(HistoryDay(THE_DAY.plusDays(1), 0, 2_000), screen.days.first())
        assertEquals(THE_DAY.plusDays(1), screen.today)
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
    fun afterTheDateIsSetBackSettingsShowAndSaveTheGoalOfThatDay() {
        runBlocking {
            repository.setGoal(THE_DAY.minusDays(2), 1_500)
            repository.setGoal(THE_DAY, 3_000)
        }
        val model = settings()
        assertEquals(3_000, model.state.await { it.loaded && it.goalMl == 3_000 }.goalMl)

        // The phone's date goes back one day.
        clock.setTo(THE_DAY.minusDays(1).atTime(14, 5))
        theWaitEnds()

        assertEquals("the goal of the day that is today now", 1_500, model.state.await { it.goalMl != 3_000 }.goalMl)
        assertTrue(model.setGoal("1800", model.state.value.goalMl))
        val goals = runBlocking { repository.goals().first { it.goalOf(THE_DAY.minusDays(1).asWaterDay()) == 1_800 } }
        assertEquals("the day before keeps its goal", 1_500, goals.goalOf(THE_DAY.minusDays(2).asWaterDay()))
    }

    @Test
    fun aGoalDialogLeftOpenWhileTheDateChangesWritesNothingWhenItIsSavedUnchanged() {
        runBlocking {
            repository.setGoal(THE_DAY.minusDays(2), 1_500)
            repository.setGoal(THE_DAY, 3_000)
            repository.changeSettings { it.copy(unit = WaterUnit.US_FLUID_OUNCES) }
        }
        val model = settings()
        // The dialog opens with today's goal, 3,000 ml, shown as 101 fl oz.
        val opened = model.state.await { it.loaded && it.goalMl == 3_000 && it.settings.unit == WaterUnit.US_FLUID_OUNCES }.goalMl
        val text = AmountInput.textOf(opened, WaterUnit.US_FLUID_OUNCES)
        assertEquals("101", text)

        // While it is open, the phone's date goes back one day. That day's goal is 1,500 ml.
        clock.setTo(THE_DAY.minusDays(1).atTime(14, 5))
        theWaitEnds()
        model.state.await { it.goalMl == 1_500 }
        val before = runBlocking { database.goals().all() }

        assertTrue("Save, with nothing changed", model.setGoal(text, opened))

        assertEquals("nothing is written", before, runBlocking { database.goals().all() })
        assertEquals(1_500, model.state.value.goalMl)
    }

    @Test
    fun theGoalIsTypedInTheUnitShownAndRefusedOutsideItsLimits() {
        val model = settings()
        model.state.await { it.loaded }
        assertFalse(model.setGoal("499", model.state.value.goalMl))
        assertFalse(model.setGoal("10001", model.state.value.goalMl))
        assertFalse(model.setGoal("two", model.state.value.goalMl))
        assertTrue(model.setGoal("2500", model.state.value.goalMl))
        assertEquals(2_500, model.state.await { it.goalMl == 2_500 }.goalMl)

        model.setUnit(WaterUnit.US_FLUID_OUNCES)
        model.state.await { it.settings.unit == WaterUnit.US_FLUID_OUNCES }
        assertFalse(model.setGoal("16", model.state.value.goalMl))
        assertTrue(model.setGoal("68", model.state.value.goalMl))
        assertEquals(2_011, model.state.await { it.goalMl == 2_011 }.goalMl)
    }

    @Test
    fun inFluidOuncesAGoalAndQuickAmountsThatWereNotChangedKeepTheirMillilitres() {
        runBlocking {
            repository.setGoal(THE_DAY, 2_000)
            repository.changeSettings { it.copy(unit = WaterUnit.US_FLUID_OUNCES, cup1Ml = 150, cup2Ml = 250, cup3Ml = 500) }
        }
        val model = settings()
        val shown = model.state.await { it.loaded && it.settings.unit == WaterUnit.US_FLUID_OUNCES }
        // What the dialogs open with: the stored amounts, rounded to whole fluid ounces.
        val goalText = AmountInput.textOf(shown.goalMl, WaterUnit.US_FLUID_OUNCES)
        val cupTexts = shown.settings.quickAmountsMl.map { AmountInput.textOf(it, WaterUnit.US_FLUID_OUNCES) }
        assertEquals("68", goalText)
        assertEquals(listOf("5", "8", "17"), cupTexts)
        val goalsBefore = runBlocking { database.goals().all() }
        val settingsBefore = runBlocking { database.settings().all() }

        assertTrue(model.setGoal(goalText, shown.goalMl))
        assertEquals(emptyList<Int>(), model.setQuickAmounts(cupTexts, shown.settings.quickAmountsMl))

        assertEquals("the goal is not written again", goalsBefore, runBlocking { database.goals().all() })
        assertEquals("nor the settings", settingsBefore, runBlocking { database.settings().all() })
        assertEquals(2_000, model.state.value.goalMl)

        // One quick amount is changed. The two others keep their millilitres.
        assertEquals(emptyList<Int>(), model.setQuickAmounts(listOf("5", "10", "17"), shown.settings.quickAmountsMl))
        assertEquals(listOf(150, 296, 500), model.state.await { it.settings.cup2Ml != 250 }.settings.quickAmountsMl)

        // A goal that is typed anew is taken as typed.
        assertTrue(model.setGoal("70", model.state.value.goalMl))
        assertEquals(2_070, model.state.await { it.goalMl != 2_000 }.goalMl)
    }

    @Test
    fun twoChangesOfOneSettingMadeOneRightAfterTheOtherLandInTheOrderTheyWereMade() {
        // The screen and its database work on one thread that takes the newest work first.
        val work = NewestFirstWork()
        val busy = memoryDatabaseOn(work)
        try {
            val stored = WaterRepository(busy, clock, TestIdSource())
            val model = SettingsViewModel(stored, date, work)
            model.state.await { it.loaded }
            // Both changes are made before the phone gets to the first one.
            work.hold()
            model.setInterval(30)
            model.setInterval(90)

            work.letGo()
            work.awaitIdle()

            assertEquals("The change made last is the one that is stored", 90, runBlocking { stored.settingsNow() }.intervalMinutes)
            assertEquals("and the one that shows", 90, model.state.value.settings.intervalMinutes)
        } finally {
            busy.close()
            work.close()
        }
    }

    @Test
    fun aGoalSavedWhileAnotherChangeIsStillWrittenCountsFromTheDayItWasSaved() {
        val work = NewestFirstWork()
        val busy = memoryDatabaseOn(work)
        try {
            val stored = WaterRepository(busy, clock, TestIdSource())
            val model = SettingsViewModel(stored, date, work)
            val shown = model.state.await { it.loaded }
            // A change of "Every" is not written yet when the goal is saved, a moment before midnight.
            work.hold()
            model.setInterval(30)
            assertTrue(model.setGoal("2500", shown.goalMl))
            clock.setTo(THE_DAY.plusDays(1).atTime(0, 1))
            theWaitEnds()
            date.date.await { it == THE_DAY.plusDays(1) }

            work.letGo()
            work.awaitIdle()

            val goals = runBlocking { stored.goals().first() }
            assertEquals("The goal counts from the day it was saved", 2_500, goals.goalOf(THE_DAY.asWaterDay()))
            assertEquals(30, runBlocking { stored.settingsNow() }.intervalMinutes)
        } finally {
            busy.close()
            work.close()
        }
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
        assertEquals(listOf(1, 2), model.setQuickAmounts(listOf("200", "0", "3001"), model.state.value.settings.quickAmountsMl))
        assertEquals(emptyList<Int>(), model.setQuickAmounts(listOf("200", "330", "750"), model.state.value.settings.quickAmountsMl))
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
