package app.shkriuss.core.crypto

import app.shkriuss.core.testing.TestDevice
import java.io.File

/**
 * The test APK as an app of the suite on the emulator: its hardware keys
 * in the real Android Keystore and its keyset files in its own no-backup
 * files folder, exactly where [ShkCrypto.create] puts them.
 */
internal class DeviceApp {
    private val context = TestDevice.context

    /** The class under test: the hardware keys in the Android Keystore. */
    val hardware = AndroidHardwareKeys(context)

    /** The folder of the keyset files. */
    val folder = File(context.noBackupFilesDir, "shk-keys")

    /** Starts the app. A new call is the app started again, with nothing in memory. */
    fun open(): ShkCrypto = ShkCrypto.create(context, TestKeys.water).also { it.start() }

    /** The app as it would run on the Android version [androidVersion], on this emulator. */
    fun openAsOn(androidVersion: Int): ShkCrypto =
        ShkCrypto(KeyVault(TestKeys.water, KeysetFiles(folder), AndroidHardwareKeys(context, androidVersion)))
            .also { it.start() }

    /** The hardware key the stored keyset names, or null if there is no file. */
    fun keyOf(name: KeysetName): HardwareKeyRef? = KeysetFiles(folder).read(name)?.let { WrappedKeyset.keyOf(it, name) }

    /** The file of a keyset. */
    fun fileOf(name: KeysetName): File = File(folder, name.text)

    /** The aliases of this app's hardware keys of one kind. */
    fun aliasesOf(kind: HardwareKeyKind): Set<String> =
        hardware.aliases().filter { HardwareKeyRef.ofAlias(it)?.kind == kind }.toSet()

    /**
     * Leaves the emulator as a test expects to find it: no screen lock, no
     * hardware key and no keyset file. Every test calls it before and
     * after.
     */
    fun reset() {
        ScreenLock.reset()
        hardware.aliases().mapNotNull { HardwareKeyRef.ofAlias(it) }.forEach { hardware.delete(it) }
        folder.deleteRecursively()
    }
}
