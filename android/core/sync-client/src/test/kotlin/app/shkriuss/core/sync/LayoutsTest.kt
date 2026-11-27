package app.shkriuss.core.sync

import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.backup.BackupRecordEntry
import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.data.RecordFields
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The byte layouts a data app writes and reads: the plaintext of a sealed
 * record, a batch, a page, the server's answer to a batch, `status` and
 * `streams` (docs/architecture/sync-protocol.md). A page or an answer that
 * breaks its layout is refused as a whole.
 */
class LayoutsTest {
    private val id = "00112233-4455-4677-8899-aabbccddeeff"
    private val epoch = SyncId(ByteArray(16) { (0xe0 + it).toByte() })
    private val entry = BackupRecord("item", RecordFields(id, createdAt = 1, updatedAt = 2, deletedAt = null), "Milk".toByteArray())

    @Test
    fun thePlaintextIsTheVersionTheDataVersionTheEntryAndTheStreamPart() {
        val hash = ByteArray(32) { it.toByte() }
        val withStream = SealedPlaintext.encode(3, entry, StreamPart(1_000, hash))
        val expected = byteArrayOf(1, 0, 0, 0, 3) + BackupRecordEntry.encode(entry) + byteArrayOf(1) + long(1_000) + hash
        assertArrayEquals(expected, withStream)
        val without = SealedPlaintext.encode(1, entry, null)
        assertArrayEquals(byteArrayOf(1, 0, 0, 0, 1) + BackupRecordEntry.encode(entry) + byteArrayOf(0), without)

        val read = SealedPlaintext.decode(withStream, ownDataVersion = 3) as SealedPlaintext.Decoded.Whole
        assertEquals(3, read.dataVersion)
        assertEquals(entry.fields, read.entry.fields)
        assertEquals(1_000L, read.stream?.length)
        assertArrayEquals(hash, read.stream?.hash)
        assertNull((SealedPlaintext.decode(without, 1) as SealedPlaintext.Decoded.Whole).stream)
    }

    @Test
    fun aPlaintextOfAHigherVersionIsNewerAndOneThatBreaksTheLayoutIsNotValid() {
        val plaintext = SealedPlaintext.encode(2, entry, null)
        assertEquals(SealedPlaintext.Decoded.Newer, SealedPlaintext.decode(plaintext.copyOf().also { it[0] = 2 }, 2))
        assertEquals("a higher data version", SealedPlaintext.Decoded.Newer, SealedPlaintext.decode(plaintext, ownDataVersion = 1))
        assertEquals("version 0", SealedPlaintext.Decoded.NotValid, SealedPlaintext.decode(plaintext.copyOf().also { it[0] = 0 }, 2))
        assertEquals("data version 0", SealedPlaintext.Decoded.NotValid, SealedPlaintext.decode(plaintext.copyOf().also { it[4] = 0 }, 2))
        assertEquals("something after it", SealedPlaintext.Decoded.NotValid, SealedPlaintext.decode(plaintext + 0, 2))
        assertEquals("cut", SealedPlaintext.Decoded.NotValid, SealedPlaintext.decode(plaintext.copyOf(plaintext.size - 1), 2))
        assertEquals("a stream byte of 2", SealedPlaintext.Decoded.NotValid, SealedPlaintext.decode(plaintext.copyOf().also { it[it.size - 1] = 2 }, 2))
        assertEquals("a broken entry", SealedPlaintext.Decoded.NotValid, SealedPlaintext.decode(plaintext.copyOf().also { it[5] = 3 }, 2))
        val negative = SealedPlaintext.encode(1, entry, StreamPart(-1, ByteArray(32)))
        assertEquals("a negative length", SealedPlaintext.Decoded.NotValid, SealedPlaintext.decode(negative, 1))
        assertEquals("nothing", SealedPlaintext.Decoded.NotValid, SealedPlaintext.decode(ByteArray(0), 1))
    }

