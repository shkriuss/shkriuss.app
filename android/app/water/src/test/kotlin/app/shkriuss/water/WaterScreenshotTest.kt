package app.shkriuss.water

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ActivityScenario
import app.shkriuss.feature.water.R
import app.shkriuss.feature.water.SettingsRules
import app.shkriuss.feature.water.WaterReminders
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.core.security.R as SecurityR
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.feature.water.WaterUnit
import app.shkriuss.core.design.R as DesignR
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import java.util.concurrent.CountDownLatch
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshots of every screen, sheet and dialog of Water
 * (docs/apps/water/spec.md, "Every screen", point 6), in the four
 * standard configurations: phone light at font scale 1.0, phone dark at
 * 2.0, tablet light at 2.0 and tablet dark at 1.0. Each starts the real
 * activity with the app lock off, on a database written as the user
 * would have, on Friday 13 November 2026 at 14:05, with the 24-hour clock
 * of the spec's examples.
 *
 * A screen that scrolls is captured to its end, in parts. A sheet or a
 * dialog is captured with the screen dimmed behind it. On the tablet,
 * Today and History show two panes. The reminder line of Today has one
 * screenshot for each of its six states.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@Config(application = UnlockedWaterApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WaterScreenshotTest(private val config: ScreenshotConfig) {
    private val compose = createEmptyComposeRule()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(config.rule()).around(compose)

    private var scenario: ActivityScenario<WaterActivity>? = null

    /** Holds a backup that is being written, so that its progress dialog stays for the screenshot. */
    private val held = CountDownLatch(1)

    @After
    fun closeTheScreen() {
        held.countDown()
        TestDocuments.onOpen = {}
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
        compose.waitForSettings()
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

    // Reminders: the reminder line of Today in each of its six states, Settings with reminders on, and the question.

    @Test
    fun todayWithTheNextReminder() {
        seed {
            changeSettings { it.copy(remindersOn = true) }
            addDrink(THE_DAY, 10 * 60 + 20, 250)
            addDrink(THE_DAY, 13 * 60 + 50, 500)
        }
        start()
        compose.waitForText("Next reminder at 14:50")
        compose.captureWholeScreen("TodayReminderNext", config)
    }

    @Test
    fun todayWhenTheGoalIsReachedWithRemindersOn() {
        seed {
            changeSettings { it.copy(remindersOn = true) }
            addDrink(THE_DAY, 9 * 60, 1_200)
            addDrink(THE_DAY, 13 * 60 + 30, 900)
        }
        start()
        compose.waitForText(words(R.string.water_reminder_goal_reached))
        compose.captureWholeScreen("TodayReminderGoalReached", config)
    }

    @Test
    fun todayWithNoMoreRemindersToday() {
        seed { changeSettings { it.copy(remindersOn = true, untilMinute = 14 * 60) } }
        start()
        compose.waitForText(words(R.string.water_reminder_none_left))
        compose.captureWholeScreen("TodayReminderNoneLeft", config)
    }

    @Test
    fun todayBeforeAndroidAskedForNotifications() {
        notificationsAllowed(false)
        seed { changeSettings { it.copy(remindersOn = true) } }
        start()
        compose.waitForText(words(R.string.water_allow))
        compose.captureWholeScreen("TodayNotAsked", config)
    }

    @Test
    fun todayWithNotificationsOff() {
        notificationsAllowed(false)
        testApp.test.notify.permissionAnswered()
        seed { changeSettings { it.copy(remindersOn = true) } }
        start()
        compose.waitForText(words(R.string.water_reminder_denied))
        compose.captureWholeScreen("TodayDenied", config)
    }

    @Test
    fun todayWithTheChannelOff() {
        seed { changeSettings { it.copy(remindersOn = true) } }
        // The user turns the channel off in Android's settings. The app's start made the channel.
        NotifyTestDevice(RuntimeEnvironment.getApplication()).turnOff(WaterReminders.CHANNEL)
        start()
        compose.waitForText(words(R.string.water_reminder_channel_off))
        compose.captureWholeScreen("TodayChannelOff", config)
    }

    @Test
    fun settingsWithRemindersOn() {
        seed { changeSettings { it.copy(remindersOn = true) } }
        start()
        compose.tap(R.string.water_settings)
        compose.waitForText("Next reminder at 15:00")
        compose.captureWholeScreen("SettingsRemindersOn", config)
    }

    @Test
    fun settingsWithNotificationsOff() {
        notificationsAllowed(false)
        testApp.test.notify.permissionAnswered()
        seed { changeSettings { it.copy(remindersOn = true) } }
        start()
        compose.tap(R.string.water_settings)
        compose.waitForText(words(R.string.water_reminder_denied))
        compose.captureWholeScreen("SettingsDenied", config)
    }

    @Test
    fun theQuestionForNotifications() {
        notificationsAllowed(false)
        start()
        compose.tap(R.string.water_settings)
        compose.waitForSettings()
        compose.tap(R.string.water_remind_me)
        compose.waitForText(words(R.string.water_question_text))
        captureWindows("NotificationQuestion")
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

    // Backup, Security and Licences.

    @Test
    @Config(application = NewWaterApp::class)
    fun settingsWithNoRecoveryKey() {
        openSettings()
        compose.captureWholeScreen("SettingsNoRecoveryKey", config)
    }

    @Test
    @Config(application = StoppedSetupWaterApp::class)
    fun settingsAfterASetupThatStopped() {
        openSettings()
        compose.captureWholeScreen("SettingsSetupNotFinished", config)
    }

    @Test
    @Config(application = NewWaterApp::class)
    fun theDialogWhenTheRecoveryKeyIsFirstNeededForABackup() {
        openSettings()
        compose.tap(R.string.water_make_backup)
        compose.waitForText(words(SecurityR.string.sec_first_need_set_up_title))
        captureWindows("FirstNeedBackup")
    }

    @Test
    fun theProgressDialogWhileABackupIsWritten() {
        pickerDocuments()
        // The storage does not answer, so "Writing the backup" stays on screen.
        TestDocuments.onOpen = { held.await() }
        openSettings()
        pick(R.string.water_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.water_backup_writing))
        captureWindows("BackupWriting")
    }

    @Test
    fun theDialogWhenABackupIsWrittenAndChecked() {
        pickerDocuments()
        seedAWeek()
        openSettings()
        pick(R.string.water_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.water_backup_written_title))
        captureWindows("BackupWritten")
    }

    @Test
    fun theQuestionBeforeARestore() {
        pickerDocuments()
        seedAWeek()
        val backup = writeABackup()
        openSettings()
        pick(R.string.water_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.water_restore_question_title))
        captureWindows("RestoreQuestion")
    }

    @Test
    fun theDialogWhenABackupIsRestored() {
        pickerDocuments()
        seedAWeek()
        val backup = writeABackup()
        openSettings()
        pick(R.string.water_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.tap(R.string.water_restore)
        compose.waitForText(words(R.string.water_restored_title))
        captureWindows("BackupRestored")
    }

    @Test
    fun theAnswerForAFileThatIsNoBackup() {
        pickerDocuments()
        TestDocuments.file("photo.jpg").writeText("not a backup")
        openSettings()
        pick(R.string.water_restore_backup, Intent.ACTION_OPEN_DOCUMENT, TestDocuments.uri("photo.jpg"))
        compose.waitForText(words(R.string.water_refused_not_a_backup_title))
        captureWindows("RestoreNotABackup")
    }

    @Test
    fun licences() {
        openSettings()
        compose.tap(R.string.water_licences)
        compose.waitForText(words(R.string.water_licences_intro))
        compose.captureWholeScreen("Licences", config)
    }

    /** The shortest licence, so that the whole notice fits in a few images. */
    @Test
    fun theNoticeOfOnePartOfLicences() {
        openSettings()
        compose.tap(R.string.water_licences)
        compose.tap("BIP-39 English word list")
        compose.waitForText("Copyright (c) 2013-2016 Pavol Rusnak", substring = true)
        compose.captureWholeScreen("LicenceNotice", config)
    }

    /** Starts Water and opens Settings, with all of its sections. */
    private fun openSettings() {
        start()
        compose.tap(R.string.water_settings)
        compose.waitForSettings()
    }

    /** Taps the row [row] of Settings and picks [document] in the file picker that Water opens with [action]. */
    private fun pick(row: Int, action: String, document: Uri) {
        compose.tap(row)
        val shown = checkNotNull(scenario)
        compose.waitForOpened(shown) { it.action == action }
        compose.theOpenedScreenCloses(shown, picked = document)
    }

    /** Whether Android lets Water show notifications. */
    private fun notificationsAllowed(allowed: Boolean) = NotifyTestDevice(RuntimeEnvironment.getApplication()).allowNotifications(allowed)

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
        compose.waitForSettings()
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
