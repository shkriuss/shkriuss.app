package app.shkriuss.water

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ActivityScenario
import app.shkriuss.feature.water.R
import app.shkriuss.feature.water.SettingsRules
import app.shkriuss.feature.water.WaterUnit
import app.shkriuss.core.design.R as DesignR
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshots of every screen, sheet and dialog of Water
 * (docs/apps/water/spec.md, "Every screen", point 6), in the eight
 * standard configurations: phone and tablet, light and dark, font scale
 * 1.0 and 2.0. Each starts the real activity with the app lock off, on a
 * database written as the user would have, on Friday 13 November 2026 at
 * 14:05, with the 24-hour clock of the spec's examples.
 *
 * A screen that scrolls is captured to its end, in parts. A sheet or a
 * dialog is captured with the screen dimmed behind it. On the tablet,
 * Today and History show two panes.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@Config(application = UnlockedWaterApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WaterScreenshotTest(private val config: ScreenshotConfig) {
    private val compose = createEmptyComposeRule()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(config.rule()).around(compose)

    private var scenario: ActivityScenario<WaterActivity>? = null

    @After
    fun closeTheScreen() {
        scenario?.close()
    }

    // Today.

    @Test
    fun todayEmpty() {
        start()
        compose.waitForText(words(R.string.water_no_drinks_today))
        compose.captureWholeScreen("TodayEmpty", config)
    }

    @Test
    fun todayWithDrinks() {
        seed {
            addDrink(THE_DAY, 8 * 60 + 10, 300)
            addDrink(THE_DAY, 10 * 60 + 20, 250)
            addDrink(THE_DAY, 12 * 60 + 40, 500)
        }
        start()
        compose.waitForText("12:40", substring = true)
        compose.captureWholeScreen("TodayDrinks", config)
    }

    /**
     * Today right after a tap on "+250 ml": the snackbar "Added 250 ml"
     * with Undo, at the bottom of the screen. The tap is TalkBack's, so no
     * ripple is left on the button. One image: the snackbar stays at the
     * bottom while the screen scrolls, and the whole screen is in
     * TodayDrinks.
     */
    @Test
    fun todayWithTheSnackbarAfterAQuickAmount() {
        seed {
            addDrink(THE_DAY, 8 * 60 + 10, 300)
            addDrink(THE_DAY, 10 * 60 + 20, 250)
            addDrink(THE_DAY, 12 * 60 + 40, 500)
        }
        start()
        compose.waitForText("12:40", substring = true)
        compose.onNode(hasContentDescription("Add 250 millilitres")).tapAsTalkBack()
        compose.waitForText(words(R.string.water_added, "250 ml"))
        compose.waitForText(words(R.string.water_undo))
        // The snackbar comes as soon as the drink is written. The list and the
        // total come a moment later, when Room tells the screen of the change.
        compose.waitForText("14:05 · 250 ml")
        captureWindows("TodaySnackbar")
    }

    @Test
    fun todayGoalReached() {
        seed {
            addDrink(THE_DAY, 7 * 60 + 30, 800)
            addDrink(THE_DAY, 11 * 60, 700)
            addDrink(THE_DAY, 13 * 60 + 50, 600)
        }
        start()
        compose.waitForText("13:50", substring = true)
        compose.captureWholeScreen("TodayGoalReached", config)
    }

    @Test
    fun todayInFluidOunces() {
        seed {
            changeSettings { SettingsRules.withUnit(it, WaterUnit.US_FLUID_OUNCES) }
            addDrink(THE_DAY, 9 * 60, 237)
            addDrink(THE_DAY, 12 * 60 + 15, 355)
        }
        start()
        compose.waitForText("12 fl oz", substring = true)
        compose.captureWholeScreen("TodayFluidOunces", config)
    }

    @Test
    fun addADrink() {
        start()
        compose.waitForText(words(R.string.water_no_drinks_today))
        compose.tap(R.string.water_other_amount)
        compose.waitForText(words(R.string.water_add_drink))
        captureWindows("AddDrink")
    }

    @Test
    fun editADrinkWithBothErrors() {
        seed { addDrink(THE_DAY, 9 * 60 + 30, 250) }
        start()
        compose.waitForText("09:30", substring = true)
        compose.tap("09:30", substring = true)
        compose.waitForText(words(R.string.water_edit_drink))
        field(R.string.water_amount).performTextReplacement("4000")
        compose.tap(R.string.water_time)
        field(DesignR.string.shk_hour).performTextReplacement("15")
        field(DesignR.string.shk_minute).performTextReplacement("30")
        compose.tap(DesignR.string.shk_ok)
        compose.tap(R.string.water_save)
        compose.waitForText(words(R.string.water_time_not_yet))
        captureWindows("EditDrinkErrors")
    }

    // History.

    @Test
    fun historyEmpty() {
        start()
        compose.tap(R.string.water_history)
        compose.waitForText(words(R.string.water_history_empty_title))
        compose.captureWholeScreen("HistoryEmpty", config)
    }

    @Test
    fun historyWithDays() {
        seedAWeek()
        start()
        compose.tap(R.string.water_history)
        compose.waitForText(words(R.string.water_yesterday))
        compose.captureWholeScreen("HistoryDays", config)
    }

    @Test
    fun aDayOpen() {
        seedAWeek()
        start()
        compose.tap(R.string.water_history)
        compose.waitForText(words(R.string.water_yesterday))
        compose.tap(words(R.string.water_yesterday))
        // The title of the day shows once that day's drinks are read.
        compose.waitForText("Thursday, November 12, 2026")
        compose.captureWholeScreen("DayOpen", config)
    }

    // Settings.

    @Test
    fun settings() {
        start()
        compose.tap(R.string.water_settings)
        compose.waitForText(words(R.string.water_version))
        compose.captureWholeScreen("Settings", config)
    }

    @Test
    fun settingsWhenNoReminderFits() {
        seed { changeSettings { it.copy(intervalMinutes = 180, fromMinute = 21 * 60) } }
        start()
        compose.tap(R.string.water_settings)
        compose.waitForText(words(R.string.water_no_reminder_fits))
        compose.captureWholeScreen("SettingsNoReminderFits", config)
    }

    @Test
    fun theGoalDialogRefusesAGoalTooSmall() {
        openSetting(R.string.water_daily_goal)
        field(R.string.water_daily_goal).performTextReplacement("400")
        compose.tap(R.string.water_save)
        compose.waitFor(hasError(words(R.string.water_goal_error, "500", "10,000 ml")))
        captureWindows("GoalDialogRefused")
    }

    @Test
    fun theUnitDialog() {
        openSetting(R.string.water_unit)
        captureWindows("UnitDialog")
    }

    @Test
    fun theQuickAmountsDialogRefusesAnAmountTooLarge() {
        openSetting(R.string.water_quick_amounts)
        field(R.string.water_second).performTextReplacement("4000")
        compose.tap(R.string.water_save)
        compose.waitFor(hasError(words(R.string.water_amount_error, "1", "3,000 ml")))
        captureWindows("QuickAmountsRefused")
    }

    @Test
    fun theEveryDialog() {
        openSetting(R.string.water_every)
        captureWindows("EveryDialog")
    }

    @Test
    fun untilRefusesATimeTooSoonAfterFrom() {
        openSetting(R.string.water_until)
        field(DesignR.string.shk_hour).performTextReplacement("08")
        field(DesignR.string.shk_minute).performTextReplacement("10")
        compose.tap(DesignR.string.shk_ok)
        compose.waitForText(words(R.string.water_until_too_early))
        captureWindows("UntilRefused")
    }

    /** Starts Water on Today. */
    private fun start() {
        use24HourClock()
        scenario = ActivityScenario.launch(WaterActivity::class.java)
        // Today shows its buttons once the first read of the database is in.
        compose.waitForText(words(R.string.water_other_amount))
    }

    /** Starts Water, opens Settings and the dialog of the setting [name]. */
    private fun openSetting(name: Int) {
        start()
        compose.tap(R.string.water_settings)
        compose.waitForText(words(R.string.water_version))
        compose.tap(name)
        compose.waitForIdle()
    }

    /**
     * Seven days of drinks before today, two with none, and a goal that
     * changed three days ago: past days keep the goal they had.
     */
    private fun seedAWeek() = seed {
        addDrink(THE_DAY.minusDays(6), 9 * 60, 1_500)
        addDrink(THE_DAY.minusDays(6), 15 * 60, 600)
        addDrink(THE_DAY.minusDays(5), 10 * 60, 1_200)
        addDrink(THE_DAY.minusDays(3), 11 * 60, 1_000)
        setGoal(THE_DAY.minusDays(3), 2_500)
        addDrink(THE_DAY.minusDays(2), 12 * 60, 2_600)
        addDrink(THE_DAY.minusDays(1), 8 * 60 + 45, 750)
        addDrink(THE_DAY.minusDays(1), 13 * 60 + 5, 500)
        addDrink(THE_DAY, 9 * 60, 250)
    }

    /** The text field labelled with string [label]. */
    private fun field(label: Int) = compose.onNode(
        hasText(words(label)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText),
    )

    /** The whole screen, every window in it: a sheet or a dialog over the screen. Roborazzi marks this as experimental. */
    @OptIn(ExperimentalRoborazziApi::class)
    private fun captureWindows(name: String) {
        compose.waitForIdle()
        captureScreenRoboImage("src/test/screenshots/${name}_${config.name}.png")
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun configs(): List<ScreenshotConfig> = ScreenshotConfig.all()
    }
}