    @Test
    fun aBatchHasItsHeaderAndTheServerGetsItFromItsEpochOn() {
        val blob = ByteArray(60) { 7 }
        val batch = BatchLayout.write(token = 9, epoch = epoch, cursor = 4, known = 6, comparison = true, records = listOf(BatchRecord(id, blob)))

        val expected = "SHKSYNC".toByteArray() + byteArrayOf(1, 0x20) + long(9) + epoch.toBytes() + long(4) + long(6) + byteArrayOf(1) +
            byteArrayOf(0, 0, 0, 1) + RecordIds.toBytes(id) + byteArrayOf(0, 0, 0, 60) + blob
        assertArrayEquals(expected, batch)
        assertArrayEquals(epoch.toBytes(), batch.copyOfRange(17, 33))
    }

    @Test
    fun aPageThatKeepsItsRulesIsRead() {
        val page = Page.read(page(since = 3, through = 9, more = true, records = listOf(5L to 60, 9L to 60)))!!
        assertEquals(epoch, page.epoch)
        assertEquals(3L, page.since)
        assertEquals(9L, page.through)
        assertTrue(page.more)
        assertEquals(listOf(5L, 9L), page.records.map { it.number })
        assertEquals(id, page.records.first().id)

        assertNotNull("one record alone of the largest size", Page.read(page(0, 1, false, listOf(1L to SyncFormat.LARGEST_SEALED))))
        assertNotNull("records up to the byte limit", Page.read(page(0, 2, false, listOf(1L to 262_144, 2L to 262_144))))
        assertNotNull("an empty page", Page.read(page(4, 4, false, emptyList())))
    }

    @Test
    fun aPageThatBreaksItsLayoutOrItsRulesIsRefused() {
        val good = page(3, 9, false, listOf(5L to 60, 9L to 60))
        assertNull("another answer byte", Page.read(good.copyOf().also { it[0] = 0x0B }))
        assertNull("cut", Page.read(good.copyOf(good.size - 1)))
        assertNull("something after it", Page.read(good + 0))
        assertNull("a more byte of 2", Page.read(page(3, 9, false, emptyList()).also { it[33] = 2 }))
        assertNull("Through below Since", Page.read(page(9, 3, false, emptyList())))
        assertNull("numbers that go down", Page.read(page(3, 9, false, listOf(9L to 60, 5L to 60))))
        assertNull("the same number twice", Page.read(page(3, 9, false, listOf(5L to 60, 5L to 60))))
        assertNull("a number at Since", Page.read(page(3, 9, false, listOf(3L to 60))))
        assertNull("a number above Through", Page.read(page(3, 9, false, listOf(10L to 60))))
        assertNull("a blob too small", Page.read(page(3, 9, false, listOf(5L to 49))))
        assertNull("a record that is too large", Page.read(page(0, 1, false, listOf(1L to SyncFormat.LARGEST_SEALED + 1))))
        assertNull("blobs over the byte limit together", Page.read(page(0, 2, false, listOf(1L to 262_144, 2L to 262_145))))
        assertNull("more than 100 records", Page.read(page(0, 200, false, (1L..101L).map { it to 50 })))
    }

    @Test
    fun theAnswerToABatchIsReadOnlyWhenItHoldsTogether() {
        val good = answer(before = 4, after = 7, results = listOf(0 to 5L, 1 to null, 4 to 7L))
        val read = SendAnswer.read(good, 3)!!
        assertEquals(epoch, read.epoch)
        assertEquals(listOf(SendResult.STORED, SendResult.CHANGED_AFTER_CURSOR, SendResult.STORED_SEND_STREAM_AGAIN), read.outcomes.map { it.result })
        assertEquals(listOf(5L, 0L, 7L), read.outcomes.map { it.number })

        assertNull("another count", SendAnswer.read(good, 2))
        assertNull("another answer", SendAnswer.read(byteArrayOf(0x0B) + epoch.toBytes(), 3))
        assertNull("a result this code does not know", SendAnswer.read(answer(4, 7, listOf(6 to null)), 1))
        assertNull("a number at the head before", SendAnswer.read(answer(4, 7, listOf(0 to 4L)), 1))
        assertNull("a number above the head after", SendAnswer.read(answer(4, 7, listOf(0 to 8L)), 1))
        assertNull("numbers out of order", SendAnswer.read(answer(4, 7, listOf(0 to 7L, 0 to 6L)), 2))
        assertNull("a head that goes back", SendAnswer.read(answer(7, 4, listOf(1 to null)), 1))
        assertNull("cut", SendAnswer.read(good.copyOf(good.size - 1), 3))
        assertNull("something after it", SendAnswer.read(good + 0, 3))
    }

