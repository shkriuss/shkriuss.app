package app.shkriuss.core.security

import android.content.ComponentName
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import app.shkriuss.core.crypto.AppLockState
import app.shkriuss.core.design.ShkTheme
import org.junit.Assert.assertEquals
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

    private val water = KeeperApp("app.shkriuss.water", "Water", "0a0b0c0d")
    private val meals = KeeperApp("app.shkriuss.meals", "Meals", "01020304")

    private fun securityScreen(state: SecurityState, actions: SecurityActions) {
        compose.setContent { ShkTheme { SecurityContent(state, previewBuild = false, actions = actions) } }
    }

    private fun tap(label: String) {
        compose.onNode(hasText(label) and hasClickAction()).performScrollTo().performClick()
        compose.waitForIdle()
    }

    @Test
    fun withNoRecoveryKeyEachKeeperOffersItsKeysAndTheOwnersSentenceStays() {
        val asked = mutableListOf<KeeperApp>()
        securityScreen(SecurityState(loaded = true, keepers = listOf(water, meals)), SecurityActions(onGetKeys = { asked += it }))

        compose.onNodeWithText(text(R.string.sec_keepers_offer)).assertExists()
        compose.onNodeWithText(text(R.string.sec_no_key_other_app)).assertExists()
        // Two keepers of two different keys: each button names its key.
        tap(compose.activity.getString(R.string.sec_get_keys_from_with_key, "Meals", "01020304"))
        tap(compose.activity.getString(R.string.sec_get_keys_from_with_key, "Water", "0a0b0c0d"))
        assertEquals(listOf(meals, water), asked)
    }

    @Test
    fun anAppThatDoesNotKeepItsKeyNamesTheAppsThatDoAndOpensThem() {
        val opened = mutableListOf<KeeperApp>()
        val state = SecurityState(loaded = true, recoveryKey = RecoveryKeyState.SET_UP, keyId = "0a0b0c0d", kept = Kept.NOT_KEPT, keepers = listOf(water, meals))
        securityScreen(state, SecurityActions(onOpenKeeper = { opened += it }))

        compose.onNodeWithText(compose.activity.getString(R.string.sec_kept_in, "Water")).assertExists()
        compose.onNodeWithText(text(R.string.sec_not_kept)).assertDoesNotExist()
        tap(compose.activity.getString(R.string.sec_open_keeper, "Water"))
        assertEquals("only the keeper of this app's key", listOf(water), opened)
        compose.onNodeWithText(compose.activity.getString(R.string.sec_open_keeper, "Meals")).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.sec_keep_here)).assertExists()
    }

    @Test
    fun withNoKeeperOfItsKeyTheAppSaysThePaperIsTheOnlyCopy() {
        val state = SecurityState(loaded = true, recoveryKey = RecoveryKeyState.SET_UP, keyId = "0a0b0c0d", kept = Kept.NOT_KEPT, keepers = listOf(meals))
        securityScreen(state, SecurityActions())
        compose.onNodeWithText(text(R.string.sec_not_kept)).assertExists()
    }

    @Test
    fun aResetAppLockAndADamagedFileOfferTheKeysOfAKeeperOfTheSameKey() {
        val asked = mutableListOf<KeeperApp>()
        val state = SecurityState(
            loaded = true,
            recoveryKey = RecoveryKeyState.SET_UP,
            keyId = "0a0b0c0d",
            kept = Kept.NOT_KEPT,
            keepers = listOf(water, meals),
            needsRepair = true,
            appLock = AppLockState.RESET,
        )
        securityScreen(state, SecurityActions(onGetKeys = { asked += it }))
        compose.onAllNodes(hasText(compose.activity.getString(R.string.sec_get_keys_from, "Water"))).fetchSemanticsNodes().let {
            assertEquals("one in the repair section, one under the app lock", 2, it.size)
        }
        compose.onNodeWithText(compose.activity.getString(R.string.sec_get_keys_from, "Meals")).assertDoesNotExist()
    }

    @Test
    fun aDamagedRecordWhoseShortNameIsUnknownOffersEveryKeeper() {
        val asked = mutableListOf<KeeperApp>()
        val state = SecurityState(
            loaded = true,
            recoveryKey = RecoveryKeyState.SET_UP,
            keyId = null,
            kept = Kept.NOT_KEPT,
            keepers = listOf(water, meals),
            needsRepair = true,
        )
        securityScreen(state, SecurityActions(onGetKeys = { asked += it }))
        // ADR 0041, point 14: the app cannot tell its own key, so every keeper is offered.
        tap(compose.activity.getString(R.string.sec_get_keys_from_with_key, "Meals", "01020304"))
        tap(compose.activity.getString(R.string.sec_get_keys_from_with_key, "Water", "0a0b0c0d"))
        assertEquals(listOf(meals, water), asked)
    }

    @Test
    fun afterNotNowTheDoneScreenNamesTheAppThatKeepsTheKeyInsteadOfTheOnlyCopy() {
        compose.setContent { ShkTheme { EnterContent(FlowDone(Kept.NOT_KEPT, keptIn = listOf("Water")), false, EnterActions()) } }
        compose.onNodeWithText(compose.activity.getString(R.string.sec_kept_in, "Water")).assertExists()
        compose.onNodeWithText(text(R.string.sec_done_not_kept)).assertDoesNotExist()
    }

    @Test
    fun withNoOtherKeeperTheDoneScreenSaysThePaperIsTheOnlyCopy() {
        compose.setContent { ShkTheme { EnterContent(FlowDone(Kept.NOT_KEPT), false, EnterActions()) } }
        compose.onNodeWithText(text(R.string.sec_done_not_kept)).assertExists()
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
