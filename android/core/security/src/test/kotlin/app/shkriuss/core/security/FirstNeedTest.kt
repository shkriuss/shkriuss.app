package app.shkriuss.core.security

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.os.Looper
import android.os.PowerManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ActivityScenario
import app.shkriuss.core.crypto.DeviceJoinRequest
import app.shkriuss.core.design.ShkFilledButton
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.testing.AppLockCheck
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
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

/** Which form the dialog takes for each need and each state of the keys (ADR 0035, point 3). */
class FirstNeedFormTest {
    @Test
    fun withTheKeysOfARecoveryKeyThereIsNoDialog() {
        RecoveryKeyNeed.entries.forEach { need ->
            assertNull(need.name, firstNeedForm(need, hasDerivedKeys = true, setupIsUnfinished = false))
        }
    }

    @Test
    fun withNoRecoveryKeyEachNeedHasItsForm() {
        assertEquals(FirstNeedForm.SET_UP_FOR_BACKUP, firstNeedForm(RecoveryKeyNeed.BACKUP, hasDerivedKeys = false, setupIsUnfinished = false))
        assertEquals(FirstNeedForm.SET_UP_FOR_APP_LOCK, firstNeedForm(RecoveryKeyNeed.APP_LOCK, hasDerivedKeys = false, setupIsUnfinished = false))
        assertEquals(FirstNeedForm.ENTER_FOR_RESTORE, firstNeedForm(RecoveryKeyNeed.RESTORE, hasDerivedKeys = false, setupIsUnfinished = false))
    }

    @Test
    fun aSetupThatStoppedComesFirstForEveryNeed() {
        RecoveryKeyNeed.entries.forEach { need ->
            assertEquals(need.name, FirstNeedForm.FINISH, firstNeedForm(need, hasDerivedKeys = false, setupIsUnfinished = true))
        }
    }
}

