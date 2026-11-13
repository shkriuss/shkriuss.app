package app.shkriuss.core.security

import android.Manifest
import android.app.Activity
import android.app.Application
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import java.io.File
import java.util.concurrent.Executor
import kotlinx.coroutines.Dispatchers
import org.robolectric.Shadows.shadowOf

/** The app name of the tests. Keys are derived for it as for Water. */
internal val testAppName: AppName = AppName.of("water")

/** Work runs at once, on the test's thread, so a test sees each state right after each call. */
internal val inline = Dispatchers.Unconfined

/** An app with real cryptography on the stand-in for the Keystore, with its keyset files in [folder]. */
internal fun softwareApp(folder: File): SoftwareKeysApp = SoftwareKeysApp(folder, testAppName)

/** Changes the last byte of a keyset file, part of its tag: the Keystore refuses it. */
internal fun damage(file: File) {
    file.writeBytes(file.readBytes().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() })
}

/** Runs each piece of work at once, on the test's thread. */
internal val atOnce = Executor { it.run() }

/** The app class of the screen tests: a [SecurityHost] with real cryptography on the stand-in. */
open class TestHostApp : Application(), SecurityHost {
    /** The stand-in app, so that a test can change the phone. */
    val keys: SoftwareKeysApp by lazy { softwareApp(File(filesDir, "shk-keys")) }

    override val crypto: ShkCrypto get() = keys.crypto

    /** The clock the user cannot change, in milliseconds. A test moves it. */
    var now = 0L

    /** How often the watcher said that notifications must hide their text from now on. */
    var textHidden = 0

    override val appLock: AppLockWatcher by lazy {
        AppLockWatcher(this, crypto, onTextHidden = { textHidden++ }, elapsed = { now }, background = atOnce, main = atOnce)
    }

    override fun onCreate() {
        super.onCreate()
        startWatcher()
    }

    /** Starts the watcher, as every app class does in `onCreate`. */
    protected open fun startWatcher() = appLock.start()
}

/** An app class that forgot to start its watcher. */
class ForgetfulHostApp : TestHostApp() {
    override fun startWatcher() = Unit
}

/** Gives the app `HIDE_OVERLAY_WINDOWS`, as Android does at install, or takes it away, as an app's manifest could. */
internal fun Application.allowHidingOtherAppsWindows(allowed: Boolean) {
    val app = shadowOf(this)
    if (allowed) {
        app.grantPermissions(Manifest.permission.HIDE_OVERLAY_WINDOWS)
    } else {
        app.denyPermissions(Manifest.permission.HIDE_OVERLAY_WINDOWS)
    }
}

/**
 * True if Android hides other apps' windows while this window shows. The
 * flag that `Window.setHideOverlayWindows` sets is not public, so the test
 * reads it by reflection.
 */
internal fun Activity.hidesOtherAppsWindows(): Boolean {
    val params = WindowManager.LayoutParams::class.java
    val flags = params.getField("privateFlags").getInt(window.attributes)
    val hide = params.getField("SYSTEM_FLAG_HIDE_NON_SYSTEM_OVERLAY_WINDOWS").getInt(null)
    return flags and hide != 0
}

/**
 * True if the window whose root view this is ignores covered taps, and
 * every view in it, Compose's own view too, speaks only to accessibility
 * tools (`shieldWindow`).
 */
internal fun View.isShielded(): Boolean = filterTouchesWhenObscured && everyView().all { it.isAccessibilityDataSensitive }

/** True if the window whose root view this is ignores no tap and speaks to every accessibility service. */
internal fun View.isNotShielded(): Boolean = !filterTouchesWhenObscured && everyView().none { it.isAccessibilityDataSensitive }

private fun View.everyView(): List<View> =
    listOf(this) + if (this is ViewGroup) (0 until childCount).flatMap { getChildAt(it).everyView() } else emptyList()
