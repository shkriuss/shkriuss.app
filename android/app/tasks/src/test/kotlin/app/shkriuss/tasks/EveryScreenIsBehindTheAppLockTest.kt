package app.shkriuss.tasks

import android.content.Intent
import android.net.Uri
import android.os.Looper
import android.os.PowerManager
import androidx.annotation.StringRes
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.core.testing.AppLockCheck
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.feature.tasks.Due
import app.shkriuss.feature.tasks.R
import app.shkriuss.feature.tasks.Repeat
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
import app.shkriuss.core.design.R as DesignR

/**
 * Every screen of Tasks is behind the app lock
 * (docs/architecture/security-screens.md, "Every screen is behind the
 * gate"), and so is every sheet, dialog and menu. A copy of Water's test.
 *
 * - With the app lock on and the app locked, it starts every activity of
 *   Tasks' merged manifest, except the screens of core/security, and
 *   fails unless each shows the lock screen and nothing of its own.
 * - With the app lock on and the app open, it opens each sheet, dialog
 *   and menu of Tasks, turns the screen off so that the app locks, and
 *   fails unless only the lock screen shows, in every window. These are
 *   the form, new and to edit, a bottom sheet at every width, with its
 *   list dialog and its date and time pickers; the dialog of New list
 *   and Rename; a list's menu; the questions of Delete list and Delete
 *   done tasks; the question for notifications; the dialogs of a backup
 *   and a restore; and Licences with an open notice, which Settings shows
 *   in its own place.
 *
 * One dialog is not here: the one for the moment the recovery key is first
 * needed. It can never show while the app lock is on, because the app lock
 * needs the recovery key. core/security checks it, drawn inside a gate
 * (`FirstNeedBehindTheAppLockTest`).
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = LockedTasksApp::class)
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
        assertTrue(checked.toString(), TasksActivity::class.java.name in checked)
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theFormOfANewTaskGoesWhenTheAppLocks() = openThenLock { tap(R.string.tasks_add) }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theFormOfATaskGoesWhenTheAppLocks() {
        seed { addTask("Call the bank", Due(THE_TIME.toLocalDate())) }
        openThenLock(ready = "Call the bank") { compose.tap(rowMatcher("Call the bank")) }
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theListDialogOfTheFormGoesWhenTheAppLocks() = openThenLock {
        tap(R.string.tasks_add)
        compose.tap(hasContentDescription("${words(R.string.tasks_list)}, ${words(R.string.tasks_inbox)}"))
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theDatePickerOfTheFormGoesWhenTheAppLocks() = openThenLock {
        tap(R.string.tasks_add)
        tap(R.string.tasks_remove)
        tap(R.string.tasks_add_due_date)
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theTimePickerOfTheFormGoesWhenTheAppLocks() = openThenLock {
        tap(R.string.tasks_add)
        tap(R.string.tasks_remind_me)
        compose.tap(hasContentDescription("${words(R.string.tasks_time)}, 10:00"))
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theDialogOfNewListGoesWhenTheAppLocks() = openThenLock {
        tap(R.string.tasks_lists)
        tap(R.string.tasks_new_list)
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theMenuOfAListGoesWhenTheAppLocks() {
        seed { addAList("Home") }
        openThenLock { openTheMenuOf("Home") }
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theDialogOfRenameGoesWhenTheAppLocks() {
        seed { addAList("Home") }
        openThenLock {
            openTheMenuOf("Home")
            tap(R.string.tasks_rename)
        }
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theQuestionOfDeleteListGoesWhenTheAppLocks() {
        seed { addAList("Home") }
        openThenLock {
            openTheMenuOf("Home")
            tap(R.string.tasks_delete_list)
        }
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theQuestionOfDeleteDoneTasksGoesWhenTheAppLocks() {
        seed {
            val home = addAList("Home")
            val done = addTask("Water the plants", listId = home.id)
            checkNotNull(tick(done.id, null, Repeat.ONCE))
        }
        openThenLock {
            openTheMenuOf("Home")
            tap(R.string.tasks_delete_done)
        }
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theQuestionForNotificationsGoesWhenTheAppLocks() {
        NotifyTestDevice(ApplicationProvider.getApplicationContext()).allowNotifications(false)
        seed { addTask("Call the bank", Due(THE_TIME.toLocalDate().plusDays(1), null, 14 * 60)) }
        openThenLock(ready = words(R.string.tasks_line_not_asked)) { tap(R.string.tasks_allow) }
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theProgressDialogOfABackupGoesWhenTheAppLocks() {
        // The storage does not answer, so "Writing the backup" stays on screen.
        TestDocuments.onOpen = { held.await() }
        openThenLock {
            pick(R.string.tasks_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
            compose.waitForText(words(R.string.tasks_backup_writing))
        }
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theDialogBackupWrittenGoesWhenTheAppLocks() = openThenLock {
        pick(R.string.tasks_make_backup, Intent.ACTION_CREATE_DOCUMENT, TestDocuments.uri(BACKUP_NAME))
        compose.waitForText(words(R.string.tasks_backup_written_title))
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theQuestionBeforeARestoreGoesWhenTheAppLocks() {
        val backup = writeABackup()
        openThenLock {
            pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
            compose.waitForText(words(R.string.tasks_restore_question_title))
        }
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theDialogBackupRestoredGoesWhenTheAppLocks() {
        val backup = writeABackup()
        openThenLock {
            pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, backup)
            tap(R.string.tasks_restore)
            compose.waitForText(words(R.string.tasks_restored_title))
        }
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun theAnswerForAFileTasksDoesNotTakeGoesWhenTheAppLocks() {
        TestDocuments.file("photo.jpg").writeText("not a backup")
        openThenLock {
            pick(R.string.tasks_restore_backup, Intent.ACTION_OPEN_DOCUMENT, TestDocuments.uri("photo.jpg"))
            compose.waitForText(words(R.string.tasks_refused_not_a_backup_title))
        }
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun licencesGoesWhenTheAppLocks() = openThenLock(inAWindowOfItsOwn = false) {
        tap(R.string.tasks_settings)
        tap(R.string.tasks_licences)
        compose.waitForText(words(R.string.tasks_licences_intro))
    }

    @Test
    @Config(application = AppLockOnTasksApp::class)
    fun anOpenNoticeOfLicencesGoesWhenTheAppLocks() = openThenLock(inAWindowOfItsOwn = false) {
        tap(R.string.tasks_settings)
        tap(R.string.tasks_licences)
        compose.tap("BIP-39 English word list")
        compose.waitForText("Copyright (c) 2013-2016 Pavol Rusnak", substring = true)
    }

    /**
     * Opens Settings, taps the row named [row], and picks [document] in the
     * file picker that Tasks opens with [action]. The app has its recovery
     * key, so the picker comes without the first-need dialog.
     */
    private fun pick(@StringRes row: Int, action: String, document: Uri) {
        tap(R.string.tasks_settings)
        tap(row)
        val scenario = checkNotNull(shown) { "The screen is not started" }
        compose.waitForOpened(scenario) { it.action == action }
        compose.theOpenedScreenCloses(scenario, picked = document)
    }

    /** The screen of the test that runs now, for the result of a file picker. */
    private var shown: ActivityScenario<TasksActivity>? = null

    /** Opens Lists, then the list [name], then the menu of its top bar. */
    private fun openTheMenuOf(name: String) {
        tap(R.string.tasks_lists)
        compose.tap(rowMatcher(name))
        compose.tap(hasContentDescription(words(DesignR.string.shk_more_options)))
    }

    /**
     * Starts Tasks with the app open, waits until Today shows [ready],
     * does [open], checks that something opened in a window of its own,
     * turns the screen off so that the app locks, and checks that only the
     * lock screen shows. [inAWindowOfItsOwn] is false for a screen that
     * Tasks shows in place of another, as Licences in place of Settings:
     * it opens no window.
     */
    private fun openThenLock(
        ready: String = words(R.string.tasks_nothing_due_today),
        inAWindowOfItsOwn: Boolean = true,
        open: () -> Unit,
    ) {
        use24HourClock()
        ActivityScenario.launch(TasksActivity::class.java).use { scenario ->
            shown = scenario
            // Today shows its rows, or the line for none, once the first read of the database is in.
            compose.waitForText(ready)
            val windowsBefore = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
            open()
            compose.waitForIdle()
            val windows = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
            if (inAWindowOfItsOwn) assertTrue("A sheet, a dialog or a menu opened in a window of its own", windows > windowsBefore)

            val app = ApplicationProvider.getApplicationContext<AppLockOnTasksApp>()
            shadowOf(app.getSystemService(PowerManager::class.java)).turnScreenOn(false)
            app.sendBroadcast(Intent(Intent.ACTION_SCREEN_OFF))
            shadowOf(Looper.getMainLooper()).idle()

            AppLockCheck.checkLockedNow(compose, TasksActivity::class.java.name)
        }
    }

    /** Taps the one thing that can be tapped with the words of string [id], once it shows. */
    private fun tap(@StringRes id: Int) = compose.tap(id)
}
