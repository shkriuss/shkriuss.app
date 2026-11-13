package app.shkriuss.core.security

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The app lock screen, started as Android starts it: every button has a label and a 48dp touch target. */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
class AppLockActivitiesTest {
    @get:Rule
    val compose = createAndroidComposeRule<AppLockActivity>()

    @Test
    fun theAppLockScreenOfAnAppWithoutARecoveryKeySaysWhyItCannotBeTurnedOn() {
        compose.onNodeWithText(compose.activity.getString(R.string.sec_cannot_no_key)).assertExists()
        compose.onNodeWithText(compose.activity.getString(R.string.sec_turn_on)).assertDoesNotExist()
    }

    @Test
    fun everyButtonHasALabelAndIsAtLeastATouchTargetTall() {
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
    }
}
