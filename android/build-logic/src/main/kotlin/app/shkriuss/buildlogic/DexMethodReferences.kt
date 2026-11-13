package app.shkriuss.buildlogic

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Reads the table of method references of a dex file: every method the
 * file's code calls, and every method it defines. Rule 9 of
 * [CheckApkRulesTask] needs no more. A method that code calls is always in
 * this table, so the table decides pass or fail. Which class makes the call
 * would need every method's instructions, which this reader leaves out on
 * purpose (owner's decision in step 1.9).
 *
 * It follows the dex format (source.android.com, "Dalvik executable
 * format") and needs no library. It reads the header, the string IDs, the
 * type IDs and the method IDs, nothing else. A file it does not understand
 * throws, and the check reports that as a failure.
 */
internal object DexMethodReferences {
    /** A method reference: the descriptor of the class that declares it, such as `Ljava/lang/Runtime;`, and its name. */
    data class MethodReference(val owner: String, val name: String)

    /** Dex versions this reader knows. Version 041 holds several dex files in one container and is not read. */
    private val KNOWN_VERSIONS = setOf("035", "037", "038", "039", "040")

    private const val HEADER_SIZE = 0x70
    private const val STRING_IDS = 0x38
    private const val TYPE_IDS = 0x40
    private const val METHOD_IDS = 0x58
    private const val METHOD_ID_SIZE = 8

    /** Every method reference in [dex], the bytes of one dex file. */
    fun read(dex: ByteArray): List<MethodReference> {
        require(dex.size >= HEADER_SIZE) { "too short for a dex file" }
        val magic = String(dex, 0, 8, Charsets.US_ASCII)
        require(magic.startsWith("dex\n") && magic.endsWith("\u0000")) { "not a dex file" }
        val version = magic.substring(4, 7)
        require(version in KNOWN_VERSIONS) { "dex version $version is not one this check can read" }
        val buffer = ByteBuffer.wrap(dex).order(ByteOrder.LITTLE_ENDIAN)
        val strings = Table(buffer, STRING_IDS, 4)
        val types = Table(buffer, TYPE_IDS, 4)
        val methods = Table(buffer, METHOD_IDS, METHOD_ID_SIZE)
        val decoded = HashMap<Int, String>()
        fun string(index: Int): String = decoded.getOrPut(index) { buffer.stringData(buffer.getInt(strings.at(index))) }
        return List(methods.size) { index ->
            val at = methods.at(index)
            val owner = string(buffer.getInt(types.at(buffer.getShort(at).toInt() and 0xffff)))
            MethodReference(owner, string(buffer.getInt(at + 4)))
        }
    }

    /** One table of fixed-size items, from its size and offset in the header. */
    private class Table(buffer: ByteBuffer, headerField: Int, private val itemSize: Int) {
        val size = buffer.getInt(headerField)
        private val offset = buffer.getInt(headerField + 4)
        private val limit = buffer.limit()

        init {
            require(size >= 0 && offset >= 0 && offset.toLong() + size.toLong() * itemSize <= limit) {
                "a table in the dex header lies outside the file"
            }
        }

        fun at(index: Int): Int {
            require(index in 0 until size) { "index $index is not in a table of $size" }
            return offset + index * itemSize
        }
    }

    /** A string: its length in UTF-16 units as ULEB128, then MUTF-8 bytes up to a zero byte. */
    private fun ByteBuffer.stringData(offset: Int): String {
        var position = offset
        while (get(position).toInt() and 0x80 != 0) position++
        position++
        val start = position
        while (get(position).toInt() != 0) position++
        return String(ByteArray(position - start) { get(start + it) }, Charsets.UTF_8)
    }
}
