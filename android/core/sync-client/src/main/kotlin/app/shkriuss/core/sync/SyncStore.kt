package app.shkriuss.core.sync

import androidx.room3.PooledConnection
import androidx.sqlite.SQLiteStatement
import app.shkriuss.core.data.ChangeCounter

/** The kinds of **To send**. */
internal enum class SendKind(val code: Int) {
    ORDINARY(1),
    COMPARISON(2),
}

/** The comparison of everything, as [SyncStateRow.comparison] holds it. */
internal enum class Comparison(val code: Int) {
    NONE(0),
    FETCHING(1),
    SENDING(2),
    ;

    companion object {
        fun of(code: Int): Comparison = entries.first { it.code == code }
    }
}

/** Why an app stopped sending, as it learned it from a record or from the server. */
internal enum class Stop(val code: Int) {
    NONE(0),
    NEWER(1),
    NEEDS_NEW_KEY(2),
    ;

    companion object {
        fun of(code: Int): Stop = entries.first { it.code == code }
    }
}

/** The row of [SyncStateRow], in memory. */
internal data class SyncState(
    val isOn: Boolean,
    val serverId: String?,
    val epoch: String?,
    val deviceId: String?,
    val cursor: Long,
    val known: Long,
    val syncKeyId: Int?,
    val sendMark: Long,
    val comparison: Comparison,
    val stopped: Stop,
    val dataVersion: Int,
    val skippedFrom: Long?,
    val skippedAnotherKey: Long,
    val skippedDamaged: Long,
    val skippedNewer: Long,
    val skippedNotValid: Long,
    val tooLarge: Long,
    val refused: Long,
    val wrongStreams: Long,
    val lastToken: Long,
    val sealFileKeys: Boolean,
    val stoppedKeyId: Int?,
    val plaintextVersion: Int,
    val afterImportDue: Boolean,
    val countedThrough: Long,
) {
    override fun toString(): String = "SyncState(cursor $cursor, known $known, comparison $comparison, stopped $stopped)"
}

/** The row of [SyncStreamRow], in memory. */
internal data class StreamState(
    val fileId: String,
    val length: Long,
    val hash: String?,
    val onServer: Boolean,
    val here: Boolean,
    val doesNotFit: Boolean,
    val toDelete: Boolean,
    val deletedNumber: Long?,
    val wrongAt: Long?,
    val toRemove: Boolean,
    val recordDeleted: Boolean,
) {
    override fun toString(): String = "StreamState($length, on the server $onServer, here $here, to delete $toDelete)"

    /** A stream sync knows nothing more of. */
    companion object {
        fun of(fileId: String, length: Long, here: Boolean) = StreamState(
            fileId = fileId,
            length = length,
            hash = null,
            onServer = false,
            here = here,
            doesNotFit = false,
            toDelete = false,
            deletedNumber = null,
            wrongAt = null,
            toRemove = false,
            recordDeleted = false,
        )
    }
}

/** One record of the batch given out last. */
internal class BatchEntry(val recordId: String, val deletedFile: Boolean)

/**
 * The SQL of sync's own tables. It writes only the `sync_` tables of
 * SyncTables.kt; a test checks that. It runs
 * through the connection of a transaction that the caller holds, as
 * `RecordWriter` raises the change counter, so the state of sync and the
 * records it stands for are written together.
 */
internal object SyncSql {
    const val STATE = "sync_state"
    const val SEND = "sync_send"
    const val TAKEN = "sync_taken"
    const val SEEN = "sync_seen"
    const val DAMAGED = "sync_damaged"
    const val BATCH = "sync_batch"
    const val STREAM = "sync_stream"

    private const val STATE_COLUMNS =
        "isOn, serverId, epoch, deviceId, cursor, known, syncKeyId, sendMark, comparison, stopped, dataVersion, " +
            "skippedFrom, skippedAnotherKey, skippedDamaged, skippedNewer, skippedNotValid, tooLarge, refused, wrongStreams, lastToken, sealFileKeys, " +
            "stoppedKeyId, plaintextVersion, afterImportDue, countedThrough"

