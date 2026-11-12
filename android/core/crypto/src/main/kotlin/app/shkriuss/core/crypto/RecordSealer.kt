package app.shkriuss.core.crypto

/**
 * Seals the records that leave the database for sync, and opens the ones
 * that arrive (kind 1 in crypto-design.md). Each record is one sealed
 * blob, 50 bytes longer than the record.
 *
 * It works while the app is locked and while the phone is locked, so that
 * sync and reminders go on.
 */
class RecordSealer internal constructor(private val vault: KeyVault) {
    /**
     * Seals [plaintext] for the record [recordId], with the key of the
     * current recovery key. Throws [BlobException] if the app has no keys
     * from a recovery key yet.
     */
    fun seal(recordId: String, plaintext: ByteArray): ByteArray {
        val associatedData = AssociatedData.forId(BlobKind.SEALED_RECORD, recordId)
        return SealedBlobs.seal(BlobKind.SEALED_RECORD, vault.recordKeyset(), associatedData, plaintext)
    }

    /**
     * Opens a sealed record. [recordId] is the ID that came with the blob:
     * if the sender lied about it, the blob does not open. Throws
     * [BlobException] with the answer.
     */
    fun open(recordId: String, blob: ByteArray): ByteArray {
        val associatedData = AssociatedData.forId(BlobKind.SEALED_RECORD, recordId)
        return SealedBlobs.open(BlobKind.SEALED_RECORD, vault.recordKeyset(), associatedData, blob)
    }
}
