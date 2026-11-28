package app.shkriuss.core.security

import android.content.ComponentName
import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import app.shkriuss.core.design.ShkTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
 * The 24 words of "Sign a device" on a keeper's handover screen: the line
 * that says the words are of another recovery key answers the user's
 * **Check**, so TalkBack reads it when it appears (WCAG 2.2, success
 * criterion 4.1.3). The text around it is not announced.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
@OptIn(SecurityScreenSamples::class)
class HandoverContentTest {
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

    private fun liveRegionOf(id: Int): LiveRegionMode? =
        compose.onNodeWithText(compose.activity.getString(id)).fetchSemanticsNode().config.getOrNull(SemanticsProperties.LiveRegion)

    @Test
    fun theWordsOfAnotherRecoveryKeyAreAnnounced() {
        compose.setContent {
            ShkTheme {
                HandoverContent(
                    HandoverAllWords(WordEntry.empty(), notThisApp = true),
                    "Sync",
                    "Water",
                    previewBuild = false,
                    actions = HandoverActions(),
                    mode = HandoverMode.SIGN_DEVICE,
                )
            }
        }

        assertEquals(LiveRegionMode.Polite, liveRegionOf(R.string.sec_sign_not_this_key))
        assertNull("the intro is read in its turn", liveRegionOf(R.string.sec_enter_intro))
    }
}
