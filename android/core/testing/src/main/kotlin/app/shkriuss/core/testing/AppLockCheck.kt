package app.shkriuss.core.testing

import android.app.Activity
import android.app.Application
import android.content.ComponentName
import android.content.Intent
import android.view.ViewGroup
import androidx.compose.ui.platform.AbstractComposeView
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.security.AppGate
import app.shkriuss.core.security.AppLockActivity
import app.shkriuss.core.security.AppLockWatcher
import app.shkriuss.core.security.CreateRecoveryKeyActivity
import app.shkriuss.core.security.EnterRecoveryKeyActivity
import app.shkriuss.core.security.LOCK_SCREEN_TEST_TAG
import app.shkriuss.core.security.SecurityActivity
import app.shkriuss.core.security.SecurityHost
import app.shkriuss.core.security.ShowRecoveryKeyActivity
import app.shkriuss.core.security.TurnOnAppLockActivity
import java.io.File
import java.util.concurrent.Executor

/**
 * An app class for the screen tests of an app: a `SecurityHost` with real
 * cryptography on the stand-in for the Keystore (ADR 0029), and a recovery
 * key. With [startsLocked], its app lock is on and the app is locked before
 * any screen starts, as after Android stopped the app. Otherwise the app
 * lock is off and every screen shows its content.
 *
 * An app's test extends [LockedAppForTests] or [UnlockedAppForTests] and
 * adds what the app's screens need from the app class, such as the app's
 * own host interface. Its tests add the test fixtures of `core/crypto`,
 * which this class needs at run time.
 */
abstract class HostAppForTests(private val appName: AppName, private val startsLocked: Boolean) : Application(), SecurityHost {
    private val keys: SoftwareKeysApp by lazy { SoftwareKeysApp(File(filesDir, "shk-keys"), appName) }

    final override val crypto: ShkCrypto
        get() = keys.crypto

    // Every read of the keys runs at once on the main thread, so the gate is
    // OPEN or LOCKED before the first screen is created.
    final override val appLock: AppLockWatcher by lazy {
        AppLockWatcher(this, crypto, onTextHidden = {}, background = atOnce, main = atOnce)
    }

    override fun onCreate() {
        super.onCreate()
        val recoveryKey = crypto.setup.createRecoveryKey()
        crypto.setup.storeDerivedKeys(recoveryKey)
        if (startsLocked) {
            val proof = checkNotNull(crypto.setup.checkAllWords(recoveryKey)) { "The words of the new key were refused" }
            crypto.appLock.beginTurnOn(proof).finish()
            // Without the file keys in memory the app starts locked.
            crypto.appLock.lock()
        }
        appLock.start()
    }

    private companion object {
        val atOnce = Executor { it.run() }
    }
}

/** The app class of the check that every screen of an app is behind the app lock ([AppLockCheck]): locked from the start. */
abstract class LockedAppForTests(appName: AppName) : HostAppForTests(appName, startsLocked = true)

/** An app class whose app lock is off, for screenshots and tests of the screens' content. */
abstract class UnlockedAppForTests(appName: AppName) : HostAppForTests(appName, startsLocked = false)

/**
 * The check that every screen of an app is behind the app lock
 * (docs/architecture/security-screens.md, "Every screen is behind the
 * gate"). Each app has one test that calls [checkEveryScreen], with
 * [LockedAppForTests] as its app class. Every later app copies Water's.
 *
 * It starts every activity of the app's merged manifest, except the
 * screens of `core/security`, which are not behind the gate on purpose
 * (security-screens.md, "The app lock").
 * With the app lock on and the app locked, each must show the lock screen
 * of `AppLockGate` and nothing of its own:
 *
 * - The lock screen, found by [LOCK_SCREEN_TEST_TAG], shows once.
 * - No semantics node of any window of the screen is beside it: no text, no
 *   button, no label, no field, no dialog of its own. A node around it may
 *   only group or tag.
 * - The screen's content view holds Compose views only, so no plain view
 *   can show beside the gate.
 *
 * What it cannot see: something drawn without any semantics, such as a
 * picture with no label in a window of its own, or a dialog that is a
 * plain Android view. Review keeps those out.
 */
object AppLockCheck {
    /** The six screens of `core/security`. They have no gate: the recovery key must be reachable while the app cannot be unlocked. */
    val SECURITY_SCREENS: List<String> = listOf(
        SecurityActivity::class.java,
        CreateRecoveryKeyActivity::class.java,
        EnterRecoveryKeyActivity::class.java,
        ShowRecoveryKeyActivity::class.java,
        AppLockActivity::class.java,
        TurnOnAppLockActivity::class.java,
    ).map { it.name }

