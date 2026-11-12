package app.shkriuss.core.crypto

/** The kinds of blob, with the kind byte of each ("Blob layouts" in crypto-design.md). */
internal enum class BlobKind(val byte: Byte) {
    SEALED_RECORD(1),
    FILE_STREAM(2),
    BACKUP_STREAM(3),
    WRAPPED_FILE_KEY(4),
    WRAPPED_KEYSET(5),
}

/**
 * The five bytes every blob starts with: `SHK`, the version of the kind's
 * layout, and the kind.
 */
internal object Header {
    /** The length of the header. */
    const val SIZE = 5

    /** The only layout version there is today, for every kind. */
    const val VERSION: Byte = 1

    private val MAGIC = byteArrayOf(0x53, 0x48, 0x4B)

    /** The header of a new blob of [kind]. */
    fun of(kind: BlobKind): ByteArray = MAGIC + VERSION + kind.byte

    /**
     * Checks that the first [length] bytes of [bytes] start a blob of
     * [expected] that this code can read. [length] is less than [SIZE] only
     * if the blob ends there.
     *
     * The order is magic, kind, version, because the version is the version
     * of that kind's layout. Throws [BlobException] with the answer.
     */
    fun check(bytes: ByteArray, length: Int, expected: BlobKind) {
        if (length < MAGIC.size || !MAGIC.indices.all { bytes[it] == MAGIC[it] }) {
            throw BlobException(BlobAnswer.NOT_ONE_OF_OURS)
        }
        if (length < SIZE) throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        if (bytes[4] != expected.byte) throw BlobException(BlobAnswer.WRONG_KIND)
        val version = bytes[3].toInt() and 0xff
        if (version > VERSION) throw BlobException(BlobAnswer.MADE_BY_A_NEWER_VERSION)
        if (version < VERSION) throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
    }
}
