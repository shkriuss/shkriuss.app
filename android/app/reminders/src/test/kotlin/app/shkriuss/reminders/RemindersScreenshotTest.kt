package app.shkriuss.reminders

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.feature.reminders.R
import app.shkriuss.feature.reminders.Repeat
import app.shkriuss.feature.reminders.Schedule
import app.shkriuss.feature.reminders.Weekdays
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import java.time.DayOfWeek
import java.time.LocalDate
import java.util.concurrent.CountDownLatch
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import app.shkriuss.core.design.R as DesignR
import app.shkriuss.core.security.R as SecurityR

/**
 * Screenshots of every screen, sheet and dialog of Reminders
 * (docs/apps/reminders/spec.md, "Screens"), in the four standard
 * configurations: phone light at font scale 1.0, phone dark at 2.0,
 * tablet light at 2.0 and tablet dark at 1.0. Each starts the real
 * activity with the app lock off, on a database written as the user
 * would have, on Monday 16 November 2026 at 09:30, with the 24-hour clock
 * of the spec's examples.
 *
 * A screen that scrolls is captured to its end, in parts, and so is the
 * form. On the phone the form is a sheet over the list. On the tablet it
 * is a pane beside the list. A dialog is captured with the screen dimmed
 * behind it, and a snackbar over the screen, once.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@Config(application = UnlockedRemindersApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemindersScreenshotTest(private val config: ScreenshotConfig) {
    private val compose = createEmptyComposeRule()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(config.rule()).around(compose)

    private var scenario: ActivityScenario<RemindersActivity>? = null

    /** Holds a backup that is being written, so that its progress dialog stays. Opened again at the end of the test. */
    private val held = CountDownLatch(1)

    @After
    fun closeTheScreen() {
        held.countDown()
        TestDocuments.onOpen = {}
        scenario?.close()
    }

    // Upcoming.

    @Test
    fun upcomingEmpty() {
        start()
        compose.captureWholeScreen("UpcomingEmpty", config)
    }

    /** Every kind of row: due now, today, tomorrow, this year, another year, and a title that wraps. */
    @Test
    fun upcomingWithReminders() {
        seedUpcoming()
        start(ready = "Pills")
        compose.captureWholeScreen("UpcomingReminders", config, LIST)
    }

    /** Upcoming right after a Save, with "Reminder set for Mon, Nov 16, 10:00." at the bottom. */
    @Test
    fun upcomingWithTheSnackbarAfterASave() {
        start()
        compose.tap(R.string.reminders_add)
        compose.field(words(R.string.reminders_title)).performTextInput("Pills")
        compose.tap(R.string.reminders_every_day)
        compose.tap(R.string.reminders_save)
        compose.waitForText(words(R.string.reminders_saved, "Mon, Nov 16, 10:00"))
        // The snackbar comes as soon as the reminder is written. The row comes
        // a moment later, when Room tells the list of the change.
        compose.waitFor(hasText("Pills") and hasClickAction())
        compose.waitForGone(hasText(words(R.string.reminders_new_reminder)))
        captureWindows("UpcomingSnackbar")
    }

    /** While notifications cannot show: the line at the top, before the list, with **Allow**. */
    @Test
    fun upcomingWithTheLineAboutNotifications() {
        NotifyTestDevice(ApplicationProvider.getApplicationContext()).allowNotifications(false)
        seedUpcoming()
        start(ready = "Pills")
        compose.waitForText(words(R.string.reminders_line_not_asked))
        compose.captureWholeScreen("UpcomingNotificationsLine", config, LIST)
    }

    /** The question before Android's own, after **Allow**. */
    @Test
    fun theQuestionForNotifications() {
        NotifyTestDevice(ApplicationProvider.getApplicationContext()).allowNotifications(false)
        seedUpcoming()
        start(ready = "Pills")
        compose.tap(R.string.reminders_allow)
        compose.waitForText(words(R.string.reminders_question_text))
        captureWindows("NotificationsQuestion")
    }

    // The reminder form.

    /** A new reminder: Once, today, at the next full hour, with the keyboard on the title. */
    @Test
    fun aNewReminder() {
        seedUpcoming()
        start(ready = "Pills")
        compose.tap(R.string.reminders_add)
        compose.waitForText(words(R.string.reminders_new_reminder))
        compose.captureWholeWindows("NewReminder", config, FORM)
    }

    /** "Gym", every Monday, Wednesday and Friday: the days of the week, and on the tablet its row marked. */
    @Test
    fun aReminderOpenToEdit() {
        seedUpcoming()
        start(ready = "Pills")
        compose.tap("Gym")
        compose.waitForText(words(R.string.reminders_edit_reminder))
        compose.captureWholeWindows("EditReminder", config, FORM)
    }

    /** Save with no title and Every week with no day: both say why under them. */
    @Test
    fun theFormWithItsErrors() {
        start()
        compose.tap(R.string.reminders_add)
        compose.tap(R.string.reminders_every_week)
        compose.onNode(hasContentDescription("Monday") and hasClickAction()).tapAsTalkBack()
        compose.tap(R.string.reminders_save)
        compose.waitForText(words(R.string.reminders_choose_a_day))
        compose.captureWholeWindows("FormErrors", config, FORM)
    }

    /** The time picker after a time that has passed: "That time has passed.", and it stays open. */
    @Test
    fun theTimePickerRefusesATimeThatHasPassed() {
        start()
        compose.tap(R.string.reminders_add)
        compose.tap(R.string.reminders_time)
        compose.field(words(DesignR.string.shk_hour)).performTextReplacement("09")
        compose.field(words(DesignR.string.shk_minute)).performTextReplacement("15")
        compose.tap(DesignR.string.shk_ok)
        compose.waitForText(words(R.string.reminders_time_passed))
        captureWindows("TimePassed")
    }

    /**
     * The date picker of the form. Material's picker marks the real today,
     * which the test's clock does not set, in the month it shows. So it
     * shows a reminder in June 2100, a month that is never today when the
     * tests run, and the image is the same on every day.
     */
    @Test
    fun theDatePicker() {
        seed { addSaved("Open the time capsule", Schedule(Repeat.ONCE, LocalDate.of(2100, 6, 15), 12 * 60)) }
        start(ready = "Open the time capsule")
        compose.tap("Open the time capsule")
        compose.tap(R.string.reminders_date)
        compose.waitFor(hasText(words(DesignR.string.shk_ok)) and hasClickAction())
        captureWindows("DatePicker")
    }

    // Past.

    @Test
    fun pastEmpty() {
        start()
        compose.tap(R.string.reminders_past)
        compose.waitForText(words(R.string.reminders_past_empty_title))
        compose.captureWholeScreen("PastEmpty", config)
    }

    /** Past, newest first, one of them from last year, with Delete all in the top bar. */
    @Test
    fun pastWithReminders() {
        seedPast()
        start()
        compose.tap(R.string.reminders_past)
        compose.waitForText("Dentist")
        compose.captureWholeScreen("PastReminders", config, LIST)
    }

    @Test
    fun theQuestionOfDeleteAll() {
        seedPast()
        start()
        compose.tap(R.string.reminders_past)
        compose.tap(R.string.reminders_delete_all)
        compose.waitForText(words(R.string.reminders_delete_all_question))
        captureWindows("DeleteAllQuestion")
    }

    // Settings, Backup, Security and Licences.

    @Test
    fun settings() {
        openSettings()
        compose.captureWholeScreen("Settings", config)
    }

    @Test
    @Config(application = NewRemindersApp::class)
    fun settingsWithNoRecoveryKey() {
        openSettings()
        compose.captureWholeScreen("SettingsNoRecoveryKey", config)
    }

    @Test
    @Config(application = StoppedSetupRemindersApp::class)
    fun settingsAfterASetupThatStopped() {
        openSettings()
        compose.captureWholeScreen("SettingsSetupNotFinished", config)
    }

    /** With the owner's sentence about a recovery key made in another app. */
    @Test
    @Config(application = NewRemindersApp::class)
    fun theDialogWhenTheRecoveryKeyIsFirstNeededForABackup() {
        openSettings()
        compose.tap(R.string.reminders_make_backup)
        compose.waitForText(words(SecurityR.string.sec_first_need_set_up_title))
        captureWindows("FirstNeedBackup")
    }

    @Test
    fun theProgressDialogWhileABackupIsWritten() {
        pickerDocuments()
        // The storage does not answer, so "Writing the backup" stays on screen.
        TestDocuments.onOpen = { held.await() }
        openSettings()
        pick(R.string.reminders_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.reminders_backup_writing))
        captureWindows("BackupWriting")
    }

    @Test
    fun theDialogWhenABackupIsWrittenAndChecked() {
        pickerDocuments()
        seedUpcoming()
        openSettings(ready = "Pills")
        pick(R.string.reminders_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.reminders_backup_written_title))
        captureWindows("BackupWritten")
    }

    @Test
    fun theQuestionBeforeARestore() {
        pickerDocuments()
        seedUpcoming()
        val backup = writeABackup()
        openSettings(ready = "Pills")
        pick(R.string.reminders_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.waitForText(words(R.string.reminders_restore_question_title))
        captureWindows("RestoreQuestion")
    }

    @Test
    fun theDialogWhenABackupIsRestored() {
        pickerDocuments()
        seedUpcoming()
        val backup = writeABackup()
        openSettings(ready = "Pills")
        pick(R.string.reminders_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
        compose.tap(R.string.reminders_restore)
        compose.waitForText(words(R.string.reminders_restored_title))
        captureWindows("BackupRestored")
    }

    @Test
    fun theAnswerForAFileThatIsNoBackup() {
        pickerDocuments()
        TestDocuments.file("photo.jpg").writeText("not a backup")
        openSettings()
        pick(R.string.reminders_restore_backup, Intent.ACTION_OPEN_DOCUMENT, TestDocuments.uri("photo.jpg"))
        compose.waitForText(words(R.string.reminders_refused_not_a_backup_title))
        captureWindows("RestoreNotABackup")
    }

    @Test
    fun licences() {
        openSettings()
        compose.tap(R.string.reminders_licences)
        compose.waitForText(words(R.string.reminders_licences_intro))
        compose.captureWholeScreen("Licences", config)
    }

    /** The shortest licence, so that the whole notice fits in a few images. */
    @Test
    fun theNoticeOfOnePartOfLicences() {
        openSettings()
        compose.tap(R.string.reminders_licences)
        compose.tap("BIP-39 English word list")
        compose.waitForText("Copyright (c) 2013-2016 Pavol Rusnak", substring = true)
        compose.captureWholeScreen("LicenceNotice", config)
    }

    /** Starts Reminders, waits until Upcoming shows [ready], and opens Settings, with all of its sections. */
    private fun openSettings(ready: String = words(R.string.reminders_upcoming_empty_title)) {
        start(ready)
        compose.tap(R.string.reminders_settings)
        compose.waitForSettings()
    }

    /** Taps the row [row] of Settings and picks [document] in the file picker that Reminders opens with [action]. */
    private fun pick(row: Int, action: String, document: Uri) {
        compose.tap(row)
        val shown = checkNotNull(scenario)
        compose.waitForOpened(shown) { it.action == action }
        compose.theOpenedScreenCloses(shown, picked = document)
    }

    /** Every window once, as they are: a sheet, a dialog or a snackbar over the screen. Roborazzi marks this as experimental. */
    @OptIn(ExperimentalRoborazziApi::class)
    private fun captureWindows(name: String) {
        compose.waitForIdle()
        captureScreenRoboImage("src/test/screenshots/${name}_${config.name}.png")
    }

    /** Starts Reminders on Upcoming, and waits until it shows [ready]: a row, or the line for none. */
    private fun start(ready: String = words(R.string.reminders_upcoming_empty_title)) {
        use24HourClock()
        scenario = ActivityScenario.launch(RemindersActivity::class.java)
        compose.waitForText(ready)
    }

    /** The reminders of the spec's examples, and three more, so that every kind of row shows. */
    private fun seedUpcoming() = seed {
        addSaved("Call the bank", Schedule(Repeat.ONCE, TODAY, 9 * 60), savedAt = TODAY.atTime(8, 0))
        addSaved("Pills", Schedule(Repeat.DAILY, TODAY.minusDays(1), 9 * 60))
        addSaved("Gym", Schedule(Repeat.WEEKLY, TODAY, 18 * 60 + 30, Weekdays.of(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY)))
        addSaved("Rent", Schedule(Repeat.MONTHLY, LocalDate.of(2026, 10, 31), 10 * 60))
        addSaved("Take the winter tyres to the garage before the first snow", Schedule(Repeat.ONCE, LocalDate.of(2026, 11, 20), 17 * 60))
        addSaved("Mum's birthday", Schedule(Repeat.YEARLY, LocalDate.of(2027, 2, 2), 8 * 60))
    }

    /** One-time reminders saved after their time, so they are past: one today, two before, one last year. */
    private fun seedPast() = seed {
        addSaved("Renew the passport", Schedule(Repeat.ONCE, LocalDate.of(2025, 12, 1), 11 * 60))
        addSaved("Parcel at the post office", Schedule(Repeat.ONCE, LocalDate.of(2026, 10, 2), 15 * 60 + 30))
        addSaved("Dentist", Schedule(Repeat.ONCE, LocalDate.of(2026, 11, 13), 10 * 60))
        addSaved("Call the bank", Schedule(Repeat.ONCE, TODAY, 8 * 60))
    }

    companion object {
        /** The day the tests start on: Monday 16 November 2026. */
        private val TODAY: LocalDate = THE_TIME.toLocalDate()

        /** The form, in its sheet or in its pane: the part that scrolls and holds the repeats. */
        private val FORM
            get() = hasScrollAction() and hasAnyDescendant(hasText(words(R.string.reminders_repeat)))

        /**
         * The list of Upcoming or Past: the part that scrolls and is a
         * list. On a tablet at font scale 2.0 the navigation rail beside it
         * scrolls too, and is not a list.
         */
        private val LIST = hasScrollAction() and SemanticsMatcher.keyIsDefined(SemanticsProperties.CollectionInfo)

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun configs(): List<ScreenshotConfig> = ScreenshotConfig.all()
    }
}
