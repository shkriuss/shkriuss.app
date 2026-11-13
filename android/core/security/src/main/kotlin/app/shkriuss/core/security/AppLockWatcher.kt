package app.shkriuss.core.security

import android.app.Activity
import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.os.PowerManager
import android.os.SystemClock
import android.view.WindowManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.shkriuss.core.crypto.AppLockState
import app.shkriuss.core.crypto.ShkCrypto
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What the gate of every screen of an app shows ([AppLockGate]). */
enum class AppGate {
    /** The state of the app lock is not read yet. The gate shows nothing. */
    CHECKING,

    /** The app lock is off, or the app is unlocked. The screen shows. */
    OPEN,

    /** The app lock is on and the app is locked. Nothing of the screen shows until the system prompt. */
    LOCKED,
}

/** What the gate tells the user once, in a dialog over the screen. */
enum class AppLockNotice {
    /** The screen lock was removed while the app lock was on. The app's files stay closed until the words are entered. */
    RESET,

    /** The app lock went off without the user turning it off: the screen lock was removed while the app was unlocked. */
    TURNED_OFF,
}

/**
 * Decides when the optional app lock locks the app, and what every window
 * of the app hides (docs/architecture/security-screens.md, "When the app
 * locks"). The app class builds one and calls [start] in its `onCreate`,
 * and hands it out through [SecurityHost.appLock]. Every screen of the
 * app puts its content in [AppLockGate], which shows what [gate] says.
 *
 * It locks:
 *
 * 1. When the app leaves the screen, if the user chose "When it leaves
 *    the screen", or if the phone's screen turned off with the app on it.
 * 2. When the app comes back after it was away for the chosen time. The
 *    time is counted with [elapsed], a clock the user cannot change. The
 *    lock comes before Android draws the window again.
 * 3. After Android stopped the app: the file keys are then not in memory.
 *
 * The screen-off broadcast is a help only. Android 14 and later hold it
 * back while the app waits in the background. One that comes after the
 * screen is on again is ignored, because a lock then would show the
 * content first and lock after.
 *
 * With the app lock off it drops the file keys whenever the app leaves
 * the screen. They load again without a prompt.
 *
 * [onTextHidden] runs on the main thread when notifications must hide
 * their text from now on: the app passes `{ notify.hideShownText() }`,
 * or `{}` if it shows no notifications. It has no default, so that no app
 * can forget it. Everything else runs on the main thread, except the
 * reads of the keys, which run on [background].
 */
