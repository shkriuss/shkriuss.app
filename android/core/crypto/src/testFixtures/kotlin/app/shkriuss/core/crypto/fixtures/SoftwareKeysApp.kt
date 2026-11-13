package app.shkriuss.core.crypto.fixtures

import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.KeyVault
import app.shkriuss.core.crypto.KeysetFiles
import app.shkriuss.core.crypto.ShkCrypto
import java.io.File

/**
 * One app with real cryptography, for the unit tests of other modules.
 *
 * Unit tests run on the JVM, where no Android Keystore exists. This class
 * builds a [ShkCrypto] whose hardware keys are [SoftwareHardwareKeys]:
 * ordinary keys in memory. Everything else is the real code, so a test of
 * another module encrypts and decrypts as an app does.
 *
 * It exists only for tests. It is in the test fixtures of `core/crypto`,
 * which are never part of an app (ADR 0029).
 *
 * The app has no keys until a test gives it a recovery key, for example
 * with `crypto.setup.storeDerivedKeys(crypto.setup.createRecoveryKey())`.
 */
class SoftwareKeysApp(folder: File, appName: AppName) {
    private val hardware = SoftwareHardwareKeys()

    /** The app's cryptography, with its keyset files in the folder given. It is started. */
    val crypto: ShkCrypto = ShkCrypto(KeyVault(appName, KeysetFiles(folder), hardware)).also { it.start() }

    /**
     * True for a locked phone. The keysets under the Unlocked key, `backup`
     * among them, then cannot be opened.
     */
    var phoneLocked: Boolean
        get() = hardware.phoneLocked
        set(value) {
            hardware.phoneLocked = value
        }

    /**
     * False for a phone with no screen lock: the recovery key cannot be
     * kept, and there is no app lock. Setting it to false also deletes the
     * keys that need the prompt, as Android does when the screen lock is
     * removed.
     */
    var screenLock: Boolean
        get() = hardware.screenLock
        set(value) {
            if (value) hardware.screenLock = true else hardware.removeScreenLock()
        }
}
