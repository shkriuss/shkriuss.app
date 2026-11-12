package app.shkriuss.core.backup

/**
 * Record and file IDs as they stand in a backup: the 16 bytes of the UUID,
 * in the order of its 32 hex digits. Outside a backup an ID is text in the
 * 36-character form.
 */
internal object BackupIds {
    const val BYTES = 16

    private val FORM = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
    private const val HEX = "0123456789abcdef"

    /** Where the four hyphens stand, counted in hex digits. */
    private val HYPHEN_BEFORE = setOf(8, 12, 16, 20)

    /** The 16 bytes of [id]. Only the 36-character form is taken. Any other text is a mistake of the calling code. */
    fun toBytes(id: String): ByteArray {
        require(FORM.matches(id)) { "An ID must be a UUID in its 36-character form" }
        val digits = id.replace("-", "")
        return ByteArray(BYTES) { digits.substring(2 * it, 2 * it + 2).toInt(16).toByte() }
    }

    /** The 36-character form of 16 bytes, in lower case. */
    fun toText(bytes: ByteArray): String {
        require(bytes.size == BYTES) { "An ID is 16 bytes" }
        return buildString {
            bytes.forEachIndexed { index, byte ->
                if (2 * index in HYPHEN_BEFORE) append('-')
                append(HEX[(byte.toInt() ushr 4) and 0x0f])
                append(HEX[byte.toInt() and 0x0f])
            }
        }
    }
}