class AppLockWatcher(
    private val app: Application,
    private val crypto: ShkCrypto,
    private val onTextHidden: () -> Unit,
    private val elapsed: () -> Long = SystemClock::elapsedRealtime,
    private val background: Executor = Executors.newSingleThreadExecutor { Thread(it, "core-security") },
    private val main: Executor = app.mainExecutor,
) {
    private val settings = AppLockSettings(app)
    private val power = app.getSystemService(PowerManager::class.java)

    private val gateFlow = MutableStateFlow(AppGate.CHECKING)

    /** What the gate shows now. A screen's ViewModel can wait for [AppGate.OPEN] to go on with work that needs the file keys. */
    val gate: StateFlow<AppGate> = gateFlow.asStateFlow()

    /** [gate] as Compose state, so that a change made in an activity callback is drawn in the next frame. */
    internal var gateNow by mutableStateOf(AppGate.CHECKING)
        private set

    /** The notice the gate shows, or null. */
    internal var notice by mutableStateOf<AppLockNotice?>(null)
        private set

    /** Counts the locks, so that the gate shows the system prompt by itself once for each. */
    internal var locks by mutableIntStateOf(0)
        private set

    // All of this is read and written on the main thread only.
    private var known: AppLockState? = null
    private var readFailed = false
    private var locked = true
    private var generation = 0
    private var resetAnnounced = false
    private val activities = mutableSetOf<Activity>()
    private var startedActivities = 0
    private var changingConfigurations = false
    private var leftAt: Long? = null
    private var isStarted = false

    /**
     * Call once, in the app class's `onCreate`, before any screen starts.
     * The gate of a screen that started before refuses to show anything.
     */
    fun start() {
        check(!isStarted) { "AppLockWatcher.start() runs once" }
        isStarted = true
        app.registerActivityLifecycleCallbacks(callbacks)
        app.registerReceiver(screenOff, IntentFilter(Intent.ACTION_SCREEN_OFF), Context.RECEIVER_NOT_EXPORTED)
        refresh()
    }

    /**
     * True if notifications must hide their title and text now: the app
     * lock is on, and the user did not ask to show the text. Also true if
     * the state of the app lock cannot be read. Any thread may call it;
     * `core/notify` calls it on its worker thread.
     */
    fun hidesNotificationText(): Boolean = try {
        crypto.appLock.state() == AppLockState.ON && !settings.notificationText
    } catch (_: Exception) {
        true
    }

    /** True if [activity] started after [start]. The gate checks it. */
    internal fun knows(activity: Activity): Boolean = activity in activities

    /** Reads the state of the app lock again, on [background]. With [announce] false, a change shows no notice. */
    internal fun refresh(announce: Boolean = true) {
        val asked = generation
        background.execute {
            val read = try {
                Read(crypto.appLock.state(), crypto.appLock.isLocked())
            } catch (_: Exception) {
                null
            }
            main.execute { take(read, asked, announce) }
        }
    }

    /** A system prompt unlocked the app: the file keys are in memory. */
    internal fun unlocked() {
        generation++
        locked = false
        publish()
        refresh()
    }

    /** The app lock was turned on, and the app is unlocked. */
    internal fun turnedOn() {
        generation++
        known = AppLockState.ON
        locked = false
        publish()
        applyFlagsToAll()
        if (!settings.notificationText) onTextHidden()
        refresh()
    }

    /** The user turned the app lock off. */
    internal fun turnedOff() {
        generation++
        known = AppLockState.OFF
        publish()
        applyFlagsToAll()
        refresh()
    }

    /** The user closed the notice. */
    internal fun dismissNotice() {
        notice = null
    }

    /** When the app locks after it left the screen. */
    internal var lockAfter: LockAfter
        get() = settings.lockAfter
        set(value) {
            settings.lockAfter = value
        }

    /** True if every window of the app blocks screenshots and shows blank in the recent apps. */
    internal var blocksScreenshots: Boolean
        get() = settings.blockScreenshots
        set(value) {
            settings.blockScreenshots = value
            applyFlagsToAll()
        }

    /** True if notifications show their text while the app lock is on. */
    internal var showsNotificationText: Boolean
        get() = settings.notificationText
        set(value) {
            settings.notificationText = value
            if (!value && known == AppLockState.ON) onTextHidden()
        }

    private class Read(val state: AppLockState, val isLocked: Boolean)

    private fun take(read: Read?, asked: Int, announce: Boolean) {
        if (read == null) {
            // Unknown at the start counts as locked: nothing shows, and the lock screen offers to try again.
            if (known == null) readFailed = true
            publish()
            return
        }
        readFailed = false
        val before = known
        known = read.state
        // A read that started before a lock or an unlock of this thread says nothing about the keys in memory now.
        if (asked == generation) locked = read.isLocked
        if (announce && before == AppLockState.ON && read.state == AppLockState.OFF) notice = AppLockNotice.TURNED_OFF
        if (announce && read.state == AppLockState.RESET && !resetAnnounced) {
            resetAnnounced = true
            notice = AppLockNotice.RESET
        }
        publish()
        if (before != read.state) applyFlagsToAll()
    }

    private fun publish() {
        val next = when {
            known == null -> if (readFailed) AppGate.LOCKED else AppGate.CHECKING
            known == AppLockState.ON && locked -> AppGate.LOCKED
            else -> AppGate.OPEN
        }
        gateNow = next
        gateFlow.value = next
    }

    /** Drops the file keys at once. With the app lock on, the gate shows the lock screen. */
    private fun lockNow() {
        // With the app lock off this is what the design asks when the screen turns off: the keys load again without a prompt.
        crypto.appLock.lock()
        generation++
        locked = true
        if (known == AppLockState.ON) locks++
        publish()
    }

    /** The last started screen of the app stopped: the app left the screen. */
    private fun left() {
        if (known == AppLockState.ON && settings.lockAfter != LockAfter.LEAVING && power.isInteractive) {
            leftAt = elapsed()
        } else {
            // The app lock is off, or it locks on leaving, or the phone's screen turned off with the app on it.
            lockNow()
        }
    }

    /** The first screen of the app starts again, before Android draws it. */
    private fun cameBack() {
        if (changingConfigurations) {
            changingConfigurations = false
            return
        }
        val left = leftAt ?: return
        leftAt = null
        if (known == AppLockState.ON && elapsed() - left >= settings.lockAfter.millis) lockNow()
    }

    private fun applyFlags(activity: Activity) {
        // The recovery key screens block everything themselves (secureWindow).
        if (activity is WordsScreen) return
        val block = settings.blockScreenshots
        if (block) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        // While the app lock is on, Android keeps no picture of the app. It would show it in the recent apps and on the way back.
        activity.setRecentsScreenshotEnabled(!block && known != null && known != AppLockState.ON)
    }

    private fun applyFlagsToAll() = activities.forEach(::applyFlags)

    private val callbacks = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityPreCreated(activity: Activity, savedInstanceState: Bundle?) {
            activities += activity
            applyFlags(activity)
        }

        override fun onActivityPreStarted(activity: Activity) {
            if (startedActivities++ == 0) cameBack()
        }

        override fun onActivityStarted(activity: Activity) = refresh()

        override fun onActivityStopped(activity: Activity) {
            if (--startedActivities > 0) return
            if (activity.isChangingConfigurations) changingConfigurations = true else left()
        }

        override fun onActivityDestroyed(activity: Activity) {
            activities -= activity
        }

        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

        override fun onActivityResumed(activity: Activity) = Unit

        override fun onActivityPaused(activity: Activity) = Unit

        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    }

    private val screenOff = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_SCREEN_OFF && !power.isInteractive) lockNow()
        }
    }
}

/** A screen of this module that shows or takes the recovery words and blocks everything itself with [secureWindow]. */
internal interface WordsScreen
