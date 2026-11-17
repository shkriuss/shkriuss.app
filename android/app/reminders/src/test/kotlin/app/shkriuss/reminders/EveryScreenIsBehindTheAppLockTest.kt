package app.shkriuss.reminders

import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import app.shkriuss.core.testing.AppLockCheck
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Every screen of Reminders is behind the app lock
 * (docs/architecture/security-screens.md, "Every screen is behind the
 * gate"). A copy of Water's test.
 *
 * With the app lock on and the app locked, it starts every activity of
 * Reminders' merged manifest, except the screens of core/security, and
 * fails unless each shows the lock screen and nothing of its own.
 *
 * Reminders has no sheet and no dialog yet. Each one that comes gets a
 * test here, as in Water's: open it with the app lock on and the app
 * open, turn the screen off so that the app locks, and fail unless only
 * the lock screen shows, in every window.
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
}
