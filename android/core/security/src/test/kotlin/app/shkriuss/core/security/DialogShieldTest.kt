package app.shkriuss.core.security

import android.content.ComponentName
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import app.shkriuss.core.crypto.AppLockState
import app.shkriuss.core.design.ShkTheme
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowDialog

/**
 * The four dialogs of the security screen and the app lock screen are
 * windows of their own. Each takes the shield of the screen it opens over
 * ([shieldedLike]): covered taps ignored, and only accessibility tools may
 * read it. Over a screen without a shield, such as a notice of the app
 * lock over an app's screen, a dialog has none either.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
@OptIn(SecurityScreenSamples::class)
class DialogShieldTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    /** The plain activity is in no manifest, so it is added to Robolectric's package manager first. */
    private val plainActivity = object : ExternalResource() {
        override fun before() {
            val app = RuntimeEnvironment.getApplication()
            shadowOf(app.packageManager).addActivityIfNotPresent(ComponentName(app, ComponentActivity::class.java))
        }
    }

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(plainActivity).around(compose)

    private fun text(id: Int): String = compose.activity.getString(id)

    /** The security screen with a stopped setup and files that can be given up, on a shielded window. */
    private fun securityScreen() {
        compose.runOnUiThread { shieldWindow(compose.activity) }
        compose.setContent {
            ShkTheme {
                SecurityContent(
                    SecurityState(loaded = true, recoveryKey = RecoveryKeyState.UNFINISHED, filesCanBeGivenUp = true),
                    previewBuild = false,
                    actions = SecurityActions(),
                )
            }
        }
    }

    /** The app lock screen with the app lock on, on a window that is shielded or not. */
    private fun appLockScreen(shielded: Boolean = true) {
        if (shielded) compose.runOnUiThread { shieldWindow(compose.activity) }
        compose.setContent {
            ShkTheme { AppLockContent(AppLockSettingsScreen(AppLockState.ON), previewBuild = false, actions = AppLockActions()) }
        }
    }

    private fun open(button: Int) {
        compose.onNodeWithText(text(button)).performScrollTo().performClick()
        compose.waitForIdle()
    }

    /** The root view of the dialog's own window, never the screen's. */
    private fun dialogRoot(): View {
        val root = checkNotNull(ShadowDialog.getLatestDialog()?.window).decorView
        assertNotSame("the dialog is a window of its own", compose.activity.window.decorView, root)
        return root
    }

    @Test
    fun giveUpTheFilesIsShieldedLikeItsScreen() {
        securityScreen()
        open(R.string.sec_give_up_button)
        compose.onNodeWithText(text(R.string.sec_give_up_title)).assertExists()
        assertTrue(dialogRoot().isShielded())
    }

    @Test
    fun startOverIsShieldedLikeItsScreen() {
        securityScreen()
        open(R.string.sec_start_over)
        compose.onNodeWithText(text(R.string.sec_start_over_title)).assertExists()
        assertTrue(dialogRoot().isShielded())
    }

    @Test
    fun turnOffIsShieldedLikeItsScreen() {
        appLockScreen()
        open(R.string.sec_turn_off)
        compose.onNodeWithText(text(R.string.sec_turn_off_title)).assertExists()
        assertTrue(dialogRoot().isShielded())
    }

    @Test
    fun lockTheAppIsShieldedLikeItsScreen() {
        appLockScreen()
        open(R.string.sec_lock_after_label)
        compose.onNodeWithText(text(R.string.sec_done)).assertExists()
        assertTrue(dialogRoot().isShielded())
    }

    @Test
    fun aDialogOverAScreenWithoutAShieldHasNone() {
        appLockScreen(shielded = false)
        open(R.string.sec_turn_off)
        compose.onNodeWithText(text(R.string.sec_turn_off_title)).assertExists()
        assertTrue(dialogRoot().isNotShielded())
    }
}
