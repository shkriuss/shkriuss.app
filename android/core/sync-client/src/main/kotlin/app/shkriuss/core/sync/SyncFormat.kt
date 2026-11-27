package app.shkriuss.core.sync

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.util.UUID

/**
 * The numbers of the sync format that a data app uses
 * (docs/architecture/sync-protocol.md). Every value here is part of the
 * format: changing one is a format change.
 */
object SyncFormat {
    /** The version of the courier interface this code speaks. */
    const val COURIER_VERSION: Int = 1

    /** The version of the plaintext of a sealed record, with its order for ties. */
    const val PLAINTEXT_VERSION: Int = 1

    /** The most records in one batch or page. */
    const val MOST_RECORDS: Int = 100

    /** The smallest sealed record: a blob of kind 1 is 50 bytes longer than its plaintext. */
    const val SMALLEST_SEALED: Int = 50

    /** The largest sealed record. */
    const val LARGEST_SEALED: Int = 524_288

    /** How much longer a sealed record is than its plaintext. */
    const val SEALED_OVERHEAD: Int = 50

    /**
     * The most bytes of blobs in one page: the largest byte limit that
     * `info` may name, which is also the largest sealed record. A page
     * holds one record alone, or records up to the limit.
     */
    const val MOST_PAGE_BYTES: Int = 524_288

    /** The ASCII letters `SHKSYNC`, the first bytes of a batch, a status and a list of streams. */
    internal val MAGIC = "SHKSYNC".toByteArray(Charsets.US_ASCII)

    /** The version of the layouts that start with [MAGIC]. */
    internal const val LAYOUT_VERSION = 1

    internal const val TYPE_BATCH = 0x20
    internal const val TYPE_STATUS = 0x21
    internal const val TYPE_STREAMS = 0x22

    /** Bytes 6 to 9 of a sealed record name its key ID. */
    internal const val KEY_ID_OFFSET = 6

    internal const val ID_BYTES = 16
    internal const val HASH_BYTES = 32
}

/**
 * Sixteen random bytes that name a server, an epoch or a device. They are
 * public: the server and every device of the account know them.
 */
class SyncId(bytes: ByteArray) {
    private val bytes: ByteArray = bytes.copyOf()

    init {
        require(bytes.size == SyncFormat.ID_BYTES) { "A sync ID is 16 bytes" }
    }

    /** The 16 bytes. */
    fun toBytes(): ByteArray = bytes.copyOf()

    /** The 32 lower-case hex digits. */
    val hex: String get() = Hex.of(bytes)

    override fun equals(other: Any?): Boolean = other is SyncId && other.bytes.contentEquals(bytes)

    override fun hashCode(): Int = bytes.contentHashCode()

    override fun toString(): String = "SyncId($hex)"

    /** Reads a sync ID from its hex form. */
    companion object {
        /** The sync ID of 32 hex digits, or null if [hex] is not one. */
        fun ofHex(hex: String): SyncId? = Hex.parse(hex)?.takeIf { it.size == SyncFormat.ID_BYTES }?.let(::SyncId)
    }
}

/** Hex digits, lower case, as the protocol writes them. */
internal object Hex {
    private const val DIGITS = "0123456789abcdef"

    fun of(bytes: ByteArray): String = buildString(bytes.size * 2) {
        bytes.forEach {
            append(DIGITS[(it.toInt() ushr 4) and 0x0f])
            append(DIGITS[it.toInt() and 0x0f])
        }
    }

    fun parse(text: String): ByteArray? {
        if (text.length % 2 != 0 || text.any { it !in DIGITS }) return null
        return ByteArray(text.length / 2) { text.substring(2 * it, 2 * it + 2).toInt(16).toByte() }
    }
}

/** Record IDs as they travel: the 16 bytes of the UUID, in the order of its hex digits. */
internal object RecordIds {
    fun toBytes(id: String): ByteArray {
        val uuid = UUID.fromString(id)
        return ByteArray(SyncFormat.ID_BYTES) { index ->
            val half = if (index < 8) uuid.mostSignificantBits else uuid.leastSignificantBits
            (half ushr (56 - 8 * (index % 8))).toByte()
        }
    }

    fun toText(bytes: ByteArray): String {
        require(bytes.size == SyncFormat.ID_BYTES) { "An ID is 16 bytes" }
        var most = 0L
        var least = 0L
        for (index in 0 until 8) most = (most shl 8) or (bytes[index].toLong() and 0xff)
        for (index in 8 until 16) least = (least shl 8) or (bytes[index].toLong() and 0xff)
        return UUID(most, least).toString()
    }
}

/** Thrown by [ByteReader] where bytes end early or break a layout. */
internal class LayoutException : Exception("The bytes do not have the layout")

/** Reads big-endian numbers and runs of bytes from [bytes], from [position] on. */
internal class ByteReader(private val bytes: ByteArray, var position: Int = 0) {
    val remaining: Int get() = bytes.size - position

    fun u8(): Int {
        need(1)
        return bytes[position++].toInt() and 0xff
    }

    /** Four bytes as an unsigned number. */
    fun u32(): Long {
        need(4)
        var value = 0L
        repeat(4) { value = (value shl 8) or (bytes[position++].toLong() and 0xff) }
        return value
    }

    /** Four bytes as a signed number. */
    fun i32(): Int = u32().toInt()

    fun i64(): Long {
        need(8)
        var value = 0L
        repeat(8) { value = (value shl 8) or (bytes[position++].toLong() and 0xff) }
        return value
    }

    fun bytes(count: Int): ByteArray {
        need(count)
        return bytes.copyOfRange(position, position + count).also { position += count }
    }

    fun expect(expected: ByteArray) {
        if (!bytes(expected.size).contentEquals(expected)) throw LayoutException()
    }

    fun end() {
        if (remaining != 0) throw LayoutException()
    }

    private fun need(count: Int) {
        if (count < 0 || remaining < count) throw LayoutException()
    }
}

/** Writes big-endian numbers and runs of bytes. */
internal class ByteWriter {
    private val buffer = ByteArrayOutputStream()
    private val out = DataOutputStream(buffer)

    fun u8(value: Int) = apply { out.writeByte(value) }

    fun i32(value: Int) = apply { out.writeInt(value) }

    fun i64(value: Long) = apply { out.writeLong(value) }

    fun bytes(value: ByteArray) = apply { out.write(value) }

    fun toByteArray(): ByteArray {
        out.flush()
        return buffer.toByteArray()
    }
}

/** Writes the first nine bytes of a layout of the courier interface: `SHKSYNC`, the version and [type]. */
internal fun ByteWriter.header(type: Int): ByteWriter = bytes(SyncFormat.MAGIC).u8(SyncFormat.LAYOUT_VERSION).u8(type)

/** Compares two runs of bytes as unsigned numbers. If one is the start of the other, the longer is larger. */
internal fun compareUnsigned(first: ByteArray, second: ByteArray): Int {
    val common = minOf(first.size, second.size)
    for (index in 0 until common) {
        val order = (first[index].toInt() and 0xff) - (second[index].toInt() and 0xff)
        if (order != 0) return order
    }
    return first.size - second.size
}
