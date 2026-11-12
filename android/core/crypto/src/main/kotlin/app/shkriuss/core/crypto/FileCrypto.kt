package app.shkriuss.core.crypto

import com.google.crypto.tink.KeysetHandle
import java.io.InputStream
import java.io.OutputStream

/**
 * The key of one file content. Every file content gets its own random
 * key, and the file is encrypted once (kind 2 in crypto-design.md). The
 * same bytes are stored on the phone, sent to the server and stored on
 * every other device.
 */
class FileKey internal constructor(internal val keyset: KeysetHandle) {
    /**
     * Returns the stream that encrypts the file [fileId] into [output].
     * Close it to finish the file: a stream that was not closed does not
     * open. The encrypted file is as long as the file plus 45 bytes, plus
     * 16 bytes for each megabyte or part of one.
     */
    fun encryptingStream(fileId: String, output: OutputStream): OutputStream {
        val associatedData = AssociatedData.forId(BlobKind.FILE_STREAM, fileId)
        return Streams.encrypting(BlobKind.FILE_STREAM, keyset, associatedData, output)
    }

    /**
     * Returns the stream that decrypts the file [fileId] from [input]. A
     * read throws [BlobException] at the first part that is damaged, cut
     * or swapped. The file counts as whole only when the stream has ended
     * without an error.
     */
    fun decryptingStream(fileId: String, input: InputStream): InputStream {
        val associatedData = AssociatedData.forId(BlobKind.FILE_STREAM, fileId)
        return Streams.decrypting(BlobKind.FILE_STREAM, keyset, associatedData, input)
    }

    /** Never shows the key. */
    override fun toString(): String = "FileKey"
}

/**
 * Makes file keys, and seals and opens them with the app's `file-key`
 * keyset (kind 4 in crypto-design.md). The sealed form is what the file's
 * database row holds. The same bytes travel in the file's sealed record
 * and in a backup: sync and backup never open a file key.
 *
 * With the app lock on, this works only between unlock and lock.
 */
class FileCrypto internal constructor(private val vault: KeyVault) {
    /** A new random key for one file content. New content, such as an edited file, gets a new key. */
    fun newFileKey(): FileKey = FileKey(KeysetCodec.newRandom(KeysetType.STREAMING))

    /**
     * Seals [fileKey] for the file [fileId]. An app with no recovery key
     * yet gets its own random `file-key` here, at the first file.
     */
    fun wrap(fileId: String, fileKey: FileKey): ByteArray {
        val keysets = vault.fileKeysets(create = true)
        val plain = KeysetCodec.serialize(fileKey.keyset)
        try {
            return SealedBlobs.seal(BlobKind.WRAPPED_FILE_KEY, keysets.current, associatedData(fileId), plain)
        } finally {
            plain.fill(0)
        }
    }

    /**
     * Opens a wrapped file key: with `file-key` first, then with
     * `file-key-old`. Throws [BlobException] with the answer.
     */
    fun unwrap(fileId: String, wrapped: ByteArray): FileKey {
        val keysets = vault.fileKeysets(create = false)
        val plain = open(keysets, fileId, wrapped)
        try {
            return FileKey(KeysetCodec.parse(plain, KeysetType.STREAMING, exactCount = 1))
        } finally {
            plain.fill(0)
        }
    }

    /**
     * True if [wrapped] names the key that seals file keys now. A row for
     * which this is false must be sealed again with [sealAgain].
     */
    fun isSealedByCurrentKey(wrapped: ByteArray): Boolean {
        val current = vault.fileKeysets(create = false).current
        return SealedBlobs.keyIdOf(BlobKind.WRAPPED_FILE_KEY, wrapped) == KeysetCodec.primaryId(current)
    }

    /**
     * Opens a wrapped file key and seals it again with the key that seals
     * file keys now. The file itself is not touched. This is for the move
     * from a random `file-key` to the derived one, row by row.
     */
    fun sealAgain(fileId: String, wrapped: ByteArray): ByteArray = wrap(fileId, unwrap(fileId, wrapped))

    private fun open(keysets: FileKeysets, fileId: String, wrapped: ByteArray): ByteArray {
        try {
            return SealedBlobs.open(BlobKind.WRAPPED_FILE_KEY, keysets.current, associatedData(fileId), wrapped)
        } catch (first: BlobException) {
            val old = keysets.old
            if (old == null || first.answer !in TRY_THE_OLD_KEYSET) throw first
            try {
                return SealedBlobs.open(BlobKind.WRAPPED_FILE_KEY, old, associatedData(fileId), wrapped)
            } catch (second: BlobException) {
                // "Damaged" says more than "needs another key": one keyset had the key.
                throw if (first.answer == BlobAnswer.DAMAGED_OR_CHANGED) first else second
            }
        }
    }

    private fun associatedData(fileId: String): ByteArray = AssociatedData.forId(BlobKind.WRAPPED_FILE_KEY, fileId)

    private companion object {
        val TRY_THE_OLD_KEYSET = setOf(BlobAnswer.NEEDS_ANOTHER_RECOVERY_KEY, BlobAnswer.DAMAGED_OR_CHANGED)
    }
}
