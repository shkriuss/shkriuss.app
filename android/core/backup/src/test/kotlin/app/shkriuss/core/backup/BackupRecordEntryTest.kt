package app.shkriuss.core.backup

import app.shkriuss.core.data.RecordFields
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The Record entry as bytes of its own, which sync seals: the same bytes
 * as in a backup, and a reader that refuses anything but one whole entry.
 */
class BackupRecordEntryTest {
    private val id = "00112233-4455-4677-8899-aabbccddeeff"

    @Test
    fun anEntryHasTheLayoutOfTheBackupFormat() {
        val record = BackupRecord("note", RecordFields(id, createdAt = 1, updatedAt = 2, deletedAt = null), byteArrayOf(7, 8))

        val expected = byteArrayOf(0x02, 4) + "note".toByteArray() + hex("00112233445546778899aabbccddeeff") +
            long(1) + long(2) + byteArrayOf(0) + byteArrayOf(0, 0, 0, 2) + byteArrayOf(7, 8)
        assertArrayEquals(expected, BackupRecordEntry.encode(record))
        assertEquals(39 + 4 + 2, expected.size)
    }

    @Test
    fun aDeletedRecordHasEightMoreBytes() {
        val record = BackupRecord("note", RecordFields(id, createdAt = 1, updatedAt = 3, deletedAt = 3), ByteArray(0))

        val bytes = BackupRecordEntry.encode(record)

        assertEquals(39 + 4 + 8, bytes.size)
        val decoded = BackupRecordEntry.decode(bytes, 0)!!
        assertEquals(record.fields, decoded.record.fields)
        assertEquals(bytes.size, decoded.end)
    }

    @Test
    fun anEntryIsReadAtAnOffsetAndTheEndIsWhereItStops() {
        val record = BackupRecord("tag_2", RecordFields(id, createdAt = 5, updatedAt = 6, deletedAt = null), "milk".toByteArray())
        val bytes = byteArrayOf(9, 9, 9) + BackupRecordEntry.encode(record) + byteArrayOf(1, 2)

        val decoded = BackupRecordEntry.decode(bytes, 3)!!

        assertEquals("tag_2", decoded.record.type)
        assertEquals(record.fields, decoded.record.fields)
        assertArrayEquals("milk".toByteArray(), decoded.record.content)
        assertEquals(bytes.size - 2, decoded.end)
    }

    @Test
    fun bytesThatAreNotOneWholeEntryAreRefused() {
        val record = BackupRecord("note", RecordFields(id, createdAt = 1, updatedAt = 2, deletedAt = null), byteArrayOf(7, 8))
        val bytes = BackupRecordEntry.encode(record)

        assertNull("cut", BackupRecordEntry.decode(bytes.copyOf(bytes.size - 1), 0))
        assertNull("another tag", BackupRecordEntry.decode(bytes.copyOf().also { it[0] = 0x03 }, 0))
        assertNull("a type name with an upper-case letter", BackupRecordEntry.decode(bytes.copyOf().also { it[2] = 'N'.code.toByte() }, 0))
        assertNull("a type name of length 0", BackupRecordEntry.decode(bytes.copyOf().also { it[1] = 0 }, 0))
        assertNull("a deletion byte that is not 0 or 1", BackupRecordEntry.decode(bytes.copyOf().also { it[2 + 4 + 16 + 16] = 2 }, 0))
        assertNull("nothing", BackupRecordEntry.decode(ByteArray(0), 0))
        assertNull("an offset past the end", BackupRecordEntry.decode(bytes, bytes.size + 1))
        assertNull("a negative offset", BackupRecordEntry.decode(bytes, -1))
    }

    private fun long(value: Long): ByteArray = ByteArray(8) { (value ushr (56 - 8 * it)).toByte() }

    private fun hex(text: String): ByteArray = ByteArray(text.length / 2) { text.substring(2 * it, 2 * it + 2).toInt(16).toByte() }
}