    const val CREATE_STATE =
        "INSERT INTO $STATE (id, $STATE_COLUMNS) VALUES (1, 0, NULL, NULL, NULL, 0, 0, NULL, 0, 0, 0, ?1, NULL, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, ?2, 0, 0) " +
            "ON CONFLICT (id) DO NOTHING"
    const val READ_STATE = "SELECT $STATE_COLUMNS FROM $STATE WHERE id = 1"
    const val WRITE_STATE =
        "UPDATE $STATE SET isOn = ?, serverId = ?, epoch = ?, deviceId = ?, cursor = ?, known = ?, syncKeyId = ?, sendMark = ?, " +
            "comparison = ?, stopped = ?, dataVersion = ?, skippedFrom = ?, skippedAnotherKey = ?, skippedDamaged = ?, " +
            "skippedNewer = ?, skippedNotValid = ?, tooLarge = ?, refused = ?, wrongStreams = ?, lastToken = ?, sealFileKeys = ?, " +
            "stoppedKeyId = ?, plaintextVersion = ?, afterImportDue = ?, countedThrough = ? WHERE id = 1"

    const val SEND_ORDINARY =
        "INSERT INTO $SEND (recordId, kind, position) VALUES (?, 1, ?) " +
            "ON CONFLICT (recordId) DO UPDATE SET kind = 1, position = excluded.position"
    const val SEND_COMPARISON = "INSERT INTO $SEND (recordId, kind, position) VALUES (?, 2, ?) ON CONFLICT (recordId) DO NOTHING"
    const val UNSEND = "DELETE FROM $SEND WHERE recordId = ?"
    const val UNSEND_KIND = "DELETE FROM $SEND WHERE kind = ?"
    const val COUNT_SEND = "SELECT count(*) FROM $SEND WHERE kind = ?"
    const val SEND_PAGE =
        "SELECT recordId, position FROM $SEND WHERE kind = ?1 AND (position > ?2 OR (position = ?2 AND recordId > ?3)) " +
            "ORDER BY position, recordId LIMIT ?4"

    const val PUT_TAKEN =
        "INSERT INTO $TAKEN (recordId, changeNumber) VALUES (?, ?) ON CONFLICT (recordId) DO UPDATE SET changeNumber = excluded.changeNumber"
    const val READ_TAKEN = "SELECT changeNumber FROM $TAKEN WHERE recordId = ?"
    const val DROP_TAKEN = "DELETE FROM $TAKEN WHERE changeNumber <= ?"

    const val ADD_SEEN = "INSERT INTO $SEEN (recordId) VALUES (?) ON CONFLICT (recordId) DO NOTHING"
    const val READ_SEEN = "SELECT 1 FROM $SEEN WHERE recordId = ?"
    const val CLEAR_SEEN = "DELETE FROM $SEEN"

    const val ADD_DAMAGED = "INSERT INTO $DAMAGED (recordId) VALUES (?) ON CONFLICT (recordId) DO NOTHING"
    const val READ_DAMAGED = "SELECT 1 FROM $DAMAGED WHERE recordId = ?"
    const val REMOVE_DAMAGED = "DELETE FROM $DAMAGED WHERE recordId = ?"

    const val CLEAR_BATCH = "DELETE FROM $BATCH"
    const val ADD_BATCH = "INSERT INTO $BATCH (position, recordId, deletedFile) VALUES (?, ?, ?)"
    const val READ_BATCH = "SELECT recordId, deletedFile FROM $BATCH ORDER BY position"

