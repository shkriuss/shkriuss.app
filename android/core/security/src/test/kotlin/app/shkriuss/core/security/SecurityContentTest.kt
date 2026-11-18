package app.shkriuss.core.security

import android.content.ComponentName
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import app.shkriuss.core.design.ShkTheme
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

/**
 * The section "Recovery key" of the security screen, while the app has no
 * recovery key: after the text, the owner's sentence says that a key made
 * in another app of the suite is entered here, and names this screen's own
 * button (docs/apps/reminders/spec.md, "The recovery key").
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
@OptIn(SecurityScreenSamples::class)
class SecurityContentTest {
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

    private fun securityScreen(recoveryKey: RecoveryKeyState) {
        compose.setContent {
            ShkTheme { SecurityContent(SecurityState(loaded = true, recoveryKey = recoveryKey), previewBuild = false, actions = SecurityActions()) }
        }
    }

    @Test
    fun withNoRecoveryKeyTheScreenSaysHowToUseAKeyOfAnotherAppWithItsOwnButtonName() {
        securityScreen(RecoveryKeyState.NONE)

        compose.onNodeWithText(text(R.string.sec_no_key)).assertExists()
        compose.onNodeWithText(text(R.string.sec_no_key_other_app)).assertExists()
        compose.onNodeWithText(text(R.string.sec_enter)).assertExists()
        assertTrue("the sentence names the button of this screen", text(R.string.sec_no_key_other_app).contains(text(R.string.sec_enter)))
    }

    @Test
    fun afterASetupThatStoppedTheSentenceIsNotShown() {
        securityScreen(RecoveryKeyState.UNFINISHED)
        compose.onNodeWithText(text(R.string.sec_no_key_other_app)).assertDoesNotExist()
    }

    @Test
    fun withARecoveryKeyTheSentenceIsNotShown() {
        securityScreen(RecoveryKeyState.SET_UP)
        compose.onNodeWithText(text(R.string.sec_no_key_other_app)).assertDoesNotExist()
    }
}
