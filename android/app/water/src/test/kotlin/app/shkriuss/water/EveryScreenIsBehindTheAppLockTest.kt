package app.shkriuss.water

import android.content.Intent
import android.net.Uri
import android.os.Looper
import android.os.PowerManager
import androidx.annotation.StringRes
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.core.testing.AppLockCheck
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.feature.water.R
import java.util.concurrent.CountDownLatch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Every screen of Water is behind the app lock
 * (docs/architecture/security-screens.md, "Every screen is behind the
 * gate"), and so is every sheet and dialog.
 *
 * - With the app lock on and the app locked, it starts every activity of
 *   Water's merged manifest, except the screens of core/security, and
 *   fails unless each shows the lock screen and nothing of its own.
 * - With the app lock on and the app open, it opens each sheet and dialog
 *   of Water, turns the screen off so that the app locks, and fails unless
 *   only the lock screen shows, in every window. Since step 2.5 these are
 *   also the dialogs of a backup and a restore, and Licences with an open
 *   notice, which Settings shows in its own place.
 *
 * One dialog is not here: the one for the moment the recovery key is first
 * needed. It can never show while the app lock is on, because the app lock
 * needs the recovery key. core/security checks it, drawn inside a gate
 * (`FirstNeedBehindTheAppLockTest`).
 *
 * Every later app copies this test: its own app classes, its own launcher
 * screen in the first test, and its own sheets and dialogs.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = LockedWaterApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class EveryScreenIsBehindTheAppLockTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    /** Holds a backup that is being written, so that its progress dialog stays. Opened again at the end of the test. */
    private val held = CountDownLatch(1)

    @Before
    fun aFilePicker() = pickerDocuments()

    @After
    fun letTheWorkEnd() {
        held.countDown()
        TestDocuments.onOpen = {}
    }

    @Test
    fun everyScreenShowsTheLockScreenAndNothingOfItsOwn() {
        val checked = AppLockCheck.checkEveryScreen(compose)
        // The merged manifest was read: the launcher screen is among the screens checked.
        assertTrue(checked.toString(), WaterActivity::class.java.name in checked)
    }

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theSheetAddADrinkGoesWhenTheAppLocks() = openThenLock { tap(R.string.water_other_amount) }

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theTimePickerOfTheSheetGoesWhenTheAppLocks() = openThenLock {
        tap(R.string.water_other_amount)
        tap(R.string.water_time)
    }

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theSheetEditDrinkGoesWhenTheAppLocks() {
        val water = ApplicationProvider.getApplicationContext<AppLockOnWaterApp>().water
        runBlocking { water.repository.addDrink(THE_DAY, 9 * 60, 300) }
        openThenLock { compose.tap("300 ml", substring = true) }
    }

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theDialogDailyGoalGoesWhenTheAppLocks() = openSetting(R.string.water_daily_goal)

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theDialogUnitGoesWhenTheAppLocks() = openSetting(R.string.water_unit)

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theDialogQuickAmountsGoesWhenTheAppLocks() = openSetting(R.string.water_quick_amounts)

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theDialogEveryGoesWhenTheAppLocks() = openSetting(R.string.water_every)

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theTimePickerFromGoesWhenTheAppLocks() = openSetting(R.string.water_from)

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theTimePickerUntilGoesWhenTheAppLocks() = openSetting(R.string.water_until)

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theQuestionForNotificationsGoesWhenTheAppLocks() {
        // Android has not asked yet, so turning reminders on opens the dialog before its question.
        NotifyTestDevice(ApplicationProvider.getApplicationContext<AppLockOnWaterApp>()).allowNotifications(false)
        openSetting(R.string.water_remind_me)
    }

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theProgressDialogOfABackupGoesWhenTheAppLocks() {
        // The storage does not answer, so "Writing the backup" stays on screen.
        TestDocuments.onOpen = { held.await() }
        openThenLock {
            pick(R.string.water_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
            compose.waitForText(words(R.string.water_backup_writing))
        }
    }

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theDialogBackupWrittenGoesWhenTheAppLocks() = openThenLock {
        pick(R.string.water_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.water_backup_written_title))
    }

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theQuestionBeforeARestoreGoesWhenTheAppLocks() {
        val backup = writeABackup()
        openThenLock {
            pick(R.string.water_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
            compose.waitForText(words(R.string.water_restore_question_title))
        }
    }

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theDialogBackupRestoredGoesWhenTheAppLocks() {
        val backup = writeABackup()
        openThenLock {
            pick(R.string.water_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
            tap(R.string.water_restore)
            compose.waitForText(words(R.string.water_restored_title))
        }
    }

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun theAnswerForAFileWaterDoesNotTakeGoesWhenTheAppLocks() {
        TestDocuments.file("photo.jpg").writeText("not a backup")
        openThenLock {
            pick(R.string.water_restore_backup, Intent.ACTION_OPEN_DOCUMENT, TestDocuments.uri("photo.jpg"))
            compose.waitForText(words(R.string.water_refused_not_a_backup_title))
        }
    }

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun licencesGoesWhenTheAppLocks() = openThenLock(inAWindowOfItsOwn = false) {
        tap(R.string.water_settings)
        tap(R.string.water_licences)
        compose.waitForText(words(R.string.water_licences_intro))
    }

    @Test
    @Config(application = AppLockOnWaterApp::class)
    fun anOpenNoticeOfLicencesGoesWhenTheAppLocks() = openThenLock(inAWindowOfItsOwn = false) {
        tap(R.string.water_settings)
        tap(R.string.water_licences)
        compose.tap("Gson")
        compose.waitForText("Copyright (C) 2008 Google Inc.", substring = true)
    }

    /**
     * Opens Settings, taps the row named [row], and picks [document] in the
     * file picker that Water opens with [action]. The app has its recovery
     * key, so the picker comes without the first-need dialog.
     */
    private fun pick(@StringRes row: Int, action: String, document: Uri) {
        tap(R.string.water_settings)
        tap(row)
        val scenario = checkNotNull(shown) { "The screen is not started" }
        compose.waitForOpened(scenario) { it.action == action }
        compose.theOpenedScreenCloses(scenario, picked = document)
    }

    /** Opens Settings, then the dialog of the setting named [name]. */
    private fun openSetting(@StringRes name: Int) = openThenLock {
        tap(R.string.water_settings)
        tap(name)
    }

    /** The screen of the test that runs now, for the result of a file picker. */
    private var shown: ActivityScenario<WaterActivity>? = null

    /**
     * Starts Water with the app open, does [open], checks that something
     * opened in a window of its own, turns the screen off so that the app
     * locks, and checks that only the lock screen shows.
     * [inAWindowOfItsOwn] is false for a screen that Water shows in place of
     * another, as Licences in place of Settings: it opens no window.
     */
    private fun openThenLock(inAWindowOfItsOwn: Boolean = true, open: () -> Unit) {
        ActivityScenario.launch(WaterActivity::class.java).use { scenario ->
            shown = scenario
            // Today shows its buttons once the first read of the database is in.
            compose.waitForText(words(R.string.water_other_amount))
            val windowsBefore = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
            open()
            compose.waitForIdle()
            val windows = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
            if (inAWindowOfItsOwn) assertTrue("A sheet or a dialog opened in a window of its own", windows > windowsBefore)

            val app = ApplicationProvider.getApplicationContext<AppLockOnWaterApp>()
            shadowOf(app.getSystemService(PowerManager::class.java)).turnScreenOn(false)
            app.sendBroadcast(Intent(Intent.ACTION_SCREEN_OFF))
            shadowOf(Looper.getMainLooper()).idle()

            AppLockCheck.checkLockedNow(compose, WaterActivity::class.java.name)
        }
    }

    /** Taps the one thing that can be tapped with the words of string [id], once it shows. */
    private fun tap(@StringRes id: Int) = compose.tap(id)
}
