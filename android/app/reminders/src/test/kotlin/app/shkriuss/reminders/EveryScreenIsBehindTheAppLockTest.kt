package app.shkriuss.reminders

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
import app.shkriuss.feature.reminders.R
import app.shkriuss.feature.reminders.Repeat
import app.shkriuss.feature.reminders.Schedule
import java.util.concurrent.CountDownLatch
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
 * Every screen of Reminders is behind the app lock
 * (docs/architecture/security-screens.md, "Every screen is behind the
 * gate"), and so is every sheet and dialog. A copy of Water's test.
 *
 * - With the app lock on and the app locked, it starts every activity of
 *   Reminders' merged manifest, except the screens of core/security, and
 *   fails unless each shows the lock screen and nothing of its own.
 * - With the app lock on and the app open, it opens each sheet and dialog
 *   of Reminders, turns the screen off so that the app locks, and fails
 *   unless only the lock screen shows, in every window. These are the
 *   form, new and to edit, its date and time pickers, the question of
 *   Delete all, the question for notifications, the dialogs of a backup
 *   and a restore, and Licences with an open notice, which Settings shows
 *   in its own place. On a phone the form is a sheet; from 840dp it is a
 *   pane of the screen, which the first check covers.
 *
 * One dialog is not here: the one for the moment the recovery key is first
 * needed. It can never show while the app lock is on, because the app lock
 * needs the recovery key. core/security checks it, drawn inside a gate
 * (`FirstNeedBehindTheAppLockTest`).
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = LockedRemindersApp::class)
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
        assertTrue(checked.toString(), RemindersActivity::class.java.name in checked)
    }

    @Test
    @Config(application = AppLockOnRemindersApp::class)
    fun theFormOfANewReminderGoesWhenTheAppLocks() = openThenLock { tap(R.string.reminders_add) }

    @Test
    @Config(application = AppLockOnRemindersApp::class)
    fun theDatePickerOfTheFormGoesWhenTheAppLocks() = openThenLock {
        tap(R.string.reminders_add)
        tap(R.string.reminders_date)
    }

    @Test
    @Config(application = AppLockOnRemindersApp::class)
    fun theTimePickerOfTheFormGoesWhenTheAppLocks() = openThenLock {
        tap(R.string.reminders_add)
        tap(R.string.reminders_time)
    }

    @Test
    @Config(application = AppLockOnRemindersApp::class)
    fun theFormOfAReminderGoesWhenTheAppLocks() {
        seed { addSaved("Pills", Schedule(Repeat.DAILY, THE_TIME.toLocalDate(), 9 * 60)) }
        openThenLock(ready = "Pills") { compose.tap("Pills") }
    }

    @Test
    @Config(application = AppLockOnRemindersApp::class)
    fun theQuestionOfDeleteAllGoesWhenTheAppLocks() {
        // Once, at 08:00 on the day the tests start, saved after it: past.
        seed { addSaved("Call the bank", Schedule(Repeat.ONCE, THE_TIME.toLocalDate(), 8 * 60)) }
        openThenLock {
            tap(R.string.reminders_past)
            compose.waitForText("Call the bank")
            tap(R.string.reminders_delete_all)
        }
    }

    @Test
    @Config(application = AppLockOnRemindersApp::class)
    fun theQuestionForNotificationsGoesWhenTheAppLocks() {
        NotifyTestDevice(ApplicationProvider.getApplicationContext()).allowNotifications(false)
        seed { addSaved("Pills", Schedule(Repeat.DAILY, THE_TIME.toLocalDate(), 9 * 60)) }
        openThenLock(ready = "Pills") { tap(R.string.reminders_allow) }
    }

    @Test
    @Config(application = AppLockOnRemindersApp::class)
    fun theProgressDialogOfABackupGoesWhenTheAppLocks() {
        // The storage does not answer, so "Writing the backup" stays on screen.
        TestDocuments.onOpen = { held.await() }
        openThenLock {
            pick(R.string.reminders_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
            compose.waitForText(words(R.string.reminders_backup_writing))
        }
    }

    @Test
    @Config(application = AppLockOnRemindersApp::class)
    fun theDialogBackupWrittenGoesWhenTheAppLocks() = openThenLock {
        pick(R.string.reminders_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.reminders_backup_written_title))
    }

    @Test
    @Config(application = AppLockOnRemindersApp::class)
    fun theQuestionBeforeARestoreGoesWhenTheAppLocks() {
        val backup = writeABackup()
        openThenLock {
            pick(R.string.reminders_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
            compose.waitForText(words(R.string.reminders_restore_question_title))
        }
    }

    @Test
    @Config(application = AppLockOnRemindersApp::class)
    fun theDialogBackupRestoredGoesWhenTheAppLocks() {
        val backup = writeABackup()
        openThenLock {
            pick(R.string.reminders_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
            tap(R.string.reminders_restore)
            compose.waitForText(words(R.string.reminders_restored_title))
        }
    }

    @Test
    @Config(application = AppLockOnRemindersApp::class)
    fun theAnswerForAFileRemindersDoesNotTakeGoesWhenTheAppLocks() {
        TestDocuments.file("photo.jpg").writeText("not a backup")
        openThenLock {
            pick(R.string.reminders_restore_backup, Intent.ACTION_OPEN_DOCUMENT, TestDocuments.uri("photo.jpg"))
            compose.waitForText(words(R.string.reminders_refused_not_a_backup_title))
        }
    }

    @Test
    @Config(application = AppLockOnRemindersApp::class)
    fun licencesGoesWhenTheAppLocks() = openThenLock(inAWindowOfItsOwn = false) {
        tap(R.string.reminders_settings)
        tap(R.string.reminders_licences)
        compose.waitForText(words(R.string.reminders_licences_intro))
    }

    @Test
    @Config(application = AppLockOnRemindersApp::class)
    fun anOpenNoticeOfLicencesGoesWhenTheAppLocks() = openThenLock(inAWindowOfItsOwn = false) {
        tap(R.string.reminders_settings)
        tap(R.string.reminders_licences)
        compose.tap("BIP-39 English word list")
        compose.waitForText("Copyright (c) 2013-2016 Pavol Rusnak", substring = true)
    }

    /**
     * Opens Settings, taps the row named [row], and picks [document] in the
     * file picker that Reminders opens with [action]. The app has its
     * recovery key, so the picker comes without the first-need dialog.
     */
    private fun pick(@StringRes row: Int, action: String, document: Uri) {
        tap(R.string.reminders_settings)
        tap(row)
        val scenario = checkNotNull(shown) { "The screen is not started" }
        compose.waitForOpened(scenario) { it.action == action }
        compose.theOpenedScreenCloses(scenario, picked = document)
    }

    /** The screen of the test that runs now, for the result of a file picker. */
    private var shown: ActivityScenario<RemindersActivity>? = null

    /**
     * Starts Reminders with the app open, waits until Upcoming shows
     * [ready], does [open], checks that something opened in a window of its
     * own, turns the screen off so that the app locks, and checks that only
     * the lock screen shows. [inAWindowOfItsOwn] is false for a screen that
     * Reminders shows in place of another, as Licences in place of
     * Settings: it opens no window.
     */
    private fun openThenLock(
        ready: String = words(R.string.reminders_upcoming_empty_title),
        inAWindowOfItsOwn: Boolean = true,
        open: () -> Unit,
    ) {
        ActivityScenario.launch(RemindersActivity::class.java).use { scenario ->
            shown = scenario
            // Upcoming shows its rows, or the line for none, once the first read of the database is in.
            compose.waitForText(ready)
            val windowsBefore = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
            open()
            compose.waitForIdle()
            val windows = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
            if (inAWindowOfItsOwn) assertTrue("A sheet or a dialog opened in a window of its own", windows > windowsBefore)

            val app = ApplicationProvider.getApplicationContext<AppLockOnRemindersApp>()
            shadowOf(app.getSystemService(PowerManager::class.java)).turnScreenOn(false)
            app.sendBroadcast(Intent(Intent.ACTION_SCREEN_OFF))
            shadowOf(Looper.getMainLooper()).idle()

            AppLockCheck.checkLockedNow(compose, RemindersActivity::class.java.name)
        }
    }

    /** Taps the one thing that can be tapped with the words of string [id], once it shows. */
    private fun tap(@StringRes id: Int) = compose.tap(id)
}
