package app.shkriuss.core.security

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The app lock screen, started as Android starts it: every button has a
 * label and a 48dp touch target.
 *
 * The screen reads the keys on a background thread, as in an app
 * (`Dispatchers.IO`), and Compose's `waitForIdle` does not wait for that
 * thread. So each test first waits until the screen shows what it read
 * ([waitForTheSettings]), as `AppLockGateTest` does for the lock screen.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
class AppLockActivitiesTest {
    @get:Rule
    val compose = createAndroidComposeRule<AppLockActivity>()

    /** Waits until the screen has read the keys and shows its settings: an app without a recovery key says why it cannot be turned on. */
    private fun waitForTheSettings() {
        val why = compose.activity.getString(R.string.sec_cannot_no_key)
        compose.waitUntil(WAIT_MILLIS) { compose.onAllNodes(hasText(why)).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test
    fun theAppLockScreenOfAnAppWithoutARecoveryKeySaysWhyItCannotBeTurnedOn() {
        waitForTheSettings()
        compose.onNodeWithText(compose.activity.getString(R.string.sec_cannot_no_key)).assertExists()
        compose.onNodeWithText(compose.activity.getString(R.string.sec_turn_on)).assertDoesNotExist()
    }

    @Test
    fun everyButtonHasALabelAndIsAtLeastATouchTargetTall() {
        // Not only the buttons of the first frame, before the keys are read: the settings' own too.
        waitForTheSettings()
        compose.waitForIdle()
        val buttons = compose.onAllNodes(hasClickAction()).fetchSemanticsNodes()
        assertTrue(buttons.isNotEmpty())
        buttons.forEach { node ->
            val text = node.config.getOrNull(SemanticsProperties.Text)?.joinToString().orEmpty() +
                node.config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString().orEmpty()
            assertTrue("a label for every button", text.isNotBlank())
            val tallest = maxOf(node.size.height.toFloat(), node.touchBoundsInRoot.height)
            val height = with(compose.density) { tallest.toDp() }
            assertTrue("$text takes touches on ${height.value}dp", height.value >= MIN_TOUCH_DP)
        }
    }

    private companion object {
        const val MIN_TOUCH_DP = 48f

        /** How long a test waits for the screen's background thread. It is done in a few milliseconds. */
        const val WAIT_MILLIS = 5_000L
    }
}
