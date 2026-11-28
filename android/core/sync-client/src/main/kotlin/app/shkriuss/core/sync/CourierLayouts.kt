package app.shkriuss.core.sync

import app.shkriuss.core.crypto.KeyId
import java.nio.ByteBuffer

/**
 * Reads the layout of `status` (docs/architecture/sync-protocol.md, "What
 * `status` gives"), as the Sync app gets it from a data app. Strict: any
 * byte that breaks the layout gives null, and the Sync app leaves that app
 * for the run.
 */
object StatusLayout {
    /** The status in [bytes], or null if they are not exactly that layout. */
    fun read(bytes: ByteArray): SyncStatus? = try {
        if (bytes.size != SyncStatus.BYTES) throw LayoutException()
        val reader = ByteReader(bytes)
        reader.header(SyncFormat.TYPE_STATUS)
        val courierVersion = reader.u8()
        val dataVersion = reader.i32()
        val isOn = reader.flag()
        val canSyncNow = reader.flag()
        val epoch = reader.bytes(SyncFormat.ID_BYTES).let { if (it.all { byte -> byte == 0.toByte() }) null else SyncId(it) }
        val cursor = reader.i64()
        val known = reader.i64()
        val hasKeyId = reader.flag()
        val keyBytes = reader.bytes(4)
        if (!hasKeyId && keyBytes.any { it != 0.toByte() }) throw LayoutException()
        val keyId = if (hasKeyId) KeyId(ByteReader(keyBytes).i32()) else null
        val comparison = reader.u8().let { code -> ComparisonState.entries.firstOrNull { it.code == code } } ?: throw LayoutException()
        val ordinary = reader.flag()
        val comparisonRecords = reader.flag()
        val streams = reader.flag()
        val wantsFetch = reader.flag()
        val block = reader.u8().let { code -> SendBlock.entries.firstOrNull { it.code == code } } ?: throw LayoutException()
        val counts = List(7) { reader.i64().also { count -> if (count < 0) throw LayoutException() } }
        reader.end()
        if (dataVersion < 1 || cursor < 0 || known < cursor) throw LayoutException()
        SyncStatus(
            courierVersion = courierVersion,
            dataVersion = dataVersion,
            isOn = isOn,
            canSyncNow = canSyncNow,
            epoch = epoch,
            cursor = cursor,
            known = known,
            keyId = keyId,
            comparison = comparison,
            hasOrdinaryChanges = ordinary,
            hasComparisonRecords = comparisonRecords,
            hasStreamsToMove = streams,
            wantsFetch = wantsFetch,
            sendBlock = block,
            counts = SyncCounts(counts[0], counts[1], counts[2], counts[3], counts[4], counts[5], counts[6]),
        )
    } catch (_: LayoutException) {
        null
    }
}

/**
 * Reads the layout of `streams` (docs/architecture/sync-protocol.md, "What
 * `streams` gives"): the header, then entries of 73 bytes to the end.
 * Strict: a kind it does not know, a hash or a length that a kind does not
 * use, bytes of a fetch beyond its length, or a file named twice give null.
 */
object StreamListLayout {
    /** The most streams one list may name, so that a list never takes more memory than this many entries. */
    const val MOST_STREAMS: Int = 200_000

    /** The streams in [bytes], or null if they are not exactly that layout. */
    fun read(bytes: ByteArray): List<ListedStream>? = try {
        val reader = ByteReader(bytes)
        reader.header(SyncFormat.TYPE_STREAMS)
        if (reader.remaining % StreamListWriter.ENTRY_BYTES != 0) throw LayoutException()
        val count = reader.remaining / StreamListWriter.ENTRY_BYTES
        if (count > MOST_STREAMS) throw LayoutException()
        val fileIds = HashSet<String>()
        List(count) {
            val work = reader.u8().let { code -> StreamWork.entries.firstOrNull { it.code == code } } ?: throw LayoutException()
            val fileId = RecordIds.toText(reader.bytes(SyncFormat.ID_BYTES))
            // Each file is in a list at most once: Sync keeps what it moves by file ID.
            if (!fileIds.add(fileId)) throw LayoutException()
            val hash = reader.bytes(SyncFormat.HASH_BYTES)
            val length = reader.i64()
            val here = reader.i64()
            val deletedNumber = reader.i64()
            val zeroHash = hash.all { byte -> byte == 0.toByte() }
            val fits = when (work) {
                StreamWork.SEND -> length > 0 && here == 0L && deletedNumber == 0L
                StreamWork.FETCH -> length > 0 && here in 0..length && deletedNumber == 0L
                StreamWork.DELETE -> zeroHash && length == 0L && here == 0L && deletedNumber > 0
            }
            if (!fits) throw LayoutException()
            ListedStream(work, fileId, hash, length, here, deletedNumber)
        }
    } catch (_: LayoutException) {
        null
    }
}

/**
 * The first bytes of a batch that `export` gave (docs/architecture/
 * sync-protocol.md, "A batch"), checked as the Sync app checks it before it
 * sends the rest: the layout, 1 to 100 records, each blob 50 to 524,288
 * bytes, the blobs within [ExportedBatch.read]'s byte limit unless there is
 * one, and nothing after the last record.
 */