/**
 * [RecoveryKeyFirstNeed] on a screen of an app, with real keys on the
 * stand-in for the Keystore: the dialog in each form with its words and
 * buttons, the screen each button opens, going on when the keys are there,
 * and nothing else when the user leaves.
 *
 * The keys are read at once, on the test's thread, so each state shows
 * right after each tap.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FirstNeedTest {
    private val compose = createAndroidComposeRule<FirstNeedScreen>()

    /** The screen of the test is in no manifest, so it is added to Robolectric's package manager first. */
    private val testScreen = object : ExternalResource() {
        override fun before() {
            val app = RuntimeEnvironment.getApplication()
            shadowOf(app.packageManager).addActivityIfNotPresent(ComponentName(app, FirstNeedScreen::class.java))
            FirstNeedScreen.ready.clear()
            FirstNeedScreen.suite = null
        }
    }

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(testScreen).around(compose)

    private val app get() = compose.activity.application as TestHostApp

    private fun text(id: Int): String = compose.activity.getString(id)

    private fun tap(text: String) {
        compose.onNode(hasText(text) and hasClickAction()).performClick()
        compose.waitForIdle()
    }

    private fun tap(id: Int) = tap(text(id))

    /** The app gets its keys from a new recovery key, as the create flow stores them. */
    private fun giveKeys() {
        app.crypto.setup.storeDerivedKeys(app.crypto.setup.createRecoveryKey())
    }

    /** A setup that stopped just before `record`: its file is gone, the others are stored. */
    private fun stopTheSetup() {
        giveKeys()
        assertTrue(File(app.filesDir, "shk-keys/record").delete())
        assertTrue(app.crypto.status().setupIsUnfinished)
    }

    /** The screen of the recovery key that a button opened, by its class. */
    private fun opened(): Class<*> {
        val started = checkNotNull(shadowOf(compose.activity).peekNextStartedActivityForResult()) { "No screen was opened" }
        return Class.forName(checkNotNull(started.intent.component).className)
    }

    /** That screen closes, as when the user ends the flow or leaves it. The screens set no result. */
    private fun theScreenCloses() {
        val started = shadowOf(compose.activity).nextStartedActivityForResult
        compose.runOnUiThread { shadowOf(compose.activity).receiveResult(started.intent, Activity.RESULT_CANCELED, null) }
        compose.waitForIdle()
    }

    private fun assertNoDialog() {
        listOf(R.string.sec_first_need_set_up_title, R.string.sec_first_need_enter_title, R.string.sec_first_need_finish_title).forEach {
            compose.onNodeWithText(text(it)).assertDoesNotExist()
        }
    }

    @Test
    fun withTheKeysOfARecoveryKeyTheAppGoesOnAtOnce() {
        giveKeys()

        tap(BACKUP)
        tap(RESTORE)
        tap(APP_LOCK)

        assertEquals(listOf(RecoveryKeyNeed.BACKUP, RecoveryKeyNeed.RESTORE, RecoveryKeyNeed.APP_LOCK), FirstNeedScreen.ready)
        assertNoDialog()
        assertNull("no screen is opened", shadowOf(compose.activity).peekNextStartedActivityForResult())
    }

    @Test
    fun aBackupWithNoRecoveryKeyShowsWhyAndThreeButtons() {
        tap(BACKUP)

        compose.onNodeWithText(text(R.string.sec_first_need_set_up_title)).assertExists()
        compose.onNodeWithText(text(R.string.sec_first_need_backup_text)).assertExists()
        // The owner's sentence: a key made in another app of the suite is entered here.
        compose.onNodeWithText(text(R.string.sec_first_need_other_app)).assertExists()
        assertTrue("the sentence names the dialog's button", text(R.string.sec_first_need_other_app).contains(text(R.string.sec_first_need_have_one)))
        listOf(R.string.sec_first_need_create, R.string.sec_first_need_have_one, R.string.sec_first_need_not_now).forEach {
            compose.onNode(hasText(text(it))).assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
        }
        assertEquals("nothing goes on yet", emptyList<RecoveryKeyNeed>(), FirstNeedScreen.ready)
    }

    @Test
    fun theAppLockWithNoRecoveryKeyShowsItsOwnReason() {
        tap(APP_LOCK)

        compose.onNodeWithText(text(R.string.sec_first_need_set_up_title)).assertExists()
        compose.onNodeWithText(text(R.string.sec_first_need_app_lock_text)).assertExists()
        compose.onNodeWithText(text(R.string.sec_first_need_backup_text)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.sec_first_need_other_app)).assertExists()
        compose.onNodeWithText(text(R.string.sec_first_need_create)).assertExists()
        compose.onNodeWithText(text(R.string.sec_first_need_have_one)).assertExists()
    }

    @Test
    fun aRestoreWithNoRecoveryKeyOffersOnlyToEnterTheWords() {
        tap(RESTORE)

        compose.onNodeWithText(text(R.string.sec_first_need_enter_title)).assertExists()
        compose.onNodeWithText(text(R.string.sec_first_need_restore_text)).assertExists()
        compose.onNodeWithText(text(R.string.sec_first_need_enter)).assertExists()
        compose.onNodeWithText(text(R.string.sec_cancel)).assertExists()
        // A new recovery key can never open an old backup.
        compose.onNodeWithText(text(R.string.sec_first_need_create)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.sec_first_need_have_one)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.sec_first_need_other_app)).assertDoesNotExist()
    }

    @Test
    fun withAKeeperOnThePhoneTheDialogOffersItsKeysAndOpensTheGetKeysScreen() {
        val water = KeeperApp("app.shkriuss.water", "Water", "0a0b0c0d")
        FirstNeedScreen.suite = FakeSuiteApps(listOf(water))
        val getKeys = compose.activity.getString(R.string.sec_get_keys_from, "Water")

        listOf(BACKUP, APP_LOCK, RESTORE).forEach { need ->
            tap(need)
            compose.onNodeWithText(text(R.string.sec_keepers_offer)).assertExists()
            compose.onNode(hasText(getKeys)).assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
            // The dialog scrolls when it is taller than the window, as it is at the test's small screen.
            compose.onNode(hasText(getKeys) and hasClickAction()).performScrollTo().performClick()
            compose.waitForIdle()
            val started = checkNotNull(shadowOf(compose.activity).peekNextStartedActivityForResult()) { "No screen was opened" }
            assertEquals(GetKeysActivity::class.java.name, started.intent.component?.className)
            assertEquals("app.shkriuss.water", started.intent.getStringExtra(SecurityScreens.EXTRA_KEEPER))
            theScreenCloses()
            assertNoDialog()
        }
        assertEquals("no keys came, so nothing goes on", emptyList<RecoveryKeyNeed>(), FirstNeedScreen.ready)

        // Keys that came go on with what was started, as after the words.
        tap(BACKUP)
        compose.onNode(hasText(getKeys) and hasClickAction()).performScrollTo().performClick()
        compose.waitForIdle()
        giveKeys()
        theScreenCloses()
        assertEquals(listOf(RecoveryKeyNeed.BACKUP), FirstNeedScreen.ready)
    }

    @Test
    fun aSetupThatStoppedOffersNoKeeperInTheDialog() {
        FirstNeedScreen.suite = FakeSuiteApps(listOf(KeeperApp("app.shkriuss.water", "Water", "0a0b0c0d")))
        stopTheSetup()
        tap(BACKUP)
        compose.onNodeWithText(text(R.string.sec_first_need_finish_title)).assertExists()
        compose.onNodeWithText(text(R.string.sec_keepers_offer)).assertDoesNotExist()
    }

    @Test
    fun afterASetupThatStoppedEveryNeedShowsFinish() {
        stopTheSetup()

        listOf(BACKUP, RESTORE, APP_LOCK).forEach { need ->
            tap(need)
            compose.onNodeWithText(text(R.string.sec_first_need_finish_title)).assertExists()
            compose.onNodeWithText(text(R.string.sec_first_need_finish_text)).assertExists()
            compose.onNodeWithText(text(R.string.sec_first_need_open_security)).assertExists()
            tap(R.string.sec_first_need_not_now)
            assertNoDialog()
        }
        assertEquals(emptyList<RecoveryKeyNeed>(), FirstNeedScreen.ready)
    }

    @Test
    fun eachButtonOpensItsScreenAndTheDialogGoes() {
        tap(BACKUP)
        tap(R.string.sec_first_need_create)
        assertEquals(CreateRecoveryKeyActivity::class.java, opened())
        assertNoDialog()
        theScreenCloses()

        tap(APP_LOCK)
        tap(R.string.sec_first_need_have_one)
        assertEquals(EnterRecoveryKeyActivity::class.java, opened())
        theScreenCloses()

        tap(RESTORE)
        tap(R.string.sec_first_need_enter)
        assertEquals(EnterRecoveryKeyActivity::class.java, opened())
        theScreenCloses()

        stopTheSetup()
        tap(BACKUP)
        tap(R.string.sec_first_need_open_security)
        assertEquals(SecurityActivity::class.java, opened())
    }

    @Test
    fun whenTheFlowEndsWithTheKeysTheAppGoesOnWithoutAnotherTap() {
        tap(RESTORE)
        tap(R.string.sec_first_need_enter)
        // The flow stores the keys, then its screen closes.
        giveKeys()
        theScreenCloses()

        assertEquals(listOf(RecoveryKeyNeed.RESTORE), FirstNeedScreen.ready)
        assertNoDialog()
    }

    @Test
    fun whenTheUserLeavesTheFlowNothingElseHappens() {
        tap(BACKUP)
        tap(R.string.sec_first_need_create)
        theScreenCloses()

        assertEquals(emptyList<RecoveryKeyNeed>(), FirstNeedScreen.ready)
        assertNoDialog()

        // The next tap asks again.
        tap(BACKUP)
        compose.onNodeWithText(text(R.string.sec_first_need_set_up_title)).assertExists()
    }

    @Test
    fun notNowClosesTheDialogAndNothingElseHappens() {
        tap(APP_LOCK)
        tap(R.string.sec_first_need_not_now)

        assertNoDialog()
        assertEquals(emptyList<RecoveryKeyNeed>(), FirstNeedScreen.ready)
        assertNull(shadowOf(compose.activity).peekNextStartedActivityForResult())
    }

    @Test
    fun theDialogStaysWhenThePhoneIsTurned() {
        tap(RESTORE)
        compose.onNodeWithText(text(R.string.sec_first_need_enter_title)).assertExists()

        compose.activityRule.scenario.recreate()
        compose.waitForIdle()

        compose.onNodeWithText(text(R.string.sec_first_need_enter_title)).assertExists()
        assertEquals(emptyList<RecoveryKeyNeed>(), FirstNeedScreen.ready)
    }

    private companion object {
        const val BACKUP = "Start a backup"
        const val RESTORE = "Start a restore"
        const val APP_LOCK = "Start the app lock"
    }
}