    /**
     * Starts every activity of the app's merged manifest, as it goes into
     * the APK, except [SECURITY_SCREENS]. Fails, naming each screen and what
     * it showed, unless each shows the lock screen and nothing of its own.
     * Fails too if there is no screen to check. Returns the names of the
     * screens it checked.
     *
     * [manifestActivities] are the activities of the merged manifest. The
     * default reads them from the app's own ([MergedManifest]).
     */
    fun checkEveryScreen(compose: ComposeTestRule, manifestActivities: List<String> = MergedManifest.activities()): List<String> {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val gate = (app as? SecurityHost)?.appLock?.gate?.value
        if (gate != AppGate.LOCKED) failWith("The app must start locked, but its gate is $gate. The test's app class extends LockedAppForTests")
        val screens = manifestActivities.filter { it !in SECURITY_SCREENS }.sorted()
        if (screens.isEmpty()) failWith("The merged manifest of ${app.packageName} holds no screen outside core/security, so nothing was checked")
        val problems = screens.flatMap { problemsOf(app, it, compose) }
        if (problems.isNotEmpty()) {
            failWith(buildString {
                appendLine("A screen shows something while the app is locked. Put all of its content in AppLockGate:")
                problems.forEach { appendLine("- $it") }
            })
        }
        return screens
    }

    private fun failWith(message: String): Nothing = throw AssertionError(message)

    private fun problemsOf(app: Application, screen: String, compose: ComposeTestRule): List<String> {
        val problems = mutableListOf<String>()
        ActivityScenario.launch<Activity>(Intent.makeMainActivity(ComponentName(app, screen))).use { scenario ->
            compose.waitForIdle()
            scenario.onActivity { activity -> problems += viewProblems(screen, activity) }
            problems += semanticsProblems(screen, compose)
        }
        return problems
    }

    /** A view in the content view that is not a Compose view could show beside the gate. */
    private fun viewProblems(screen: String, activity: Activity): List<String> {
        val content = activity.findViewById<ViewGroup>(android.R.id.content)
        return (0 until content.childCount).map { content.getChildAt(it) }
            .filter { it !is AbstractComposeView }
            .map { "$screen has a ${it.javaClass.name} beside its Compose content" }
    }

    private fun semanticsProblems(screen: String, compose: ComposeTestRule): List<String> {
        val roots = compose.onAllNodes(isRoot(), useUnmergedTree = true).fetchSemanticsNodes(atLeastOneRootRequired = false)
        val nodes = roots.flatMap { it.withEveryChild() }
        val locks = nodes.filter { it.config.getOrNull(SemanticsProperties.TestTag) == LOCK_SCREEN_TEST_TAG }
        if (locks.size != 1) {
            val shown = nodes.filter(::showsSomething).joinToString { describe(it) }.ifEmpty { "nothing" }
            return listOf("$screen shows the lock screen ${locks.size} times, not once. It shows: $shown")
        }
        val lock = locks.single()
        val inside = lock.withEveryChild().map { it.id }.toSet()
        val around = generateSequence(lock.parent) { it.parent }.map { it.id }.toSet()
        return nodes.filter { it.id !in inside && showsSomething(it) }.map { node ->
            val where = if (node.id in around) "around" else "beside"
            "$screen shows ${describe(node)} $where the lock screen"
        }
    }

    private fun SemanticsNode.withEveryChild(): List<SemanticsNode> = listOf(this) + children.flatMap { it.withEveryChild() }

    /** True for a node that holds anything but a grouping or a tag: a text, a label, a state, an action. */
    private fun showsSomething(node: SemanticsNode): Boolean = node.config.any { (key, _) -> key.name !in GROUPING_ONLY }

    private fun describe(node: SemanticsNode): String {
        val config = node.config
        val words = (config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text } +
            config.getOrNull(SemanticsProperties.ContentDescription).orEmpty() +
            listOfNotNull(config.getOrNull(SemanticsProperties.EditableText)?.text))
        return if (words.isNotEmpty()) {
            words.joinToString(prefix = "\"", postfix = "\"", separator = "\", \"")
        } else {
            "a node with " + config.map { (key, _) -> key.name }.sorted().joinToString()
        }
    }

    /** The semantics a node around the lock screen may have: they group or tag, and show nothing. */
    private val GROUPING_ONLY = setOf("TestTag", "TestTagsAsResourceId", "IsTraversalGroup", "TraversalIndex")
}
