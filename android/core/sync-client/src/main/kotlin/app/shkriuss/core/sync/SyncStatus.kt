package app.shkriuss.core.sync

import app.shkriuss.core.crypto.KeyId
import java.io.OutputStream

/** Why an app sends nothing now (docs/architecture/sync-protocol.md, `status`). */
enum class SendBlock(internal val code: Int) {
    /** Nothing stops sending. */
    NONE(0),

    /** A record of a newer version of the app came: "Update the app". */
    UPDATE_THE_APP(1),

    /** The server names a recovery key that this app does not hold: "Enter the new recovery key". */
    ENTER_THE_NEW_RECOVERY_KEY(2),

    /** This app has a new recovery key that the server has not taken yet. It waits. */
    WAITS_FOR_THE_SERVER(3),

    /** The server names an older recovery key than this app's. */
    SERVER_NAMES_AN_OLDER_KEY(4),
}

/** The comparison of everything, as `status` gives it. */
enum class ComparisonState(internal val code: Int) {
    NONE(0),
    FETCHING(1),
    SENDING(2),
}

/** How many records an app skipped, by reason, and the other counts `status` gives. No count holds an ID or content. */
class SyncCounts(
    val anotherRecoveryKey: Long,
    val damaged: Long,
    val newer: Long,
    val notValid: Long,
    val tooLarge: Long,
    val refusedByTheServer: Long,
    val wrongStreams: Long,
)

/**
 * Where an app stands, as `status` gives it. [toBytes] writes the layout
 * of docs/architecture/sync-protocol.md, "What `status` gives".
 */
class SyncStatus(
    val courierVersion: Int,
    val dataVersion: Int,
    val isOn: Boolean,
    /** False while the app has no `record` keyset it can use now. */
    val canSyncNow: Boolean,
    val epoch: SyncId?,
    val cursor: Long,
    val known: Long,
    /** P: the key ID of the app's current key, or null without keys. */
    val keyId: KeyId?,
    val comparison: ComparisonState,
    val hasOrdinaryChanges: Boolean,
    val hasComparisonRecords: Boolean,
    val hasStreamsToMove: Boolean,
    /** True when the app needs one more fetch before it follows a new recovery key. */
    val wantsFetch: Boolean,
    val sendBlock: SendBlock,
    val counts: SyncCounts,
) {
    /** The layout of `status`. */
    fun toBytes(): ByteArray = ByteWriter()
        .header(SyncFormat.TYPE_STATUS)
        .u8(courierVersion)
        .i32(dataVersion)
        .u8(flag(isOn))
        .u8(flag(canSyncNow))
        .bytes(epoch?.toBytes() ?: ByteArray(SyncFormat.ID_BYTES))
        .i64(cursor)
        .i64(known)
        .u8(flag(keyId != null))
        .bytes(keyId?.toBytes() ?: ByteArray(4))
        .u8(comparison.code)
        .u8(flag(hasOrdinaryChanges))
        .u8(flag(hasComparisonRecords))
        .u8(flag(hasStreamsToMove))
        .u8(flag(wantsFetch))
        .u8(sendBlock.code)
        .i64(counts.anotherRecoveryKey)
        .i64(counts.damaged)
        .i64(counts.newer)
        .i64(counts.notValid)
        .i64(counts.tooLarge)
        .i64(counts.refusedByTheServer)
        .i64(counts.wrongStreams)
        .toByteArray()

    override fun toString(): String = "SyncStatus(on $isOn, can sync $canSyncNow, cursor $cursor, known $known, $comparison, $sendBlock)"

    private fun flag(value: Boolean): Int = if (value) 1 else 0

    /** The length of the layout. */
    companion object {
        /** How many bytes [toBytes] writes. */
        const val BYTES: Int = 9 + 1 + 4 + 1 + 1 + 16 + 8 + 8 + 1 + 4 + 1 + 1 + 1 + 1 + 1 + 1 + 7 * 8
    }
}

/** What the Sync app is to do with one stream (docs/architecture/sync-protocol.md, "What `streams` gives"). */
enum class StreamWork(internal val code: Int) {
    /** Send the chunks the server lacks. */
    SEND(1),

    /** Fetch the chunks that are not here yet. */
    FETCH(2),

    /** Ask the server to delete the chunks. */
    DELETE(3),
}

/**
 * One stream that `streams` lists: what to do with it, the file ID, the
 * stream's SHA-256 and length, how many bytes of a fetch are here, and the
 * number under which this phone's batch stored the file's deleted record.
 * The fields a kind does not use are zero.
 */
class ListedStream(
    val work: StreamWork,
    val fileId: String,
    val hash: ByteArray,
    val length: Long,
    val bytesHere: Long,
    val deletedNumber: Long,
) {
    /** The file ID as the 16 bytes that travel. */
    val fileIdBytes: ByteArray get() = RecordIds.toBytes(fileId)

    override fun toString(): String = "ListedStream($work, $length)"
}

/** Writes the layout of `streams`: the header, then one entry of 73 bytes for each stream, to the end. */
internal class StreamListWriter(private val out: OutputStream) {
    init {
        out.write(ByteWriter().header(SyncFormat.TYPE_STREAMS).toByteArray())
    }

    fun write(stream: ListedStream) {
        out.write(
            ByteWriter()
                .u8(stream.work.code)
                .bytes(RecordIds.toBytes(stream.fileId))
                .bytes(stream.hash)
                .i64(stream.length)
                .i64(stream.bytesHere)
                .i64(stream.deletedNumber)
                .toByteArray(),
        )
    }

    companion object {
        /** The length of one entry. */
        const val ENTRY_BYTES: Int = 1 + 16 + 32 + 8 + 8 + 8
    }
}