/** A screen of an app with three buttons that each need the recovery key, inside the gate. */
class FirstNeedScreen : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ShkTheme {
                AppLockGate {
                    val firstNeed = rememberRecoveryKeyFirstNeedState()
                    RecoveryKeyFirstNeed(firstNeed, onReady = { ready += it }, background = inline, suite = TestSuite)
                    Column {
                        ShkFilledButton("Start a backup", { firstNeed.start(RecoveryKeyNeed.BACKUP) })
                        ShkFilledButton("Start a restore", { firstNeed.start(RecoveryKeyNeed.RESTORE) })
                        ShkFilledButton("Start the app lock", { firstNeed.start(RecoveryKeyNeed.APP_LOCK) })
                    }
                }
            }
        }
    }

    companion object {
        /** What the screen went on with, in order. A test empties it first. */
        val ready = mutableListOf<RecoveryKeyNeed>()

        /** The other apps of the suite, none unless a test sets them. Read on each call, so a test may set them late. */
        internal var suite: SuiteApps? = null

        private object TestSuite : SuiteApps {
            private val now: SuiteApps get() = suite ?: SuiteApps.None

            override fun peerName(packageName: String) = now.peerName(packageName)

            override fun keepers() = now.keepers()

            override fun isSyncApp(packageName: String) = now.isSyncApp(packageName)

            override fun appsWithKeys() = now.appsWithKeys()

            override fun labelOf(packageName: String) = now.labelOf(packageName)

            override fun handoverIntent(packageName: String, mode: HandoverMode, join: DeviceJoinRequest?) =
                now.handoverIntent(packageName, mode, join)

            override fun launchIntent(packageName: String) = now.launchIntent(packageName)
        }
    }
}

