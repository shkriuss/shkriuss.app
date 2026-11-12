package app.shkriuss.core.crypto

import android.content.Context
import java.io.File

/**
 * The way into `core/crypto` for one app. An app builds one, at start,
 * and passes its parts to the code that needs them. All cryptography of
 * the suite is behind this class (crypto-design.md).
 */
class ShkCrypto internal constructor(private val vault: KeyVault) {
    /** Seals and opens records for sync. */
    val records: RecordSealer = RecordSealer(vault)

    /** Makes, seals and opens file keys. */
    val files: FileCrypto = FileCrypto(vault)

    /** Encrypts and decrypts backup streams. */
    val backups: BackupCrypto = BackupCrypto(vault)

    /** Creating, entering, keeping and showing the recovery key. */
    val setup: KeySetup = KeySetup(vault)

    /** The optional app lock. */
    val appLock: AppLock = AppLock(vault)

    /**
     * Call once when the app starts, before anything else here. It removes
     * what a stopped change left behind, deletes hardware keys that no
     * keyset names, and after an update to Android 15 moves keysets under
     * the new Unlocked key. It never fails because a key is not usable
     * now: what could not be done waits for a later start.
     */
    fun start() = vault.start()

    /**
     * Call when the screen turns off. Every keyset but `record` is dropped
     * from memory. What is being read or written at that moment may
     * finish.
     */
    fun onScreenOff() = vault.forgetFileKeys()

    /** What the security screen shows. */
    fun status(): KeyStatus = vault.locked {
        val named = KeysetName.entries.mapNotNull { vault.namedKeyOrNull(it) }.distinct()
        KeyStatus(
            hasDerivedKeys = vault.isStored(KeysetName.RECORD),
            keyId = (vault.look(KeysetName.RECORD) as? Stored.Open)?.let { KeysetCodec.primaryId(it.keyset) },
            keepsRecoveryKey = vault.look(KeysetName.RECOVERY) is Stored.NeedsPrompt,
            appLock = appLock.state(),
            hasScreenLock = vault.hardware.hasScreenLock(),
            fileKeyMoveIsPending = vault.isStored(KeysetName.FILE_KEY_OLD),
            hardwareKeys = named.sortedWith(compareBy({ it.kind }, { it.number })).mapNotNull { key ->
                try {
                    HardwareKeyStatus(key.kind, vault.hardware.securityLevel(key))
                } catch (_: HardwareKeyFailure) {
                    null
                }
            },
        )
    }

    companion object {
        /** The folder of the keyset files, inside the app's no-backup files folder. */
        private const val FOLDER = "shk-keys"

        /**
         * The cryptography of the app [appName], with its hardware keys in
         * the Android Keystore and its keyset files in the app's no-backup
         * files folder.
         */
        fun create(context: Context, appName: AppName): ShkCrypto {
            val application = context.applicationContext
            val files = KeysetFiles(File(application.noBackupFilesDir, FOLDER))
            return ShkCrypto(KeyVault(appName, files, AndroidHardwareKeys(application)))
        }
    }
}
