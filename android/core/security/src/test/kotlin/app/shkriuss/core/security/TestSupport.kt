package app.shkriuss.core.security

import android.app.Application
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import java.io.File
import java.util.concurrent.Executor
import kotlinx.coroutines.Dispatchers

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
