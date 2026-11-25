package app.shkriuss.core.security

import android.content.ComponentName
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import app.shkriuss.core.crypto.AppLockState
import app.shkriuss.core.design.ShkTheme
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
 * The app lock screen with the app lock on, drawn in a plain activity:
 * in an app that shows notifications it offers "Show the text in
 * notifications"; in an app that shows none, it leaves out the whole
 * section, which would do nothing there
 * (docs/architecture/security-screens.md, "What an app does", point 3).
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
@OptIn(SecurityScreenSamples::class)
class AppLockContentTest {
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

    private fun appLockScreen(showsNotifications: Boolean) {
        compose.setContent {
            ShkTheme {
                AppLockContent(
                    AppLockSettingsScreen(AppLockState.ON, showsNotifications = showsNotifications),
                    previewBuild = false,
                    actions = AppLockActions(),
                )
            }
        }
        compose.waitForIdle()
    }

    /** How many nodes show the words of [id], also below the edge of the window. */
    private fun shown(id: Int): Int = compose.onAllNodes(hasText(text(id))).fetchSemanticsNodes().size

    @Test
    fun anAppWithNotificationsOffersTheChoiceAboutTheirText() {
        appLockScreen(showsNotifications = true)

        compose.onAllNodes(hasText(text(R.string.sec_section_notifications))).assertCountEquals(1)
        compose.onAllNodes(hasText(text(R.string.sec_notification_text_switch))).assertCountEquals(1)
        compose.onAllNodes(hasText(text(R.string.sec_notification_text_help))).assertCountEquals(1)
    }

    @Test
    fun anAppWithoutNotificationsLeavesOutTheWholeSection() {
        appLockScreen(showsNotifications = false)

        listOf(R.string.sec_section_notifications, R.string.sec_notification_text_switch, R.string.sec_notification_text_help).forEach {
            compose.onAllNodes(hasText(text(it))).assertCountEquals(0)
        }
        // The rest of the screen is still there.
        check(shown(R.string.sec_section_lock_after) == 1) { "Lock the app is shown" }
        check(shown(R.string.sec_block_switch) == 1) { "The screenshot block is shown" }
    }
}