    private const val STREAM_COLUMNS = "fileId, length, hash, onServer, here, doesNotFit, toDelete, deletedNumber, wrongAt, toRemove, recordDeleted"
    const val PUT_STREAM =
        "INSERT INTO $STREAM ($STREAM_COLUMNS) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (fileId) DO UPDATE SET " +
            "length = excluded.length, hash = excluded.hash, onServer = excluded.onServer, here = excluded.here, " +
            "doesNotFit = excluded.doesNotFit, toDelete = excluded.toDelete, deletedNumber = excluded.deletedNumber, " +
            "wrongAt = excluded.wrongAt, toRemove = excluded.toRemove, recordDeleted = excluded.recordDeleted"
    const val READ_STREAM = "SELECT $STREAM_COLUMNS FROM $STREAM WHERE fileId = ?"
    /** The streams that may have work: to delete on the server, or of a live record and not known to be both here and there. */
    private const val MAY_HAVE_WORK = "(toDelete = 1 OR (recordDeleted = 0 AND (onServer = 0 OR here = 0 OR doesNotFit = 1)))"
    const val STREAM_PAGE = "SELECT $STREAM_COLUMNS FROM $STREAM WHERE $MAY_HAVE_WORK AND fileId > ? ORDER BY fileId LIMIT ?"
    const val STREAMS_TO_REMOVE = "SELECT $STREAM_COLUMNS FROM $STREAM WHERE toRemove = 1 ORDER BY fileId"
    const val REMOVE_STREAM = "DELETE FROM $STREAM WHERE fileId = ?"
    const val FORGET_STREAMS_ON_SERVER = "UPDATE $STREAM SET onServer = 0"
    const val FORGET_DELETIONS = "UPDATE $STREAM SET toDelete = 0, deletedNumber = NULL"

    /** Reads, never writes, the change counter of `core/data`. */
    const val LAST_CHANGE = ChangeCounter.READ_SQL
}

/**
 * Reads and writes sync's own tables through [connection], the connection
 * of a transaction that the caller holds.
 */
internal class SyncStore(private val connection: PooledConnection) {
    suspend fun state(dataVersion: Int): SyncState {
        connection.usePrepared(SyncSql.CREATE_STATE) {
            it.bindLong(1, dataVersion.toLong())
            it.bindLong(2, SyncFormat.PLAINTEXT_VERSION.toLong())
            it.step()
        }
        return connection.usePrepared(SyncSql.READ_STATE) {
            check(it.step()) { "The state of sync has no row" }
            SyncState(
                isOn = it.getLong(0) != 0L,
                serverId = it.textOrNull(1),
                epoch = it.textOrNull(2),
                deviceId = it.textOrNull(3),
                cursor = it.getLong(4),
                known = it.getLong(5),
                syncKeyId = it.longOrNull(6)?.toInt(),
                sendMark = it.getLong(7),
                comparison = Comparison.of(it.getLong(8).toInt()),
                stopped = Stop.of(it.getLong(9).toInt()),
                dataVersion = it.getLong(10).toInt(),
                skippedFrom = it.longOrNull(11),
                skippedAnotherKey = it.getLong(12),
                skippedDamaged = it.getLong(13),
                skippedNewer = it.getLong(14),
                skippedNotValid = it.getLong(15),
                tooLarge = it.getLong(16),
                refused = it.getLong(17),
                wrongStreams = it.getLong(18),
                lastToken = it.getLong(19),
                sealFileKeys = it.getLong(20) != 0L,
                stoppedKeyId = it.longOrNull(21)?.toInt(),
                plaintextVersion = it.getLong(22).toInt(),
                afterImportDue = it.getLong(23) != 0L,
                countedThrough = it.getLong(24),
            )
        }
    }

