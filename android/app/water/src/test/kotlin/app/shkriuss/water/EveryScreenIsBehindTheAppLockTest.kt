package app.shkriuss.water

import android.content.Intent
import android.os.Looper
import android.os.PowerManager
import androidx.annotation.StringRes
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.shkriuss.core.testing.AppLockCheck
import app.shkriuss.feature.water.R
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
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
 *   only the lock screen shows, in every window.
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

    /** Opens Settings, then the dialog of the setting named [name]. */
    private fun openSetting(@StringRes name: Int) = openThenLock {
        tap(R.string.water_settings)
        tap(name)
    }

    /**
     * Starts Water with the app open, does [open], checks that something
     * opened in a window of its own, turns the screen off so that the app
     * locks, and checks that only the lock screen shows.
     */
    private fun openThenLock(open: () -> Unit) {
        ActivityScenario.launch(WaterActivity::class.java).use {
            // Today shows its buttons once the first read of the database is in.
            compose.waitForText(words(R.string.water_other_amount))
            val windowsBefore = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
            open()
            compose.waitForIdle()
            val windows = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
            assertTrue("A sheet or a dialog opened in a window of its own", windows > windowsBefore)

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