    @Test
    fun statusAndStreamsHaveTheirLayouts() {
        val status = SyncStatus(
            courierVersion = 1,
            dataVersion = 2,
            isOn = true,
            canSyncNow = true,
            epoch = epoch,
            cursor = 5,
            known = 6,
            keyId = KeyId(0x0a0b0c0d),
            comparison = ComparisonState.SENDING,
            hasOrdinaryChanges = true,
            hasComparisonRecords = false,
            hasStreamsToMove = true,
            wantsFetch = false,
            sendBlock = SendBlock.SERVER_NAMES_AN_OLDER_KEY,
            counts = SyncCounts(1, 2, 3, 4, 5, 6, 7),
        ).toBytes()
        val expected = "SHKSYNC".toByteArray() + byteArrayOf(1, 0x21, 1) + byteArrayOf(0, 0, 0, 2) + byteArrayOf(1, 1) + epoch.toBytes() +
            long(5) + long(6) + byteArrayOf(1, 0x0a, 0x0b, 0x0c, 0x0d) + byteArrayOf(2, 1, 0, 1, 0, 4) +
            (1L..7L).map(::long).reduce(ByteArray::plus)
        assertArrayEquals(expected, status)
        assertEquals(SyncStatus.BYTES, status.size)

        val out = java.io.ByteArrayOutputStream()
        StreamListWriter(out).write(ListedStream(StreamWork.FETCH, id, ByteArray(32) { 1 }, length = 100, bytesHere = 40, deletedNumber = 0))
        val list = out.toByteArray()
        val entry = byteArrayOf(2) + RecordIds.toBytes(id) + ByteArray(32) { 1 } + long(100) + long(40) + long(0)
        assertArrayEquals("SHKSYNC".toByteArray() + byteArrayOf(1, 0x22) + entry, list)
        assertEquals(StreamListWriter.ENTRY_BYTES, entry.size)
    }

    @Test
    fun recordIdsTravelAsTheSixteenBytesOfTheirHexDigits() {
        assertArrayEquals(Hex.parse("00112233445546778899aabbccddeeff"), RecordIds.toBytes(id))
        assertEquals(id, RecordIds.toText(RecordIds.toBytes(id)))
        assertEquals("e0e1e2e3e4e5e6e7e8e9eaebecedeeef", epoch.hex)
        assertEquals(epoch, SyncId.ofHex(epoch.hex))
        assertNull(SyncId.ofHex("E0E1E2E3E4E5E6E7E8E9EAEBECEDEEEF"))
        assertNull(SyncId.ofHex("e0e1"))
    }

    private fun page(since: Long, through: Long, more: Boolean, records: List<Pair<Long, Int>>): ByteArray {
        val writer = ByteWriter().u8(0).bytes(epoch.toBytes()).i64(since).i64(through).u8(if (more) 1 else 0).i32(records.size)
        records.forEach { (number, length) -> writer.bytes(RecordIds.toBytes(id)).i64(number).i32(length).bytes(ByteArray(maxOf(length, 0))) }
        return writer.toByteArray()
    }

    private fun answer(before: Long, after: Long, results: List<Pair<Int, Long?>>): ByteArray {
        val writer = ByteWriter().u8(0).bytes(epoch.toBytes()).i64(before).i64(after).i32(results.size)
        results.forEach { (code, number) ->
            writer.u8(code)
            if (number != null) writer.i64(number)
        }
        return writer.toByteArray()
    }

    private fun long(value: Long): ByteArray = ByteArray(8) { (value ushr (56 - 8 * it)).toByte() }
}