    suspend fun save(state: SyncState) {
        connection.usePrepared(SyncSql.WRITE_STATE) {
            it.bindLong(1, if (state.isOn) 1 else 0)
            it.bindTextOrNull(2, state.serverId)
            it.bindTextOrNull(3, state.epoch)
            it.bindTextOrNull(4, state.deviceId)
            it.bindLong(5, state.cursor)
            it.bindLong(6, state.known)
            it.bindLongOrNull(7, state.syncKeyId?.toLong())
            it.bindLong(8, state.sendMark)
            it.bindLong(9, state.comparison.code.toLong())
            it.bindLong(10, state.stopped.code.toLong())
            it.bindLong(11, state.dataVersion.toLong())
            it.bindLongOrNull(12, state.skippedFrom)
            it.bindLong(13, state.skippedAnotherKey)
            it.bindLong(14, state.skippedDamaged)
            it.bindLong(15, state.skippedNewer)
            it.bindLong(16, state.skippedNotValid)
            it.bindLong(17, state.tooLarge)
            it.bindLong(18, state.refused)
            it.bindLong(19, state.wrongStreams)
            it.bindLong(20, state.lastToken)
            it.bindLong(21, if (state.sealFileKeys) 1 else 0)
            it.bindLongOrNull(22, state.stoppedKeyId?.toLong())
            it.bindLong(23, state.plaintextVersion.toLong())
            it.bindLong(24, if (state.afterImportDue) 1 else 0)
            it.bindLong(25, state.countedThrough)
            it.step()
        }
    }

    /** The last change number handed out in the database, or 0 before the first write. */
    suspend fun lastChangeNumber(): Long = connection.usePrepared(SyncSql.LAST_CHANGE) { if (it.step()) it.getLong(0) else 0L }

    suspend fun sendOrdinary(id: String, position: Long) = run(SyncSql.SEND_ORDINARY) {
        it.bindText(1, id)
        it.bindLong(2, position)
    }

    /** Puts [id] into **To send** as "comparison", unless it is there already. */
    suspend fun sendComparison(id: String, position: Long) = run(SyncSql.SEND_COMPARISON) {
        it.bindText(1, id)
        it.bindLong(2, position)
    }

    suspend fun unsend(id: String) = run(SyncSql.UNSEND) { it.bindText(1, id) }

    suspend fun unsendAll(kind: SendKind) = run(SyncSql.UNSEND_KIND) { it.bindLong(1, kind.code.toLong()) }

    suspend fun countSend(kind: SendKind): Long = connection.usePrepared(SyncSql.COUNT_SEND) {
        it.bindLong(1, kind.code.toLong())
        it.step()
        it.getLong(0)
    }

    /** Up to [limit] records of [kind] in **To send**, in their order, after the one at [afterPosition] with [afterId]. */
    suspend fun sendPage(kind: SendKind, afterPosition: Long, afterId: String, limit: Int): List<Pair<String, Long>> =
        connection.usePrepared(SyncSql.SEND_PAGE) {
            it.bindLong(1, kind.code.toLong())
            it.bindLong(2, afterPosition)
            it.bindText(3, afterId)
            it.bindLong(4, limit.toLong())
            buildList { while (it.step()) add(it.getText(0) to it.getLong(1)) }
        }

    suspend fun putTaken(id: String, changeNumber: Long) = run(SyncSql.PUT_TAKEN) {
        it.bindText(1, id)
        it.bindLong(2, changeNumber)
    }

    suspend fun takenNumber(id: String): Long? = connection.usePrepared(SyncSql.READ_TAKEN) {
        it.bindText(1, id)
        if (it.step()) it.getLong(0) else null
    }

    suspend fun dropTakenUpTo(changeNumber: Long) = run(SyncSql.DROP_TAKEN) { it.bindLong(1, changeNumber) }

    suspend fun addSeen(id: String) = run(SyncSql.ADD_SEEN) { it.bindText(1, id) }

    suspend fun isSeen(id: String): Boolean = exists(SyncSql.READ_SEEN, id)

    suspend fun clearSeen() = run(SyncSql.CLEAR_SEEN) {}

    suspend fun addDamaged(id: String) = run(SyncSql.ADD_DAMAGED) { it.bindText(1, id) }

    suspend fun isDamaged(id: String): Boolean = exists(SyncSql.READ_DAMAGED, id)

    suspend fun removeDamaged(id: String) = run(SyncSql.REMOVE_DAMAGED) { it.bindText(1, id) }