class ExportedBatch private constructor(
    /** The token, which `exported` gives back. */
    val token: Long,
    /** The epoch the app made the batch for. */
    val epoch: SyncId,
    /** True for the records of a comparison of everything. */
    val comparison: Boolean,
    /** How many records it holds. */
    val count: Int,
    private val bytes: ByteArray,
) {
    /** The body of the request to the server: the batch without its first 17 bytes. */
    fun body(): ByteArray = bytes.copyOfRange(BODY_START, bytes.size)

    override fun toString(): String = "ExportedBatch($count records)"

    companion object {
        /** Where the part that goes to the server starts. */
        private const val BODY_START = 17

        /** The batch in [bytes], or null if it breaks its layout or the limits the Sync app gave. */
        fun read(bytes: ByteArray, mostRecords: Int, mostBytes: Int): ExportedBatch? = try {
            val reader = ByteReader(bytes)
            reader.header(SyncFormat.TYPE_BATCH)
            val token = reader.i64()
            val epoch = SyncId(reader.bytes(SyncFormat.ID_BYTES))
            val cursor = reader.i64()
            val known = reader.i64()
            val comparison = reader.flag()
            val count = reader.u32()
            if (cursor < 0 || known < cursor || count !in 1..minOf(mostRecords, SyncFormat.MOST_RECORDS).toLong()) throw LayoutException()
            var total = 0L
            val ids = HashSet<ByteBuffer>()
            repeat(count.toInt()) { index ->
                // Each record is in a batch at most once.
                if (!ids.add(ByteBuffer.wrap(reader.bytes(SyncFormat.ID_BYTES)))) throw LayoutException()
                val length = reader.u32()
                if (length !in SyncFormat.SMALLEST_SEALED..SyncFormat.LARGEST_SEALED) throw LayoutException()
                total += length
                if (index > 0 && total > mostBytes) throw LayoutException()
                reader.bytes(length.toInt())
            }
            reader.end()
            ExportedBatch(token, epoch, comparison, count.toInt(), bytes)
        } catch (_: LayoutException) {
            null
        }
    }
}

/** What stops sync on this phone now, as the Sync app's `state` names it (docs/apps/sync/spec.md, "Problems"). */
enum class SyncStop(internal val code: Int) {
    /** Nothing. */
    NONE(0),

    /** This phone has not joined a server, or it was closed or removed, or Sync lost its keys. */
    NOT_JOINED(1),

    /** The server speaks only newer versions: "Update the Sync app". */
    UPDATE_SYNC(2),

    /** The server speaks only older versions: "Update your server". */
    UPDATE_THE_SERVER(3),

    /** The phone's clock is off. [SyncAppState.value] holds the offset. */
    CLOCK(4),

    /** The server refused a request: a fault. */
    FAULT(5),

    /** The server's limit for the day is used. [SyncAppState.value] holds the end of the wait. */
    DAY_LIMIT(6),

    /** The server is full. */
    FULL(7),

    /** The server could not be reached in three runs in a row. */
    CANNOT_REACH(8),
}

/**
 * What the Sync app answers to `state` (docs/architecture/sync-protocol.md,
 * "What `state` gives"): whether this phone has joined a server, when a run
 * last ended well for the app that asks, what stops sync now, and whether
 * that app's files wait for a network that is not metered.
 */
class SyncAppState(
    val joined: Boolean,
    /** When a run last ended well for the app that asks, in milliseconds since 1970 UTC, or 0 for never. */
    val goodAt: Long,
    val stop: SyncStop,
    /** For [SyncStop.DAY_LIMIT] the end of the wait, for [SyncStop.CLOCK] the server's clock minus the phone's, in milliseconds. Else 0. */
    val value: Long,
    /** True when files move only on a network that is not metered, and the phone's network is metered now. */
    val filesWaitForUnmetered: Boolean,
) {
    init {
        require(goodAt >= 0) { "A time is not before 1970" }
        require(value == 0L || stop == SyncStop.DAY_LIMIT || stop == SyncStop.CLOCK) { "Only a wait and a clock carry a value" }
        require(joined == (stop != SyncStop.NOT_JOINED)) { "A phone that has not joined stops for that alone" }
    }

    /** The layout of `state`. */
    fun toBytes(): ByteArray = ByteWriter()
        .header(SyncFormat.TYPE_STATE)
        .u8(SyncFormat.COURIER_VERSION)
        .u8(if (joined) 1 else 0)
        .i64(goodAt)
        .u8(stop.code)
        .i64(value)
        .u8(if (filesWaitForUnmetered) 1 else 0)
        .toByteArray()

    override fun toString(): String = "SyncAppState(joined $joined, $stop)"

    companion object {
        /** How many bytes [toBytes] writes. */
        const val BYTES: Int = 9 + 1 + 1 + 8 + 1 + 8 + 1

        /** The state in [bytes], or null if they are not exactly that layout. A data app reads it so. */
        fun read(bytes: ByteArray): SyncAppState? = try {
            if (bytes.size != BYTES) throw LayoutException()
            val reader = ByteReader(bytes)
            reader.header(SyncFormat.TYPE_STATE)
            if (reader.u8() != SyncFormat.COURIER_VERSION) throw LayoutException()
            val joined = reader.flag()
            val goodAt = reader.i64()
            val stop = reader.u8().let { code -> SyncStop.entries.firstOrNull { it.code == code } } ?: throw LayoutException()
            val value = reader.i64()
            val files = reader.flag()
            reader.end()
            if (goodAt < 0) throw LayoutException()
            if (value != 0L && stop != SyncStop.DAY_LIMIT && stop != SyncStop.CLOCK) throw LayoutException()
            if (joined != (stop != SyncStop.NOT_JOINED)) throw LayoutException()
            SyncAppState(joined, goodAt, stop, value, files)
        } catch (_: LayoutException) {
            null
        }
    }
}

/** Reads the first nine bytes of a layout of the courier interface, which must name [type]. */
internal fun ByteReader.header(type: Int) {
    expect(SyncFormat.MAGIC)
    if (u8() != SyncFormat.LAYOUT_VERSION || u8() != type) throw LayoutException()
}

/** Reads one byte that must be `00` or `01`. */
internal fun ByteReader.flag(): Boolean = when (u8()) {
    0 -> false
    1 -> true
    else -> throw LayoutException()
}
