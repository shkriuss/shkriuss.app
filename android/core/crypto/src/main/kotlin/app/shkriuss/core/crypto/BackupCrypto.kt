package app.shkriuss.core.crypto

import java.io.InputStream
import java.io.OutputStream

/**
 * Encrypts and decrypts the stream of a backup file (kind 3 in
 * crypto-design.md). The backup header is not secret. It is given here
 * byte for byte and is checked together with the stream: a stream opens
 * only under the header it was made with.
 *
 * The `backup` keyset is loaded for one backup or restore and is not kept.
 */
class BackupCrypto internal constructor(private val vault: KeyVault) {
    /** The key ID to write into a new backup's header. */
    fun keyId(): KeyId = KeysetCodec.primaryId(vault.backupKeyset())

    /**
     * Whether this app can open a backup whose header names [keyId]. If
     * not, the backup was made with another recovery key, and the app can
     * say so before it tries to decrypt.
     */
    fun hasKey(keyId: KeyId): Boolean = keyId in KeysetCodec.keyIds(vault.backupKeyset())

    /**
     * True if a backup may be made now: the app has its keys from a
     * recovery key, and no file key is still sealed by a key that exists
     * only on this phone.
     */
    fun mayMakeBackup(): Boolean = vault.locked { vault.mayShareFileKeys() }

    /**
     * Returns the stream that encrypts a backup into [output]. Close it to
     * finish the backup. Throws [IllegalStateException] unless
     * [mayMakeBackup].
     */
    fun encryptingStream(backupHeader: ByteArray, output: OutputStream): OutputStream {
        check(mayMakeBackup()) { "A backup cannot be made yet" }
        val associatedData = AssociatedData.forBackup(backupHeader)
        return Streams.encrypting(BlobKind.BACKUP_STREAM, vault.backupKeyset(), associatedData, output)
    }

    /**
     * Returns the stream that decrypts a backup from [input]. A read
     * throws [BlobException] where the backup is damaged or cut. A restore
     * changes nothing in the app until the stream has ended without an
     * error.
     */
    fun decryptingStream(backupHeader: ByteArray, input: InputStream): InputStream {
        val associatedData = AssociatedData.forBackup(backupHeader)
        return Streams.decrypting(BlobKind.BACKUP_STREAM, vault.backupKeyset(), associatedData, input)
    }
}
