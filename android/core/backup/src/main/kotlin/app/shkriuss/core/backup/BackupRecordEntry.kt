package app.shkriuss.core.backup

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream

/**
 * The Record entry of a backup as bytes of their own, from its tag `02` to
 * the end of its content (docs/architecture/backup-format.md, "Record").
 * The plaintext of a sealed record of sync holds this entry
 * (docs/architecture/sync-protocol.md, "The sealed record"), so a backup
 * and sync share one encoding of a record.
 */
object BackupRecordEntry {
    /**
     * The entry of [record], with its tag. A record that the format does
     * not allow, such as a type name with other letters or an ID that is
     * not a UUID, is a mistake of the calling code.
     */
    fun encode(record: BackupRecord): ByteArray {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { RecordEntry.write(it, record) }
        return bytes.toByteArray()
    }

    /**
     * Reads the entry that starts at [offset] of [bytes], from its tag on.
     * Returns the record and the offset just after the entry, or null if
     * the bytes there are not one whole entry of the format.
     */
    fun decode(bytes: ByteArray, offset: Int): Decoded? {
        if (offset !in 0..bytes.size) return null
        val stream = ByteArrayInputStream(bytes, offset, bytes.size - offset)
        val input = BodyInput(stream)
        return try {
            if (input.tag() != BackupFormat.TAG_RECORD) return null
            val record = RecordEntry.read(input)
            Decoded(record, bytes.size - stream.available())
        } catch (_: BackupRefused) {
            null
        }
    }

    /** One entry that [decode] read: the [record], and [end], the offset just after it. */
    class Decoded(val record: BackupRecord, val end: Int)
}