    suspend fun clearBatch() = run(SyncSql.CLEAR_BATCH) {}

    suspend fun addBatch(position: Int, id: String, deletedFile: Boolean) = run(SyncSql.ADD_BATCH) {
        it.bindLong(1, position.toLong())
        it.bindText(2, id)
        it.bindLong(3, if (deletedFile) 1 else 0)
    }

    suspend fun batch(): List<BatchEntry> = connection.usePrepared(SyncSql.READ_BATCH) {
        buildList { while (it.step()) add(BatchEntry(it.getText(0), it.getLong(1) != 0L)) }
    }

    suspend fun stream(fileId: String): StreamState? = connection.usePrepared(SyncSql.READ_STREAM) {
        it.bindText(1, fileId)
        if (it.step()) it.streamState() else null
    }

    /** Up to [limit] streams that may have work, in the order of their file IDs, after [afterId]. */
    suspend fun streamPage(afterId: String, limit: Int): List<StreamState> = connection.usePrepared(SyncSql.STREAM_PAGE) {
        it.bindText(1, afterId)
        it.bindLong(2, limit.toLong())
        buildList { while (it.step()) add(it.streamState()) }
    }

    suspend fun putStream(stream: StreamState) = run(SyncSql.PUT_STREAM) {
        it.bindText(1, stream.fileId)
        it.bindLong(2, stream.length)
        it.bindTextOrNull(3, stream.hash)
        it.bindLong(4, if (stream.onServer) 1 else 0)
        it.bindLong(5, if (stream.here) 1 else 0)
        it.bindLong(6, if (stream.doesNotFit) 1 else 0)
        it.bindLong(7, if (stream.toDelete) 1 else 0)
        it.bindLongOrNull(8, stream.deletedNumber)
        it.bindLongOrNull(9, stream.wrongAt)
        it.bindLong(10, if (stream.toRemove) 1 else 0)
        it.bindLong(11, if (stream.recordDeleted) 1 else 0)
    }

    /** The streams whose copy on this phone is to be removed: sync took the deletion of their records. */
    suspend fun streamsToRemove(): List<StreamState> = connection.usePrepared(SyncSql.STREAMS_TO_REMOVE) {
        buildList { while (it.step()) add(it.streamState()) }
    }

    suspend fun removeStream(fileId: String) = run(SyncSql.REMOVE_STREAM) { it.bindText(1, fileId) }

    suspend fun forgetStreamsOnServer() = run(SyncSql.FORGET_STREAMS_ON_SERVER) {}

    suspend fun forgetDeletions() = run(SyncSql.FORGET_DELETIONS) {}

    private suspend fun run(sql: String, bind: (SQLiteStatement) -> Unit) {
        connection.usePrepared(sql) {
            bind(it)
            it.step()
        }
    }

    private suspend fun exists(sql: String, id: String): Boolean = connection.usePrepared(sql) {
        it.bindText(1, id)
        it.step()
    }

    private fun SQLiteStatement.streamState() = StreamState(
        fileId = getText(0),
        length = getLong(1),
        hash = textOrNull(2),
        onServer = getLong(3) != 0L,
        here = getLong(4) != 0L,
        doesNotFit = getLong(5) != 0L,
        toDelete = getLong(6) != 0L,
        deletedNumber = longOrNull(7),
        wrongAt = longOrNull(8),
        toRemove = getLong(9) != 0L,
        recordDeleted = getLong(10) != 0L,
    )

    private fun SQLiteStatement.textOrNull(column: Int): String? = if (isNull(column)) null else getText(column)

    private fun SQLiteStatement.longOrNull(column: Int): Long? = if (isNull(column)) null else getLong(column)

    private fun SQLiteStatement.bindTextOrNull(index: Int, value: String?) = if (value == null) bindNull(index) else bindText(index, value)

    private fun SQLiteStatement.bindLongOrNull(index: Int, value: Long?) = if (value == null) bindNull(index) else bindLong(index, value)
}
