package app.shkriuss.core.security

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.os.PowerManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import app.shkriuss.core.crypto.AppLockState
import app.shkriuss.core.design.ShkFilledButton
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
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
import org.robolectric.annotation.GraphicsMode

/**
 * [AppLockGate] around a screen of an app: nothing of the screen while
 * the app is locked, the screen back as it was after the system prompt,
 * and the result of a picker the screen opened kept across a lock.
 *
 * The lock screen opens and finishes its system prompt on a background
 * thread, as in an app (`Dispatchers.IO`). Compose's `waitForIdle` does not
 * wait for that thread. So this test waits for what it reads next: the
 * prompt ([waitForThePrompt]), and the screen back after it
 * ([waitForTheLockScreenToGo]). Without the waits, a slow start of that
 * thread fails the test now and then.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AppLockGateTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    /** The plain activity is in no manifest, so it is added to Robolectric's package manager first. */
    private val plainActivity = object : ExternalResource() {
        override fun before() {
            val app = RuntimeEnvironment.getApplication()
            shadowOf(app.packageManager).addActivityIfNotPresent(ComponentName(app, ComponentActivity::class.java))
            shadowOf(app.getSystemService(PowerManager::class.java)).turnScreenOn(true)
        }
    }

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(plainActivity).around(compose)

    private val app get() = compose.activity.application as TestHostApp
    private val watcher get() = app.appLock

    /** Draws of the screen's content, so a test can see that none happens while the app is locked. */
    private var drawn = 0

    private fun turnOn() {
        val key = app.crypto.setup.createRecoveryKey()
        app.crypto.setup.storeDerivedKeys(key)
        app.crypto.appLock.beginTurnOn(app.crypto.setup.checkAllWords(key)!!).finish()
        compose.runOnUiThread { watcher.turnedOn(watcher.unlockMark()) }
        compose.waitForIdle()
    }

    /** A screen of an app with a number it keeps in its saved state, inside the gate. */
    private fun gatedScreen() {
        compose.setContent {
            ShkTheme {
                AppLockGate {
                    var taps by rememberSaveable { mutableIntStateOf(0) }
                    Column(Modifier.drawBehind { drawn++ }) {
                        ShkText("A secret record, tapped $taps times")
                        ShkFilledButton("Tap", { taps++ })
                    }
                }
            }
        }
    }

    /** Waits, for a background thread, until [condition] holds. Fails with [what] if it does not in time. */
    private fun waitFor(what: String, condition: () -> Boolean) {
        try {
            compose.waitUntil(WAIT_MILLIS, condition)
        } catch (late: ComposeTimeoutException) {
            throw AssertionError("$what, after $WAIT_MILLIS ms", late)
        }
    }

    /** The ViewModel of the lock screen. It is there once the lock screen is composed. */
    private fun lockScreen(): UnlockViewModel {
        compose.waitForIdle()
        return ViewModelProvider(compose.activity)[UnlockViewModel::class.java]
    }

    /** Waits until the lock screen has opened its system prompt, on its background thread, and gives it. */
    private fun waitForThePrompt(what: String = "the system prompt is open"): PromptRequest {
        val model = lockScreen()
        waitFor(what) { model.state.value.prompt != null }
        return checkNotNull(model.state.value.prompt)
    }

    /** Waits until a prompt that succeeded has unlocked the app: the lock screen is gone, and the screen is back. */
    private fun waitForTheLockScreenToGo() {
        waitFor("the lock screen goes after the prompt") { compose.onAllNodes(hasText("Unlock")).fetchSemanticsNodes().isEmpty() }
        compose.waitForIdle()
    }

    /** Answers the system prompt of the lock screen, as Android does when the user answers it. */
    private fun answerTheLockScreen(outcome: PromptOutcome) {
        val model = lockScreen()
        val prompt = waitForThePrompt()
        compose.runOnUiThread { model.onPromptResult(prompt, outcome) }
        if (outcome == PromptOutcome.SUCCEEDED) waitForTheLockScreenToGo() else compose.waitForIdle()
    }

    private fun leaveAndComeBack() {
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.waitForIdle()
    }

    @Test
    fun withTheAppLockOffTheScreenShows() {
        gatedScreen()
        compose.onNodeWithText("A secret record, tapped 0 times").assertExists()
    }

    @Test
    fun whileLockedNothingOfTheScreenIsComposedOrDrawnAndTheSystemPromptOpens() {
        turnOn()
        gatedScreen()
        compose.onNodeWithText("Tap").performClick()
        compose.waitForIdle()
        val drawsBefore = drawn
        assertTrue("the screen was drawn while open", drawsBefore > 0)

        leaveAndComeBack()

        compose.onNodeWithText("A secret record", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Unlock").assertExists()
        assertEquals("not one frame of the screen on the way back", drawsBefore, drawn)
        waitForThePrompt("the prompt shows by itself")
        assertEquals("not one frame of the screen while the prompt opened", drawsBefore, drawn)
    }

    @Test
    fun afterThePromptTheScreenComesBackAsItWas() {
        turnOn()
        gatedScreen()
        compose.onNodeWithText("Tap").performClick()
        compose.onNodeWithText("Tap").performClick()

        leaveAndComeBack()
        answerTheLockScreen(PromptOutcome.SUCCEEDED)

        compose.onNodeWithText("A secret record, tapped 2 times").assertExists()
        assertFalse(app.crypto.appLock.isLocked())
    }

    @Test
    fun aClosedPromptLeavesTheAppLockedAndTheButtonOpensItAgain() {
        turnOn()
        gatedScreen()
        leaveAndComeBack()

        answerTheLockScreen(PromptOutcome.CANCELLED)
        compose.onNodeWithText("A secret record", substring = true).assertDoesNotExist()

        compose.onNodeWithText("Unlock").performClick()
        answerTheLockScreen(PromptOutcome.SUCCEEDED)
        compose.onNodeWithText("A secret record, tapped 0 times").assertExists()
    }

    @Test
    fun backOnTheLockScreenLeavesTheAppAndNeverReachesTheScreen() {
        turnOn()
        gatedScreen()
        leaveAndComeBack()

        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()

        assertFalse(compose.activity.isFinishing)
        compose.onNodeWithText("A secret record", substring = true).assertDoesNotExist()
    }

    @Test
    fun theResultOfAPickerOpenedBeforeTheLockReachesTheScreenAfterThePrompt() {
        turnOn()
        compose.setContent {
            ShkTheme {
                AppLockGate {
                    var picked by rememberSaveable { mutableStateOf("nothing") }
                    val picker = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
                        picked = result.data?.getStringExtra("picked") ?: "no data"
                    }
                    Column {
                        ShkText("Picked: $picked")
                        ShkFilledButton("Attach a file", { picker.launch(Intent("app.shkriuss.test.PICK")) })
                    }
                }
            }
        }
        compose.onNodeWithText("Attach a file").performClick()
        val opened = shadowOf(compose.activity).nextStartedActivityForResult
        assertNotNull("the picker opened", opened)

        // The picker is another app's screen: this app has left the screen, and locks.
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        assertEquals(AppGate.LOCKED, watcher.gate.value)
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.waitForIdle()
        compose.runOnUiThread {
            shadowOf(compose.activity).receiveResult(opened.intent, Activity.RESULT_OK, Intent().putExtra("picked", "photo.jpg"))
        }
        compose.waitForIdle()
        compose.onNodeWithText("Picked", substring = true).assertDoesNotExist()

        answerTheLockScreen(PromptOutcome.SUCCEEDED)

        compose.onNodeWithText("Picked: photo.jpg").assertExists()
    }

    @Test
    fun aResetShowsItsNoticeOverTheScreen() {
        turnOn()
        gatedScreen()
        leaveAndComeBack()

        app.keys.screenLock = false
        compose.runOnUiThread { watcher.refresh() }
        compose.waitForIdle()

        assertEquals(AppLockState.RESET, app.crypto.appLock.state())
        compose.onNodeWithText(compose.activity.getString(R.string.sec_notice_reset_title)).assertExists()
        compose.onNodeWithText("A secret record, tapped 0 times").assertExists()
    }

    private companion object {
        /** How long a test waits for the lock screen's background thread. It is done in a few milliseconds. */
        const val WAIT_MILLIS = 5_000L
    }
}

/** An app class that forgot to start its watcher: the gate refuses to show anything. */
@RunWith(RobolectricTestRunner::class)
@Config(application = ForgetfulHostApp::class)
class AppLockGateWithoutAWatcherTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    private val plainActivity = object : ExternalResource() {
        override fun before() {
            val app = RuntimeEnvironment.getApplication()
            shadowOf(app.packageManager).addActivityIfNotPresent(ComponentName(app, ComponentActivity::class.java))
        }
    }

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(plainActivity).around(compose)

    @Test(expected = IllegalStateException::class)
    fun theGateFailsWhenTheWatcherNeverSawTheScreenStart() {
        compose.setContent { ShkTheme { AppLockGate { ShkText("A secret record") } } }
        compose.waitForIdle()
    }
}
