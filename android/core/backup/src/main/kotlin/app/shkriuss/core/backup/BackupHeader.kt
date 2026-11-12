package app.shkriuss.core.backup

import app.shkriuss.core.crypto.KeyId
import java.io.InputStream

/**
 * The public bytes at the start of a backup file: the letters `SHKBAK`,
 * the format version, the key ID and the app name. It holds only what a
 * reader needs before it can decrypt.
 *
 * [bytes] is the header exactly as it stands in the file. It is given to
 * `core/crypto` as the context of the encrypted stream, so a stream opens
 * only under the header it was made with.
 */
internal class BackupHeader private constructor(val keyId: KeyId, val appName: String, val bytes: ByteArray) {
    companion object {
        /** The header of a new backup of the app [appName], encrypted under the recovery key [keyId] names. */
        fun of(keyId: KeyId, appName: String): BackupHeader {
            require(BackupFormat.isAppName(appName)) { "The app name does not fit into a backup header" }
            val bytes = BackupFormat.MAGIC +
                BackupFormat.VERSION.toByte() +
                keyId.toBytes() +
                appName.length.toByte() +
                appName.toByteArray(Charsets.US_ASCII)
            return BackupHeader(keyId, appName, bytes)
        }

        /**
         * Reads the header at the start of [input]. Throws [BackupRefused]
         * with the answer of the first rule that does not hold. A read
         * that fails stays the failure it was.
         */
        fun read(input: InputStream): BackupHeader {
            val magic = input.readNBytes(BackupFormat.MAGIC.size)
            if (!magic.contentEquals(BackupFormat.MAGIC)) throw BackupRefused(BackupAnswer.NotABackup)

            val version = input.read()
            if (version <= 0) throw BackupRefused(BackupAnswer.Damaged)
            if (version > BackupFormat.VERSION) throw BackupRefused(BackupAnswer.NewerVersion)

            val keyId = input.readNBytes(BackupFormat.KEY_ID_BYTES)
            if (keyId.size < BackupFormat.KEY_ID_BYTES) throw BackupRefused(BackupAnswer.Damaged)

            val length = input.read()
            if (length !in 1..BackupFormat.LONGEST_APP_NAME) throw BackupRefused(BackupAnswer.Damaged)
            val name = input.readNBytes(length)
            if (name.size < length) throw BackupRefused(BackupAnswer.Damaged)
            val appName = String(name, Charsets.US_ASCII)
            if (!BackupFormat.isAppName(appName)) throw BackupRefused(BackupAnswer.Damaged)

            val bytes = magic + version.toByte() + keyId + length.toByte() + name
            return BackupHeader(keyIdOf(keyId), appName, bytes)
        }

        private fun keyIdOf(bytes: ByteArray): KeyId =
            KeyId(bytes.fold(0) { number, byte -> (number shl 8) or (byte.toInt() and 0xff) })
    }
}
