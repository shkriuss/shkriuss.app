package app.shkriuss.core.crypto

/**
 * The associated data of each kind of blob: the blob's own bytes before
 * the ciphertext part, then the context ("Associated data" in
 * crypto-design.md). A blob opens only with the bytes it was made with.
 */
internal object AssociatedData {
    private const val ID_LENGTH = 36
    private val HYPHENS = setOf(8, 13, 18, 23)

    /** For kinds 1, 2 and 4: the header, then the 16 bytes of the record or file ID. */
    fun forId(kind: BlobKind, id: String): ByteArray = Header.of(kind) + idBytes(id)

    /** For kind 3: the header, then the whole backup header as it is. */
    fun forBackup(backupHeader: ByteArray): ByteArray = Header.of(BlobKind.BACKUP_STREAM) + backupHeader

    /** For kind 5: the ten bytes that name the hardware key, then the keyset name. */
    fun forKeyset(key: HardwareKeyRef, name: KeysetName): ByteArray =
        WrappedKeyset.prefix(key) + name.text.toByteArray(Charsets.US_ASCII)

    /**
     * The 16 bytes of a UUID in the order of its 32 hex digits. Only the
     * 36-character form is taken, with hex digits in either case. Throws
     * [IllegalArgumentException] for anything else: an ID that is not a
     * UUID is a mistake in the calling code, not a damaged blob.
     */
    fun idBytes(id: String): ByteArray {
        require(id.length == ID_LENGTH) { "An ID is a UUID of 36 characters" }
        val digits = StringBuilder(32)
        id.forEachIndexed { index, char ->
            if (index in HYPHENS) {
                require(char == '-') { "An ID is a UUID of 36 characters" }
            } else {
                require(Character.digit(char, 16) >= 0) { "An ID is a UUID of 36 characters" }
                digits.append(char)
            }
        }
        return ByteArray(16) { digits.substring(2 * it, 2 * it + 2).toInt(16).toByte() }
    }
}
