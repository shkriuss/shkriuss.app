package app.shkriuss.core.sync

import app.shkriuss.core.crypto.KeyId
import java.io.ByteArrayOutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The layouts that the Sync app reads from a data app, and the one a data
 * app reads from the Sync app (docs/architecture/sync-protocol.md, "What
 * `status` gives", "What `streams` gives", "A batch" and "What `state`
 * gives"): what one side writes, the other reads back, and a byte that
 * breaks a layout is refused.
 */
class CourierLayoutsTest {
    private val status = SyncStatus(
        courierVersion = 1,
        dataVersion = 3,
        isOn = true,
        canSyncNow = false,
        epoch = SyncId(ByteArray(16) { 2 }),
        cursor = 4,
        known = 9,
        keyId = KeyId(0x0a0b0c0d),
        comparison = ComparisonState.SENDING,
        hasOrdinaryChanges = true,
        hasComparisonRecords = false,
        hasStreamsToMove = true,
        wantsFetch = true,
        sendBlock = SendBlock.SERVER_NAMES_AN_OLDER_KEY,
        counts = SyncCounts(1, 2, 3, 4, 5, 6, 7),
    )

    @Test
    fun aStatusIsReadBackAsItWasWritten() {
        val read = StatusLayout.read(status.toBytes())!!
        assertArrayEquals(status.toBytes(), read.toBytes())
        assertEquals(ComparisonState.SENDING, read.comparison)
        assertEquals(SendBlock.SERVER_NAMES_AN_OLDER_KEY, read.sendBlock)
        assertEquals(7, read.counts.wrongStreams)
        val first = SyncStatus(1, 1, false, false, null, 0, 0, null, ComparisonState.NONE, false, false, false, false, SendBlock.NONE, SyncCounts(0, 0, 0, 0, 0, 0, 0))
        val none = StatusLayout.read(first.toBytes())!!
        assertNull(none.epoch)
        assertNull(none.keyId)
    }

    @Test
    fun aStatusThatBreaksItsLayoutIsRefused() {
        val bytes = status.toBytes()
        fun with(offset: Int, value: Int) = bytes.copyOf().also { it[offset] = value.toByte() }
        listOf(
            "too short" to bytes.copyOf(bytes.size - 1),
            "too long" to bytes + 0,
            "another type" to with(8, 0x20),
            "a flag that is not 00 or 01" to with(14, 2),
            "a key ID after 00" to with(48, 0),
            "a comparison it does not know" to with(53, 3),
            "a reason it does not know" to with(58, 5),
            "a negative count" to with(59, 0x80),
            "Known below the cursor" to with(47, 0).also { it[39] = 9 },
            "a data version of 0" to with(13, 0).also { it[10] = 0; it[11] = 0; it[12] = 0 },
        ).forEach { (what, broken) -> assertNull(what, StatusLayout.read(broken)) }
    }

    @Test
    fun aListOfStreamsIsReadBackAndEachKindKeepsItsFields() {
        val out = ByteArrayOutputStream()
        val writer = StreamListWriter(out)
        val file = "00112233-4455-6677-8899-aabbccddeeff"
        val streams = listOf(
            ListedStream(StreamWork.SEND, file, ByteArray(32) { 1 }, 10, 0, 0),
            ListedStream(StreamWork.FETCH, file, ByteArray(32) { 2 }, 10, 4, 0),
            ListedStream(StreamWork.DELETE, file, ByteArray(32), 0, 0, 12),
        )
        streams.forEach(writer::write)
        val read = StreamListLayout.read(out.toByteArray())!!
        assertEquals(streams.map { it.work }, read.map { it.work })
        assertEquals(file, read.first().fileId)
        assertArrayEquals(ByteArray(16) { (it * 0x11).toByte() }, read.first().fileIdBytes)
        assertEquals(12, read.last().deletedNumber)

        fun one(stream: ListedStream) = ByteArrayOutputStream().also { StreamListWriter(it).write(stream) }.toByteArray()
        listOf(
            "bytes of a fetch beyond its length" to ListedStream(StreamWork.FETCH, file, ByteArray(32), 10, 11, 0),
            "a deletion with a hash" to ListedStream(StreamWork.DELETE, file, ByteArray(32) { 1 }, 0, 0, 12),
            "a deletion with no number" to ListedStream(StreamWork.DELETE, file, ByteArray(32), 0, 0, 0),
            "a stream to send with no bytes" to ListedStream(StreamWork.SEND, file, ByteArray(32) { 1 }, 0, 0, 0),
        ).forEach { (what, stream) -> assertNull(what, StreamListLayout.read(one(stream))) }
        assertNull("a cut entry", StreamListLayout.read(out.toByteArray().copyOf(out.size() - 1)))
        assertNotNull("an empty list", StreamListLayout.read(ByteArrayOutputStream().also { StreamListWriter(it) }.toByteArray()))
    }

    @Test
    fun aBatchIsCheckedAgainstTheLimitsTheSyncAppGave() {
        val epoch = SyncId(ByteArray(16) { 5 })
        val blob = ByteArray(60) { 1 }
        val records = List(3) { BatchRecord("00112233-4455-6677-8899-aabbccddee0$it", blob) }
        val bytes = BatchLayout.write(token = 77, epoch = epoch, cursor = 1, known = 2, comparison = true, records = records)
        val batch = ExportedBatch.read(bytes, mostRecords = 3, mostBytes = 180)!!
        assertEquals(77, batch.token)
        assertEquals(epoch, batch.epoch)
        assertEquals(3, batch.count)
        assertArrayEquals(bytes.copyOfRange(17, bytes.size), batch.body())
        assertNull("more records than asked", ExportedBatch.read(bytes, mostRecords = 2, mostBytes = 180))
        assertNull("more bytes than asked", ExportedBatch.read(bytes, mostRecords = 3, mostBytes = 179))
        val alone = BatchLayout.write(1, epoch, 0, 0, false, listOf(BatchRecord(records[0].id, ByteArray(70_000))))
        assertNotNull("one record alone is always allowed", ExportedBatch.read(alone, 1, 65_536))
        assertNull("something after the last record", ExportedBatch.read(bytes + 0, 3, 180))
        val twice = BatchLayout.write(2, epoch, 0, 0, false, listOf(records[0], records[1], records[0]))
        assertNull("one record twice", ExportedBatch.read(twice, 3, 180))
    }

    @Test
    fun theStateOfTheSyncAppIsReadBackAndRefusedWhenItDoesNotHoldTogether() {
        val state = SyncAppState(joined = true, goodAt = 5, stop = SyncStop.DAY_LIMIT, value = 86_400_000, filesWaitForUnmetered = true)
        val bytes = state.toBytes()
        assertEquals(SyncAppState.BYTES, bytes.size)
        val read = SyncAppState.read(bytes)!!
        assertArrayEquals(bytes, read.toBytes())
        assertEquals(SyncStop.DAY_LIMIT, read.stop)
        val notJoined = SyncAppState(joined = false, goodAt = 0, stop = SyncStop.NOT_JOINED, value = 0, filesWaitForUnmetered = false)
        assertNotNull(SyncAppState.read(notJoined.toBytes()))

        fun with(offset: Int, value: Int) = bytes.copyOf().also { it[offset] = value.toByte() }
        listOf(
            "another version of the courier interface" to with(9, 2),
            "not joined, with a stop of a joined phone" to with(10, 0),
            "a stop it does not know" to with(19, 9),
            "a value on a stop that carries none" to with(19, SyncStop.FULL.ordinal),
            "a flag that is not 00 or 01" to with(28, 2),
            "too short" to bytes.copyOf(bytes.size - 1),
        ).forEach { (what, broken) -> assertNull(what, SyncAppState.read(broken)) }
    }
}
