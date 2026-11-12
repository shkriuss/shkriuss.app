package app.shkriuss.core.crypto

/** Hexadecimal text to bytes. Spaces and line breaks are ignored, so vectors can be pasted as they are. */
internal fun hex(text: String): ByteArray {
    val digits = text.filterNot { it.isWhitespace() }
    require(digits.length % 2 == 0) { "odd number of hex digits" }
    return ByteArray(digits.length / 2) { index -> digits.substring(2 * index, 2 * index + 2).toInt(16).toByte() }
}

/** Bytes to lower-case hexadecimal text. */
internal fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
