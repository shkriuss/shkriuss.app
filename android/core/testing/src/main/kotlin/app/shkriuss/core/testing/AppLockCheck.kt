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
import app.shkriuss.core.security.GetKeysActivity
import app.shkriuss.core.security.HandoverActivity
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
 * key. [start] says how the app lock is when the first screen starts: on
 * and locked, as after Android stopped the app; on and open, as after the
 * system prompt; or off, so that every screen shows its content.
 *
 * [keys] says which keys the app has at the start. The default is a
 * recovery key. An app that opens with no setup (ADR 0035) also tests its
 * screens with none ([NewAppForTests]) and after a setup that stopped
 * ([StoppedSetupAppForTests]). The app lock is then off: it needs the
 * recovery key.
 *
 * An app's test extends [LockedAppForTests], [AppLockOnForTests],
 * [UnlockedAppForTests], [NewAppForTests] or [StoppedSetupAppForTests] and
 * adds what the app's screens need from the app class, such as the app's
 * own host interface. Its tests add the test fixtures of `core/crypto`,
 * which this class needs at run time.
 */
abstract class HostAppForTests(
    private val appName: AppName,
    private val start: AppLockAtStart,
    private val keys: KeysAtStart = KeysAtStart.RECOVERY_KEY,
) : Application(), SecurityHost {
    private val keyFolder: File get() = File(filesDir, "shk-keys")

    private val software: SoftwareKeysApp by lazy { SoftwareKeysApp(keyFolder, appName) }

    final override val crypto: ShkCrypto
        get() = software.crypto

    // Every read of the keys runs at once on the main thread, so the gate is
    // OPEN or LOCKED before the first screen is created.
    final override val appLock: AppLockWatcher by lazy {
        AppLockWatcher(this, crypto, onTextHidden = {}, background = atOnce, main = atOnce)
    }

    override fun onCreate() {
        super.onCreate()
        check(keys == KeysAtStart.RECOVERY_KEY || start == AppLockAtStart.OFF) { "The app lock needs the recovery key" }
        if (keys != KeysAtStart.NONE) {
            val recoveryKey = crypto.setup.createRecoveryKey()
            crypto.setup.storeDerivedKeys(recoveryKey)
            if (keys == KeysAtStart.STOPPED_SETUP) {
                // As a setup that stopped just before its last keyset, `record`: the others are stored.
                check(File(keyFolder, "record").delete()) { "The record keyset was not stored" }
                check(crypto.status().setupIsUnfinished) { "The setup does not count as stopped" }
            } else if (start != AppLockAtStart.OFF) {
                val proof = checkNotNull(crypto.setup.checkAllWords(recoveryKey)) { "The words of the new key were refused" }
                crypto.appLock.beginTurnOn(proof).finish()
                // Without the file keys in memory the app starts locked.
                if (start == AppLockAtStart.LOCKED) crypto.appLock.lock()
            }
        }
        appLock.start()
    }

    private companion object {
        val atOnce = Executor { it.run() }
    }
}

/** How the app lock of a [HostAppForTests] is when the first screen starts. */
enum class AppLockAtStart {
    /** On, and the app is locked. */
    LOCKED,

    /** On, and the app is open, as after the system prompt. A test can lock it while a screen shows. */
    OPEN,

    /** Off. */
    OFF,
}

/** Which keys a [HostAppForTests] has when the first screen starts. */
enum class KeysAtStart {
    /** The keys of a recovery key: the setup is done. */
    RECOVERY_KEY,

    /** No recovery key yet, as right after the app was installed. */
    NONE,

    /** A setup of the recovery key that stopped half way: some of its keysets are stored, the last one is not. */
    STOPPED_SETUP,
}

/** The app class of the check that every screen of an app is behind the app lock ([AppLockCheck]): locked from the start. */
abstract class LockedAppForTests(appName: AppName) : HostAppForTests(appName, AppLockAtStart.LOCKED)

/**
 * The app class of the check that every sheet and dialog of an app is
 * behind the app lock ([AppLockCheck.checkLockedNow]): the app lock is on
 * and the app is open, so a test can open a sheet or a dialog, then lock
 * the app, as when the screen turns off.
 */
abstract class AppLockOnForTests(appName: AppName) : HostAppForTests(appName, AppLockAtStart.OPEN)

/** An app class whose app lock is off, for screenshots and tests of the screens' content. */
abstract class UnlockedAppForTests(appName: AppName) : HostAppForTests(appName, AppLockAtStart.OFF)

/**
 * An app class with no recovery key yet, as right after the app was
 * installed, for the screens an app shows before the recovery key is first
 * needed (ADR 0035). A test gives it keys as the create flow does:
 * `crypto.setup.storeDerivedKeys(crypto.setup.createRecoveryKey())`.
 */
abstract class NewAppForTests(appName: AppName) : HostAppForTests(appName, AppLockAtStart.OFF, KeysAtStart.NONE)

/** An app class whose setup of the recovery key stopped half way, for the screens that say "Setup not finished". */
abstract class StoppedSetupAppForTests(appName: AppName) : HostAppForTests(appName, AppLockAtStart.OFF, KeysAtStart.STOPPED_SETUP)

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
 * A screen that starts locked never draws its content, so its sheets and
 * dialogs are checked apart: [checkLockedNow], after the app locked while
 * one showed.
 *
 * What it cannot see: something drawn without any semantics, such as a
 * picture with no label in a window of its own, or a dialog that is a
 * plain Android view. Review keeps those out.
 */
object AppLockCheck {
    /** The eight screens of `core/security`. They have no gate: the recovery key must be reachable while the app cannot be unlocked. */
    val SECURITY_SCREENS: List<String> = listOf(
        SecurityActivity::class.java,
        CreateRecoveryKeyActivity::class.java,
        EnterRecoveryKeyActivity::class.java,
        ShowRecoveryKeyActivity::class.java,
        AppLockActivity::class.java,
        TurnOnAppLockActivity::class.java,
        HandoverActivity::class.java,
        GetKeysActivity::class.java,
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

    /**
     * Fails, naming what shows, unless the screen that shows now shows the
     * lock screen and nothing of its own, in any of its windows: no sheet,
     * no dialog, no picker. Call it after the app locked while [screen],
     * the name of its activity, showed a sheet or a dialog, as when the
     * screen turns off. The app class is [AppLockOnForTests].
     */
    fun checkLockedNow(compose: ComposeTestRule, screen: String) {
        compose.waitForIdle()
        val app = ApplicationProvider.getApplicationContext<Application>()
        val gate = (app as? SecurityHost)?.appLock?.gate?.value
        if (gate != AppGate.LOCKED) failWith("The app must be locked now, but its gate is $gate")
        val problems = semanticsProblems(screen, compose)
        if (problems.isNotEmpty()) {
            failWith(buildString {
                appendLine("Something shows while the app is locked. Draw every sheet and dialog from inside AppLockGate:")
                problems.forEach { appendLine("- $it") }
            })
        }
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
