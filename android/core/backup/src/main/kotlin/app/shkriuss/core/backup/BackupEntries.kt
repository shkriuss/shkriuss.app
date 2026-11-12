package app.shkriuss.core.backup

import app.shkriuss.core.data.RecordFields
import java.io.DataOutputStream
import java.io.InputStream
import java.nio.ByteBuffer

/**
 * Reads the fields of entries from the body of a backup. Numbers are
 * big-endian. A body that ends inside a field is damaged.
 */
internal class BodyInput(private val input: InputStream) {
    /** The next tag, or -1 where the body ends. */
    fun tag(): Int = input.read()

    fun byte(): Int = input.read().also { if (it < 0) damaged() }

    fun bytes(count: Int): ByteArray = input.readNBytes(count).also { if (it.size < count) damaged() }

    fun int(): Int = ByteBuffer.wrap(bytes(Int.SIZE_BYTES)).int

    fun long(): Long = ByteBuffer.wrap(bytes(Long.SIZE_BYTES)).long

    /** The next [length] bytes as a stream of their own. */
    fun stream(length: Long): BoundedInput = BoundedInput(input, length)
}

/** Stops the reading: the file breaks a rule of the format. */
internal fun damaged(): Nothing = throw BackupRefused(BackupAnswer.Damaged)

/**
 * The stream of one file inside the body: the next [length] bytes of
 * [source], and no more. If the body ends before them, the backup is
 * damaged.
 */
internal class BoundedInput(private val source: InputStream, val length: Long) : InputStream() {
    private var left = length

    override fun read(): Int {
        if (left == 0L) return -1
        val byte = source.read()
        if (byte < 0) damaged()
        left--
        return byte
    }

    override fun read(buffer: ByteArray, offset: Int, count: Int): Int {
        if (count == 0) return 0
        if (left == 0L) return -1
        val read = source.read(buffer, offset, minOf(count.toLong(), left).toInt())
        if (read < 0) damaged()
        left -= read
        return read
    }

    /** Reads on to the end of the file, for a reader that did not want all of it. */
    fun skipRest() {
        val buffer = ByteArray(BackupFormat.COPY_BUFFER)
        do {
            val read = read(buffer, 0, buffer.size)
        } while (read >= 0)
    }
}

/** The Record entry of the body: how one [BackupRecord] is written and read. */
internal object RecordEntry {
    /**
     * Writes the entry of [record], with its tag. A record that the format
     * does not allow is a mistake of the calling code.
     */
    fun write(out: DataOutputStream, record: BackupRecord) {
        require(BackupFormat.isTypeName(record.type)) {
            "A type name holds the letters a to z, the digits and _, and at most 64 characters"
        }
        require(record.content.size <= BackupFormat.LARGEST_CONTENT) { "The content of a record is at most 16 MiB" }
        val id = BackupIds.toBytes(record.fields.id)

        out.writeByte(BackupFormat.TAG_RECORD)
        out.writeByte(record.type.length)
        out.write(record.type.toByteArray(Charsets.US_ASCII))
        out.write(id)
        out.writeLong(record.fields.createdAt)
        out.writeLong(record.fields.updatedAt)
        val deletedAt = record.fields.deletedAt
        if (deletedAt == null) {
            out.writeByte(BackupFormat.NOT_DELETED)
        } else {
            out.writeByte(BackupFormat.DELETED)
            out.writeLong(deletedAt)
        }
        out.writeInt(record.content.size)
        out.write(record.content)
    }

    /** Reads the fields that follow the tag of a Record entry. */
    fun read(input: BodyInput): BackupRecord {
        val nameLength = input.byte()
        if (nameLength !in 1..BackupFormat.LONGEST_TYPE_NAME) damaged()
        val type = String(input.bytes(nameLength), Charsets.US_ASCII)
        if (!BackupFormat.isTypeName(type)) damaged()

        val id = BackupIds.toText(input.bytes(BackupIds.BYTES))
        val createdAt = input.long()
        val updatedAt = input.long()
        val deletedAt = when (input.byte()) {
            BackupFormat.NOT_DELETED -> null
            BackupFormat.DELETED -> input.long()
            else -> damaged()
        }

        val contentLength = input.int()
        if (contentLength !in 0..BackupFormat.LARGEST_CONTENT) damaged()
        return BackupRecord(type, RecordFields(id, createdAt, updatedAt, deletedAt), input.bytes(contentLength))
    }
}
