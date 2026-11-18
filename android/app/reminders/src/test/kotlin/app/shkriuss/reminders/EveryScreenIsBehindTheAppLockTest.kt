package app.shkriuss.reminders

import android.content.Intent
import android.os.Looper
import android.os.PowerManager
import androidx.annotation.StringRes
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.core.testing.AppLockCheck
import app.shkriuss.feature.reminders.R
import app.shkriuss.feature.reminders.Repeat
import app.shkriuss.feature.reminders.Schedule
import org.junit.Assert.assertTrue
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
 *   Delete all, and the question for notifications. On a phone the form
 *   is a sheet; from 840dp it is a pane of the screen, which the first
 *   check covers.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = LockedRemindersApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class EveryScreenIsBehindTheAppLockTest {
    @get:Rule
    val compose = createEmptyComposeRule()

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

    /**
     * Starts Reminders with the app open, waits until Upcoming shows
     * [ready], does [open], checks that something opened in a window of its
     * own, turns the screen off so that the app locks, and checks that only
     * the lock screen shows.
     */
    private fun openThenLock(ready: String = words(R.string.reminders_upcoming_empty_title), open: () -> Unit) {
        ActivityScenario.launch(RemindersActivity::class.java).use {
            // Upcoming shows its rows, or the line for none, once the first read of the database is in.
            compose.waitForText(ready)
            val windowsBefore = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
            open()
            compose.waitForIdle()
            val windows = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
            assertTrue("A sheet or a dialog opened in a window of its own", windows > windowsBefore)

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
