package app.shkriuss.core.security

import android.app.Activity
import android.content.ComponentName
import android.os.Bundle
import android.view.ViewGroup
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.design.ShkDialog
import app.shkriuss.core.design.ShkDialogAction
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.testing.AppLockCheck
import app.shkriuss.core.testing.LockedAppForTests
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The check that every screen of an app is behind the app lock
 * (`AppLockCheck` of core/testing), on sample screens: it passes a screen
 * whose content is all in [AppLockGate], and fails, naming the screen and
 * what it showed, for a screen without the gate, with content beside it,
 * around it, in a dialog of its own or in a plain view, and for an app with
 * no screen to check.
 *
 * A library has no merged manifest of an app, so each test names the
 * activities it would hold: the samples, and the six screens of this
 * module, which the check leaves out. The samples are added to
 * Robolectric's package manager, so that they can start. Water's test reads
 * a real merged manifest.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = LockedSampleApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AppLockCheckTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    /** The activities of a merged manifest with [screens] and the six of this module. */
    private fun manifestWith(vararg screens: Class<out Activity>): List<String> {
        val app = RuntimeEnvironment.getApplication()
        screens.forEach { shadowOf(app.packageManager).addActivityIfNotPresent(ComponentName(app, it)) }
        return screens.map { it.name } + AppLockCheck.SECURITY_SCREENS
    }

    private fun failureOf(vararg screens: Class<out Activity>): String {
        val manifest = manifestWith(*screens)
        return assertThrows(AssertionError::class.java) { AppLockCheck.checkEveryScreen(compose, manifest) }.message.orEmpty()
    }

    @Test
    fun aScreenWhoseContentIsAllInTheGatePassesAndTheScreensOfTheModuleAreLeftOut() {
        val manifest = manifestWith(GatedScreen::class.java)
        assertEquals(listOf(GatedScreen::class.java.name), AppLockCheck.checkEveryScreen(compose, manifest))
    }

    @Test
    fun aScreenWithoutTheGateFails() {
        val failure = failureOf(GatedScreen::class.java, UngatedScreen::class.java)
        assertTrue(failure, failure.contains("${UngatedScreen::class.java.name} shows the lock screen 0 times, not once"))
        assertTrue(failure, failure.contains("\"A secret record\""))
        assertFalse("a screen that passes is not named", failure.contains("${GatedScreen::class.java.name} "))
    }

    @Test
    fun contentBesideTheGateFails() {
        val failure = failureOf(BesideTheGateScreen::class.java)
        assertTrue(failure, failure.contains("${BesideTheGateScreen::class.java.name} shows \"A secret record\" beside the lock screen"))
    }

    @Test
    fun contentAroundTheGateFails() {
        val failure = failureOf(AroundTheGateScreen::class.java)
        assertTrue(failure, failure.contains("${AroundTheGateScreen::class.java.name} shows \"A secret record\" around the lock screen"))
    }

    @Test
    fun aDialogOutsideTheGateFails() {
        val failure = failureOf(DialogOutsideTheGateScreen::class.java)
        assertTrue(failure, failure.contains("${DialogOutsideTheGateScreen::class.java.name} shows \"A secret record\" beside the lock screen"))
    }

    @Test
    fun aPlainViewBesideTheComposeContentFails() {
        val failure = failureOf(ViewBesideTheGateScreen::class.java)
        assertTrue(failure, failure.contains("${ViewBesideTheGateScreen::class.java.name} has a android.widget.TextView beside its Compose content"))
    }

    @Test
    fun anAppWithNoScreenOutsideThisModuleFails() {
        val failure = failureOf()
        assertTrue(failure, failure.contains("holds no screen outside core/security, so nothing was checked"))
    }

    @Test
    fun theScreensLeftOutAreTheSixOfThisModule() {
        assertEquals(
            listOf(
                SecurityActivity::class.java,
                CreateRecoveryKeyActivity::class.java,
                EnterRecoveryKeyActivity::class.java,
                ShowRecoveryKeyActivity::class.java,
                AppLockActivity::class.java,
                TurnOnAppLockActivity::class.java,
            ).map { it.name },
            AppLockCheck.SECURITY_SCREENS,
        )
    }
}

/** The check refuses an app class that does not start locked. */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
class AppLockCheckWithoutALockedAppTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun anAppClassThatDoesNotStartLockedIsRefused() {
        val failure = assertThrows(AssertionError::class.java) {
            AppLockCheck.checkEveryScreen(compose, listOf(GatedScreen::class.java.name))
        }.message.orEmpty()
        assertTrue(failure, failure.contains("The app must start locked, but its gate is OPEN"))
    }
}

/** The app class of [AppLockCheckTest]: its app lock is on and locked from the start. */
class LockedSampleApp : LockedAppForTests(AppName.of("water"))

/** A screen that puts all of its content in the gate, as every screen of an app must. */
class GatedScreen : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { ShkTheme { AppLockGate { ShkText(SECRET) } } }
    }
}

/** A screen that forgot the gate. */
class UngatedScreen : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { ShkTheme { ShkText(SECRET) } }
    }
}

/** A screen with part of its content beside the gate. */
class BesideTheGateScreen : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ShkTheme {
                Column {
                    ShkText(SECRET)
                    AppLockGate { ShkText("The rest") }
                }
            }
        }
    }
}

/** A screen with a label on a box around the gate. */
class AroundTheGateScreen : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ShkTheme {
                Box(Modifier.semantics { contentDescription = SECRET }) {
                    AppLockGate { ShkText("The rest") }
                }
            }
        }
    }
}

/** A screen that shows a dialog outside the gate. A dialog is a window of its own. */
class DialogOutsideTheGateScreen : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ShkTheme {
                AppLockGate { ShkText("The rest") }
                ShkDialog(title = SECRET, confirmAction = ShkDialogAction("Close", {}), onDismissRequest = {})
            }
        }
    }
}

/** A screen with a plain Android view beside its Compose content. */
class ViewBesideTheGateScreen : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { ShkTheme { AppLockGate { ShkText("The rest") } } }
        addContentView(
            TextView(this).apply { text = SECRET },
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )
    }
}

private const val SECRET = "A secret record"
