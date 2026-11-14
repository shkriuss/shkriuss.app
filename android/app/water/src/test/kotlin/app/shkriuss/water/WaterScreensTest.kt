package app.shkriuss.water

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performTextReplacement
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.R as DesignR
import app.shkriuss.feature.water.R
import java.time.ZoneOffset
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * What Water's screens do and what TalkBack hears
 * (docs/apps/water/spec.md, "Screens" and "TalkBack and accessibility"),
 * with the real activity and the app lock off, on Friday 13 November 2026
 * at 14:05 with the 24-hour clock. The rules behind the screens have their
 * own tests in feature/water; these check what the user sees and does.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = UnlockedWaterApp::class, qualifiers = PHONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WaterScreensTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var scenario: ActivityScenario<WaterActivity>

    @After
    fun closeTheScreen() {
        if (::scenario.isInitialized) scenario.close()
    }

    private fun start() {
        use24HourClock()
        scenario = ActivityScenario.launch(WaterActivity::class.java)
        // Today shows its buttons once the first read of the database is in.
        compose.waitForText(words(R.string.water_other_amount))
    }

    // Today.

    @Test
    fun theSummaryIsReadAsOneItemAndTheBarIsNotASecondOne() {
        seed {
            addDrink(THE_DAY, 9 * 60, 1_000)
            addDrink(THE_DAY, 11 * 60, 250)
        }
        start()

        compose.waitFor(hasContentDescription("1,250 of 2,000 millilitres today, 62 percent"))
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo)).assertCountEquals(0)
    }

    @Test
    fun goalReachedFollowsTheSummaryInWordsOnceTheGoalIsMet() {
        seed { addDrink(THE_DAY, 9 * 60, 2_000) }
        start()

        compose.waitFor(hasContentDescription("2,000 of 2,000 millilitres today, 100 percent. Goal reached"))
    }

    @Test
    fun aQuickAmountIsReadInWordsAndLogsADrinkThatUndoTakesAway() {
        start()
        compose.waitForText(words(R.string.water_no_drinks_today))

        // The button's 48dp touch target is checked with the design system's buttons (ShkComponentsTest).
        compose.onNode(hasContentDescription("Add 250 millilitres") and hasClickAction()).tapAsTalkBack()
        compose.waitForText("Added 250 ml")
        val row = compose.onNode(hasText("14:05 · 250 ml") and hasClickAction())
        row.assert(hasContentDescription("14:05, 250 millilitres"))
            .assert(SemanticsMatcher("its action is Edit") { it.config[SemanticsActions.OnClick].label == "Edit" })
            .assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)

        compose.tap(R.string.water_undo)
        compose.waitForText(words(R.string.water_no_drinks_today))
    }

    @Test
    fun theSheetNamesAWrongAmountAndStaysOpen() {
        start()
        compose.tap(R.string.water_other_amount)
        compose.waitForText(words(R.string.water_add_drink))

        compose.tap(R.string.water_save)
        compose.waitFor(hasError("Enter an amount from 1 to 3,000 ml."))
        compose.onNode(hasText(words(R.string.water_add_drink))).assertIsDisplayed()
        // TalkBack reads the unit after the field in words.
        field(R.string.water_amount).assert(hasText("millilitres"))

        field(R.string.water_amount).performTextReplacement("330")
        compose.tap(R.string.water_save)
        compose.waitForText("14:05 · 330 ml")
    }

    @Test
    fun aDrinkIsEditedAndDeletedAndUndoBringsItBack() {
        seed { addDrink(THE_DAY, 9 * 60 + 30, 300) }
        start()
        compose.waitForText("09:30 · 300 ml")

        compose.tap("09:30 · 300 ml")
        compose.waitForText(words(R.string.water_edit_drink))
        field(R.string.water_amount).performTextReplacement("350")
        compose.tap(R.string.water_save)
        compose.waitForText("09:30 · 350 ml")

        compose.tap("09:30 · 350 ml")
        compose.tap(R.string.water_delete)
        compose.waitForText(words(R.string.water_drink_deleted))
        compose.waitForText(words(R.string.water_no_drinks_today))
        compose.tap(R.string.water_undo)
        compose.waitForText("09:30 · 350 ml")
    }

    @Test
    fun turningThePhoneKeepsWhatWasTyped() {
        start()
        compose.tap(R.string.water_other_amount)
        field(R.string.water_amount).performTextReplacement("320")

        scenario.recreate()
        compose.waitForIdle()

        compose.waitFor(hasText("320") and SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText))
    }

    @Test
    fun atMidnightTodayMovesToTheNewDayWhenTheScreenComesBack() {
        seed { addDrink(THE_DAY, 9 * 60, 300) }
        start()
        compose.waitForText("09:00 · 300 ml")

        testApp.test.clock.nowMillis = THE_DAY.plusDays(1).atTime(0, 1).toInstant(ZoneOffset.UTC).toEpochMilli()
        scenario.moveToState(Lifecycle.State.CREATED)
        scenario.moveToState(Lifecycle.State.RESUMED)

        compose.waitForText(words(R.string.water_no_drinks_today))
    }

    @Test
    fun theHeadersAreHeadings() {
        start()
        compose.waitForText(words(R.string.water_drinks_today))
        compose.onNode(hasText(words(R.string.water_drinks_today))).assert(isHeading())

        compose.tap(R.string.water_settings)
        listOf(R.string.water_section_drinking, R.string.water_section_reminders, R.string.water_section_about).forEach {
            compose.onNode(hasText(words(it))).assert(isHeading())
        }
    }

    // The quick amounts by width.

    @Test
    fun onAPhoneTheFourButtonsAreTwoRowsOfTwo() {
        start()
        compose.waitForText(words(R.string.water_other_amount))
        val tops = quickButtonBounds().map { it.top }
        assertEquals(tops[0], tops[1], 1f)
        assertEquals(tops[2], tops[3], 1f)
        assertTrue("two rows", tops[2] > tops[0])
    }

    @Test
    fun onAPhoneAtALargeFontEachButtonTakesItsOwnRow() {
        RuntimeEnvironment.setFontScale(2f)
        start()
        compose.waitForText(words(R.string.water_other_amount))
        val tops = quickButtonBounds().map { it.top }
        assertEquals("four rows", tops.sorted(), tops)
        assertEquals(4, tops.distinct().size)
    }

    @Test
    @Config(qualifiers = MEDIUM)
    fun inAMediumWindowTheFourButtonsShareOneRow() {
        start()
        compose.waitForText(words(R.string.water_other_amount))
        assertEquals(1, quickButtonBounds().map { it.top.toInt() }.distinct().size)
    }

    @Test
    @Config(qualifiers = TABLET)
    fun inAnExpandedWindowTheDrinksAreInAPaneOfTheirOwn() {
        start()
        compose.waitForText(words(R.string.water_drinks_today))
        val header = compose.onNode(hasText(words(R.string.water_drinks_today))).fetchSemanticsNode().boundsInRoot
        val other = compose.onNode(hasText(words(R.string.water_other_amount))).fetchSemanticsNode().boundsInRoot
        assertTrue("the drinks pane is at the end, beside the buttons", header.left > other.right)
    }

    // Navigation.

    @Test
    fun backFromHistoryOrSettingsGoesToTodayAndBackFromTodayLeaves() {
        start()
        compose.tap(R.string.water_settings)
        compose.waitForText(words(R.string.water_version))
        pressBack()
        destination(R.string.water_today).assertIsSelected()

        compose.tap(R.string.water_history)
        pressBack()
        destination(R.string.water_today).assertIsSelected()

        // On Today nothing of Water takes Back, so Android leaves the app.
        scenario.onActivity { assertFalse(it.onBackPressedDispatcher.hasEnabledCallbacks()) }
    }

    @Test
    fun aDayOpensInPlaceAndBackReturnsToTheListAtTheSamePlace() {
        seed { (0L until 40L).forEach { addDrink(THE_DAY.minusDays(it), 9 * 60, 500) } }
        start()
        compose.tap(R.string.water_history)
        compose.waitForText(words(R.string.water_yesterday))
        compose.onNode(hasScrollAction()).performScrollToIndex(30)
        // 30 days before Friday 13 November.
        val row = "Wed, Oct 14"
        compose.waitForText(row)

        compose.tap(row)
        compose.waitForText("Wednesday, October 14, 2026")
        compose.onNode(hasText(words(R.string.water_add_drink)) and hasClickAction()).assertIsDisplayed()
        pressBack()

        compose.onNode(hasText(row) and hasClickAction()).assertIsDisplayed()
        destination(R.string.water_history).assertIsSelected()
    }

    @Test
    fun eachDestinationKeepsItsOpenDay() {
        seed { addDrink(THE_DAY.minusDays(1), 9 * 60, 500) }
        start()
        compose.tap(R.string.water_history)
        compose.tap(words(R.string.water_yesterday))
        compose.waitForText("Thursday, November 12, 2026")

        compose.tap(R.string.water_today)
        compose.waitForText(words(R.string.water_drinks_today))
        compose.tap(R.string.water_history)

        compose.waitForText("Thursday, November 12, 2026")
    }

    @Test
    fun aHistoryRowIsReadAsOneItemWithTheGoalThatDayHad() {
        seed {
            addDrink(THE_DAY.minusDays(1), 9 * 60, 1_800)
            setGoal(THE_DAY, 2_500)
        }
        start()
        compose.tap(R.string.water_history)
        compose.waitForText(words(R.string.water_yesterday))

        compose.onNode(hasText(words(R.string.water_yesterday)) and hasClickAction())
            .assert(hasContentDescription("Yesterday, 1,800 of 2,000 millilitres"))
        compose.onNode(hasText(words(R.string.water_today)) and hasClickAction() and hasText("0 of 2,500 ml"))
            .assert(hasContentDescription("Today, 0 of 2,500 millilitres"))
    }

    @Test
    fun withNoDrinkEverHistorySaysSo() {
        start()
        compose.tap(R.string.water_history)
        compose.waitForText(words(R.string.water_history_empty_title))
    }

    @Test
    @Config(qualifiers = TABLET)
    fun inAnExpandedWindowWithNoDayOpenTheSecondPaneSaysChooseADay() {
        seed { addDrink(THE_DAY, 9 * 60, 500) }
        start()
        compose.tap(R.string.water_history)
        compose.waitForText(words(R.string.water_choose_a_day))
    }

    // Settings.

    @Test
    fun settingsAreReadWithTheUnitInWords() {
        start()
        compose.tap(R.string.water_settings)
        compose.waitForText(words(R.string.water_version))
        compose.onNode(hasText(words(R.string.water_daily_goal)) and hasClickAction())
            .assert(hasContentDescription("Daily goal, 2,000 millilitres"))
        compose.onNode(hasText(words(R.string.water_quick_amounts)) and hasClickAction())
            .assert(hasContentDescription("Quick amounts, 150 millilitres, 250 millilitres, 500 millilitres"))
    }

    @Test
    fun theGoalDialogKeepsTheOldGoalAndStaysOpenOnAGoalTooSmall() {
        openSetting(R.string.water_daily_goal)

        field(R.string.water_daily_goal).performTextReplacement("400")
        compose.tap(R.string.water_save)
        compose.waitFor(hasError("Enter a goal from 500 to 10,000 ml."))
        assertEquals(2_000, goalOfToday())

        field(R.string.water_daily_goal).performTextReplacement("2500")
        compose.tap(R.string.water_save)
        compose.waitForText("2,500 ml")
        assertEquals(2_500, goalOfToday())
    }

    @Test
    fun aNewUnitTakesItsOwnDefaultQuickAmounts() {
        openSetting(R.string.water_unit)
        compose.tap(R.string.water_unit_fluid_ounces)
        compose.tap(R.string.water_save)

        compose.waitForText(words(R.string.water_unit_fluid_ounces))
        compose.waitForText("5 fl oz, 8 fl oz, 16 fl oz")
        compose.waitForText("68 fl oz")
    }

    @Test
    fun theQuickAmountsDialogNamesOnlyTheWrongFieldAndKeepsTheOldAmounts() {
        openSetting(R.string.water_quick_amounts)
        field(R.string.water_second).performTextReplacement("4000")
        compose.tap(R.string.water_save)

        compose.waitFor(hasError("Enter an amount from 1 to 3,000 ml."))
        field(R.string.water_second).assert(hasError("Enter an amount from 1 to 3,000 ml."))
        field(R.string.water_first).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.Error))
        assertEquals(listOf(150, 250, 500), settings().quickAmountsMl)

        field(R.string.water_second).performTextReplacement("300")
        compose.tap(R.string.water_save)
        compose.waitForText("150 ml, 300 ml, 500 ml")
    }

    @Test
    fun everyChangesTheIntervalAndSaysWhenNoReminderFits() {
        seed { changeSettings { it.copy(fromMinute = 20 * 60) } }
        openSetting(R.string.water_every)
        compose.tap(R.string.water_every_180)
        compose.tap(R.string.water_save)

        compose.waitForText(words(R.string.water_no_reminder_fits))
        assertEquals(180, settings().intervalMinutes)
    }

    @Test
    fun untilRefusesATimeLessThanThirtyMinutesAfterFromInThePicker() {
        openSetting(R.string.water_until)
        field(DesignR.string.shk_hour).performTextReplacement("08")
        field(DesignR.string.shk_minute).performTextReplacement("20")
        compose.tap(DesignR.string.shk_ok)

        compose.waitForText(words(R.string.water_until_too_early))
        assertEquals(22 * 60, settings().untilMinute)

        field(DesignR.string.shk_hour).performTextReplacement("21")
        compose.tap(DesignR.string.shk_ok)
        compose.waitForText("21:20")
        assertEquals(21 * 60 + 20, settings().untilMinute)
    }

    @Test
    fun fromRefusesATimeLessThanThirtyMinutesBeforeUntil() {
        openSetting(R.string.water_from)
        field(DesignR.string.shk_hour).performTextReplacement("21")
        field(DesignR.string.shk_minute).performTextReplacement("45")
        compose.tap(DesignR.string.shk_ok)

        compose.waitForText(words(R.string.water_until_too_early))
        assertEquals(8 * 60, settings().fromMinute)
    }

    private fun openSetting(name: Int) {
        start()
        compose.tap(R.string.water_settings)
        compose.waitForText(words(R.string.water_version))
        compose.tap(name)
    }

    private fun field(label: Int) = compose.onNode(
        hasText(words(label)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText),
    )

    private fun destination(label: Int) = compose.onNode(
        hasText(words(label)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected),
    )

    private fun quickButtonBounds(): List<Rect> =
        listOf("Add 150 millilitres", "Add 250 millilitres", "Add 500 millilitres").map {
            compose.onNode(hasContentDescription(it)).fetchSemanticsNode().boundsInRoot
        } + compose.onNode(hasText(words(R.string.water_other_amount)) and hasClickAction()).fetchSemanticsNode().boundsInRoot

    private fun pressBack() {
        scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    private fun goalOfToday(): Int = runBlocking {
        testApp.test.services.repository.goals().first().goalOf(THE_DAY.toEpochDay().toInt())
    }

    private fun settings() = runBlocking { testApp.test.services.repository.settings().first() }
}

/** A phone, close to the Pixel 9 Pro, as in the screenshots. */
private const val PHONE = "w411dp-h914dp-normal-long-notround-port-420dpi"

/** A medium window, from 600dp: a small tablet, or a phone on its side. */
private const val MEDIUM = "w700dp-h900dp-xlarge-port-xhdpi"

/** An expanded window, from 840dp: the Pixel Tablet. */
private const val TABLET = "w1280dp-h800dp-xlarge-long-notround-land-xhdpi"