/**
 * The dialog is drawn from inside the gate, so it goes with the rest of the
 * screen when the app locks (security-screens.md, "Every screen is behind
 * the gate"). In an app it can never show while the app lock is on,
 * because the app lock needs the recovery key. So no app's own check can
 * open it, and it is checked here, shown as it is drawn.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = OpenSampleApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FirstNeedBehindTheAppLockTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun theDialogGoesWhenTheAppLocks() {
        val app = RuntimeEnvironment.getApplication()
        val screen = FirstNeedDialogInsideTheGateScreen::class.java
        shadowOf(app.packageManager).addActivityIfNotPresent(ComponentName(app, screen))
        ActivityScenario.launch<Activity>(Intent.makeMainActivity(ComponentName(app, screen))).use {
            compose.waitForIdle()
            compose.onNode(hasText(app.getString(R.string.sec_first_need_set_up_title))).assertExists()

            shadowOf(app.getSystemService(PowerManager::class.java)).turnScreenOn(false)
            app.sendBroadcast(Intent(Intent.ACTION_SCREEN_OFF))
            shadowOf(Looper.getMainLooper()).idle()

            AppLockCheck.checkLockedNow(compose, screen.name)
        }
    }
}

/** A screen that shows the dialog in its window, as [RecoveryKeyFirstNeed] draws it, from inside the gate. */
class FirstNeedDialogInsideTheGateScreen : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ShkTheme {
                AppLockGate {
                    ShkText("The rest")
                    FirstNeedDialogView(FirstNeedForm.SET_UP_FOR_BACKUP, inPlace = false, onCreate = {}, onEnter = {}, onSecurity = {}, onDismiss = {})
                }
            }
        }
    }
}
