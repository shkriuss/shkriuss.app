package app.shkriuss.water

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
 * Every screen of Water is behind the app lock
 * (docs/architecture/security-screens.md, "Every screen is behind the
 * gate"). With the app lock on and the app locked, it starts every
 * activity of Water's merged manifest, except the screens of
 * core/security, and fails unless each shows the lock screen and nothing
 * of its own.
 *
 * Every later app copies this test: its own locked app class, and its own
 * launcher screen in the last line.
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
}
