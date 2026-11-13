package app.shkriuss.core.security

import android.app.Application
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import java.io.File
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

/** The app class of the screen tests: a [SecurityHost] with real cryptography on the stand-in. */
class TestHostApp : Application(), SecurityHost {
    /** The stand-in app, so that a test can change the phone. */
    val keys: SoftwareKeysApp by lazy { softwareApp(File(filesDir, "shk-keys")) }

    override val crypto: ShkCrypto get() = keys.crypto
}
