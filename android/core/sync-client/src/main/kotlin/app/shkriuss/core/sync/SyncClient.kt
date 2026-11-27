package app.shkriuss.core.sync

import androidx.room3.RoomDatabase
import androidx.room3.withWriteTransaction
import app.shkriuss.core.crypto.BlobAnswer
import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.crypto.RecordKeyIds
import app.shkriuss.core.crypto.StreamHash
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.SyncTake
import app.shkriuss.core.data.timesAreWithinLimits
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * What the Sync app passes with every call of the courier interface: the
 * version it speaks, the server ID, the epoch, the device ID and the
 * server's current key ID (C), as it last learned them.
 */
class CourierCall(
    val version: Int,
    val serverId: SyncId,
    val epoch: SyncId,
    val deviceId: SyncId,
    val serverKeyId: KeyId,
) {
    override fun toString(): String = "CourierCall(version $version)"
}

/** Why a call was refused as a whole. Nothing was written. */
enum class Refusal {
    /** The call speaks a version of the courier interface this app does not know: "Update both apps". */
    UPDATE,

    /** Sync is off in this app on this phone. */
    OFF,

    /** The app's `record` keyset cannot be used now. The Sync app tries again later. */
    NOT_NOW,
}

/** Thrown by [SyncClient] when it refuses a call as a whole. */
class CourierRefused(val refusal: Refusal) : Exception("Refused: $refusal")

/** What `export` is asked for: ordinary changes or the records of a comparison, and the most it may give. */
class ExportRequest(val comparison: Boolean, val mostRecords: Int, val mostBytes: Int)

/** What `export` gives. */
sealed interface ExportResult {
    /** One batch, with the token that names it. */
    class Batch(val bytes: ByteArray, val token: Long) : ExportResult

    /** Nothing to send now. */
    data object NothingToSend : ExportResult
}

/** What `exported` did with the server's answer. */
enum class ExportedResult {
    /** The answer was taken. */
    TAKEN,

    /** The token is not the one of the last batch, or the answer is not the server's answer to it. Nothing changed. */
    IGNORED,
}

/** What `import` did with a page. */
sealed interface ImportResult {
    /** The page was taken: how many records were written, and the app's cursor now. */
    class Taken(val records: Int, val cursor: Long) : ImportResult

    /** The page did not check, and nothing was written. */
    data object Dropped : ImportResult
}

/** What `finishStream` found. */
enum class StreamFinish {
    /** The stream fits its length and hash, and is moved in. */
    STORED,

    /** It does not fit. Its bytes are deleted, and it is fetched again at most once a day. */
    WRONG,

    /** The app does not want this stream. Its bytes are deleted. */
    NOT_WANTED,
}

/**
 * Sync in one data app: everything the app does for the courier interface
 * (docs/architecture/sync-protocol.md, "The courier interface", "Sending
 * and fetching", "Conflict rules", "Files" and "A new recovery key"). The
 * app's content provider passes each call to the function of the same
 * name.
 *
 * Its state is in the `sync_` tables of [database], written in the same
 * transactions as the records. Every step is one transaction or can be
 * done twice, so a stop between any two steps loses nothing. It runs one
 * call at a time. It trusts nothing it is given: a page is checked as if
 * a hostile server had handed it over.
 *
 * [fetchFolder] is a folder of the app's own storage, never backed up,
 * where the streams that are being fetched wait until they are checked.
 */
class SyncClient(
    private val database: RoomDatabase,
    private val content: SyncContent,
    private val keys: SyncKeys,
    private val clock: Clock,
    private val fetchFolder: File,
) {
    private val oneAtATime = Mutex()

    /** Whether sync is on in this app on this phone. */
    suspend fun isOn(): Boolean = oneAtATime.withLock {
        database.withWriteTransaction { SyncStore(this).state(content.dataVersion).isOn }
    }

    /**
     * Turns sync on or off in this app on this phone. On and off are state
     * of this phone, not a record. When it is first turned on, the first
     * call of the Sync app starts a comparison of everything.
     */
    suspend fun setOn(on: Boolean) = oneAtATime.withLock {
        database.withWriteTransaction {
            val store = SyncStore(this)
            store.save(store.state(content.dataVersion).copy(isOn = on))
        }
    }

    /** `status`: where the app stands. */
    suspend fun status(call: CourierCall): SyncStatus = oneAtATime.withLock {
        finishPending()
        database.withWriteTransaction {
            val store = SyncStore(this)
            val begun = store.begin(call)
            val state = begun.state
            val on = state.isOn
            SyncStatus(
                courierVersion = SyncFormat.COURIER_VERSION,
                dataVersion = content.dataVersion,
                isOn = on,
                canSyncNow = begun.keyIds != null,
                epoch = state.epoch?.let(SyncId::ofHex),
                cursor = state.cursor,
                known = state.known,
                keyId = begun.keyIds?.current,
                comparison = when (state.comparison) {
                    Comparison.NONE -> ComparisonState.NONE
                    Comparison.FETCHING -> ComparisonState.FETCHING
                    Comparison.SENDING -> ComparisonState.SENDING
                },
                hasOrdinaryChanges = on && (store.countSend(SendKind.ORDINARY) > 0 || store.lastChangeNumber() > state.sendMark),
                hasComparisonRecords = on && store.countSend(SendKind.COMPARISON) > 0,
                hasStreamsToMove = on && store.hasStreamWork(),
                wantsFetch = on && begun.keyState == KeyState.FOLLOW,
                sendBlock = sendBlock(state, begun.keyState),
                counts = SyncCounts(
                    anotherRecoveryKey = state.skippedAnotherKey,
                    damaged = state.skippedDamaged,
                    newer = state.skippedNewer,
                    notValid = state.skippedNotValid,
                    tooLarge = state.tooLarge,
                    refusedByTheServer = state.refused,
                    wrongStreams = state.wrongStreams,
                ),
            )
        }
    }

    /** `compare`: starts a comparison of everything. */
    suspend fun compare(call: CourierCall) = oneAtATime.withLock {
        database.withWriteTransaction {
            val store = SyncStore(this)
            val state = store.begin(call).state
            if (!state.isOn) throw CourierRefused(Refusal.OFF)
            // The user asks to try everything again: a stop after the server refused the app's key is lifted too.
            val again = if (state.stopped == Stop.NEEDS_NEW_KEY) state.copy(stopped = Stop.NONE, stoppedKeyId = null) else state
            store.save(store.startComparison(again, forgetDeletions = false))
        }
    }

    /**
     * `export`: one batch of ordinary changes or of the records of a
     * comparison, at most [ExportRequest.mostRecords] records and, but for
     * one record alone, [ExportRequest.mostBytes] bytes of blobs. A new
     * export voids the token of the batch before.
     */
    suspend fun export(call: CourierCall, request: ExportRequest): ExportResult = oneAtATime.withLock {
        finishPending()
        database.withWriteTransaction {
            val store = SyncStore(this)
            val begun = store.begin(call)
            store.clearBatch()
            if (!begun.canSend) return@withWriteTransaction ExportResult.NothingToSend
            val kind = if (request.comparison) SendKind.COMPARISON else SendKind.ORDINARY
            val most = request.mostRecords.coerceIn(1, SyncFormat.MOST_RECORDS)
            var state = store.queueChanges(begun.state, kind, most)
            val built = store.buildBatch(state, kind, most, request.mostBytes.toLong(), KeyId(state.syncKeyId!!))
            state = built.state
            if (built.records.isEmpty()) {
                store.save(state)
                return@withWriteTransaction ExportResult.NothingToSend
            }
            val token = state.lastToken + 1
            built.records.forEachIndexed { index, record -> store.addBatch(index, record.id, record.deletedFile) }
            store.save(state.copy(lastToken = token))
            val bytes = BatchLayout.write(
                token = token,
                epoch = SyncId.ofHex(state.epoch!!)!!,
                cursor = state.cursor,
                known = state.known,
                comparison = request.comparison,
                records = built.records.map { BatchRecord(it.id, it.blob) },
            )
            ExportResult.Batch(bytes, token)
        }
    }

    /** `exported`: the server's answer to the batch that [token] names. */
    suspend fun exported(call: CourierCall, token: Long, answer: ByteArray): ExportedResult = oneAtATime.withLock {
        database.withWriteTransaction {
            val store = SyncStore(this)
            var state = store.begin(call).state
            if (!state.isOn || token != state.lastToken) return@withWriteTransaction ExportedResult.IGNORED
            val batch = store.batch()
            store.clearBatch()
            val sent = SendAnswer.read(answer, batch.size)
            if (batch.isEmpty() || sent == null || sent.epoch.hex != state.epoch) return@withWriteTransaction ExportedResult.IGNORED
            batch.zip(sent.outcomes).forEach { (entry, outcome) -> state = store.applyOutcome(state, entry, outcome, call.serverKeyId) }
            state = state.copy(
                known = maxOf(state.known, sent.headAfter),
                cursor = if (sent.headBefore == state.cursor) sent.headAfter else state.cursor,
            )
            store.save(store.endComparisonIfDone(state))
            ExportedResult.TAKEN
        }
    }

    /**
     * `import`: one page from the server. The page is checked first, then
     * every record goes through the reader's checks and the conflict rules,
     * and the cursor moves to its Through, all in one transaction.
     */
    suspend fun import(call: CourierCall, page: ByteArray): ImportResult = oneAtATime.withLock {
        finishPending()
        val result = database.withWriteTransaction {
            val store = SyncStore(this)
            val begun = store.begin(call)
            if (!begun.state.isOn) throw CourierRefused(Refusal.OFF)
            if (begun.keyIds == null) throw CourierRefused(Refusal.NOT_NOW)
            val read = Page.read(page)
            if (read == null || read.epoch.hex != begun.state.epoch || read.since != begun.state.cursor) {
                return@withWriteTransaction ImportResult.Dropped
            }
            var state = begun.state
            var taken = 0
            read.records.forEach { record ->
                val step = store.takeOne(state, begun, record)
                state = step.state
                if (step.taken) taken++
            }
            state = state.copy(cursor = read.through, known = maxOf(state.known, read.through))
            if (!read.more) {
                state = state.copy(afterImportDue = true)
                if (begun.keyState == KeyState.FOLLOW) {
                    // The last fetch before the new key ended: from now on the app syncs with it, seals its file keys
                    // again under it, and compares everything.
                    val switched = state.copy(syncKeyId = begun.keyIds.current.value, stopped = Stop.NONE, stoppedKeyId = null, sealFileKeys = true)
                    state = store.startComparison(switched, forgetDeletions = false)
                } else if (state.comparison == Comparison.FETCHING) {
                    state = store.finishFetching(state)
                }
            }
            store.save(state)
            ImportResult.Taken(taken, state.cursor)
        }
        finishPending()
        result
    }

    /**
     * What an import leaves to do once its transaction has ended, each
     * marked in the state of sync until it is done: the copies of streams
     * whose records came deleted, the new seal of the file keys after a
     * new recovery key, and the alarms after the last page. It runs at
     * the start of the next calls too, so that a stop after a commit only
     * makes a later call do it.
     */
    private suspend fun finishPending() {
        val (state, toRemove) = database.withWriteTransaction {
            val store = SyncStore(this)
            store.state(content.dataVersion) to store.streamsToRemove()
        }
        toRemove.forEach { stream ->
            // The app's own writes go on beside sync: a restore may have brought the record back since the commit.
            val stillDeleted = database.withWriteTransaction { content.find(stream.fileId)?.isDeleted != false }
            if (stillDeleted) content.removeStream(stream.fileId)
            database.withWriteTransaction {
                val store = SyncStore(this)
                store.stream(stream.fileId)?.let { store.putStream(it.copy(toRemove = false, here = !stillDeleted && it.here, recordDeleted = stillDeleted)) }
            }
        }
        if (state.sealFileKeys) {
            content.sealFileKeysAgain()
            database.withWriteTransaction {
                val store = SyncStore(this)
                store.save(store.state(content.dataVersion).copy(sealFileKeys = false))
            }
        }
        if (state.afterImportDue) {
            content.afterImport()
            database.withWriteTransaction {
                val store = SyncStore(this)
                store.save(store.state(content.dataVersion).copy(afterImportDue = false))
            }
        }
    }

    /**
     * `streams`: writes the streams the app wants sent, fetched and
     * deleted into [into], in the layout of "What `streams` gives". The
     * hash of a stream to send is computed when it is first needed, and
     * kept.
     */
    suspend fun streams(call: CourierCall, into: OutputStream) = oneAtATime.withLock {
        finishPending()
        val on = database.withWriteTransaction { SyncStore(this).begin(call).state.isOn }
        val writer = StreamListWriter(into)
        if (!on) return@withLock
        var afterId = ""
        while (true) {
            val page = database.withWriteTransaction {
                val store = SyncStore(this)
                store.streamPage(afterId, STREAM_PAGE).map { it to store.workFor(it) }
            }
            if (page.isEmpty()) break
            page.forEach { (stream, work) ->
                afterId = stream.fileId
                listed(stream, work)?.let(writer::write)
            }
        }
    }

    /** `readStream`: the stored stream of [fileId], or null if the app does not want it sent. */
    suspend fun readStream(call: CourierCall, fileId: String): InputStream? = oneAtATime.withLock {
        val wanted = database.withWriteTransaction {
            val store = SyncStore(this)
            if (!store.begin(call).state.isOn) return@withWriteTransaction false
            store.stream(fileId)?.let { store.workFor(it) } == StreamWork.SEND
        }
        if (wanted) content.openStream(fileId) else null
    }

    /**
     * `streamSent`: every chunk of the stream [fileId] with [hash] is on
     * the server, or, when [fits] is false, the stream on this phone did
     * not fit its hash, and nothing of it was sent. The app then wants it
     * fetched.
     */
    suspend fun streamSent(call: CourierCall, fileId: String, hash: ByteArray, fits: Boolean) = oneAtATime.withLock {
        database.withWriteTransaction {
            val store = SyncStore(this)
            if (!store.begin(call).state.isOn) return@withWriteTransaction
            val stream = store.stream(fileId) ?: return@withWriteTransaction
            if (stream.hash != Hex.of(hash)) return@withWriteTransaction
            store.putStream(if (fits) stream.copy(onServer = true, here = true) else stream.copy(onServer = false, here = false, doesNotFit = true))
        }
    }

    /**
     * `writeStream`: where the Sync app writes the rest of the stream
     * [fileId], from byte [bytesHere] on. Null if the app does not want it,
     * or if fewer bytes are here. The stream refuses any byte past the
     * length the file's record names.
     */
    suspend fun writeStream(call: CourierCall, fileId: String, bytesHere: Long): OutputStream? = oneAtATime.withLock {
        val stream = database.withWriteTransaction<StreamState?> {
            val store = SyncStore(this)
            if (!store.begin(call).state.isOn) return@withWriteTransaction null
            store.stream(fileId)?.takeIf { store.workFor(it) == StreamWork.FETCH }
        } ?: return@withLock null
        val part = partFile(fileId)
        if (bytesHere < 0 || bytesHere > stream.length || bytesHere > (if (part.exists()) part.length() else 0L)) return@withLock null
        fetchFolder.mkdirs()
        RandomAccessFile(part, "rw").use { it.setLength(bytesHere) }
        BoundedOutputStream(FileOutputStream(part, true), stream.length - bytesHere)
    }

    /** `finishStream`: checks the fetched stream [fileId] and moves it in if it fits. */
    suspend fun finishStream(call: CourierCall, fileId: String): StreamFinish = oneAtATime.withLock {
        val stream = database.withWriteTransaction<StreamState?> {
            val store = SyncStore(this)
            if (!store.begin(call).state.isOn) return@withWriteTransaction null
            store.stream(fileId)?.takeIf { store.workFor(it) == StreamWork.FETCH }
        }
        val part = partFile(fileId)
        if (stream == null) {
            part.delete()
            return@withLock StreamFinish.NOT_WANTED
        }
        val fits = part.isFile && part.length() == stream.length && FileInputStream(part).use(::sha256) == stream.hash
        if (fits) content.moveStreamIn(fileId, part) else part.delete()
        database.withWriteTransaction {
            val store = SyncStore(this)
            val now = store.stream(fileId) ?: return@withWriteTransaction
            if (fits) {
                store.putStream(now.copy(onServer = true, here = true, doesNotFit = false, wrongAt = null))
            } else {
                store.putStream(now.copy(wrongAt = clock.nowMillis()))
                val state = store.state(content.dataVersion)
                store.save(state.copy(wrongStreams = state.wrongStreams + 1))
            }
        }
        if (fits) StreamFinish.STORED else StreamFinish.WRONG
    }

    /** `streamDeleted`: the server answered the deletion of the chunks of [fileId]. */
    suspend fun streamDeleted(call: CourierCall, fileId: String) = oneAtATime.withLock {
        database.withWriteTransaction {
            val store = SyncStore(this)
            if (!store.begin(call).state.isOn) return@withWriteTransaction
            val stream = store.stream(fileId) ?: return@withWriteTransaction
            // The row stays, with the stream's hash, for a record that is brought back later.
            val record = content.find(fileId)
            if (record == null) {
                store.removeStream(fileId)
            } else {
                store.putStream(stream.copy(toDelete = false, deletedNumber = null))
            }
        }
    }

    // The steps of the calls. Each runs inside the transaction of its call.

    /** Where the key IDs P, S and C leave the app (docs/architecture/sync-protocol.md, "In every data app, on every device"). */
    private enum class KeyState {
        /** The app has no `record` keyset it can use now. */
        NO_KEYS,

        /** P, S and C are the same. The app sends. */
        SAME,

        /** P is a new key and C is P: one last fetch, then the app syncs with P. */
        FOLLOW,

        /** P is a new key and C is still S: the server has not taken it yet. */
        WAIT,

        /** C is a key the app does not hold. */
        NOT_HELD,

        /** C is an older key that the app holds. */
        OLDER,
    }

    /** What a call starts from: the state of sync, the key IDs of the app, where they leave it, and C. */
    private class Begun(val state: SyncState, val keyIds: RecordKeyIds?, val keyState: KeyState, val serverKeyId: KeyId) {
        /** An app sends only while sync is on, P, S and C are the same, and nothing stopped it. */
        val canSend: Boolean get() = state.isOn && keyState == KeyState.SAME && state.stopped == Stop.NONE
    }

    /**
     * Reads the state of sync, and brings it up to date with the call: a
     * version of the courier interface this app does not know is refused;
     * an update of the app looks again at what was skipped as newer;
     * another server ID, epoch or device ID starts a comparison of
     * everything; S is set the first time the app can sync.
     */
    private suspend fun SyncStore.begin(call: CourierCall): Begun {
        if (call.version != SyncFormat.COURIER_VERSION) throw CourierRefused(Refusal.UPDATE)
        var state = state(content.dataVersion)
        val keyIds = keyIdsNow()
        if (!state.isOn) return Begun(state, keyIds, keyStateOf(state, keyIds, call), call.serverKeyId)
        if (content.dataVersion > state.dataVersion || SyncFormat.PLAINTEXT_VERSION > state.plaintextVersion) {
            // The app was updated: what was skipped as newer may open now.
            val back = state.skippedFrom?.let { minOf(state.cursor, it - 1) } ?: state.cursor
            state = state.copy(
                countedThrough = maxOf(state.countedThrough, state.cursor),
                dataVersion = maxOf(state.dataVersion, content.dataVersion),
                plaintextVersion = maxOf(state.plaintextVersion, SyncFormat.PLAINTEXT_VERSION),
                stopped = if (state.stopped == Stop.NEWER) Stop.NONE else state.stopped,
                cursor = back,
                skippedFrom = null,
                skippedNewer = 0,
            )
        }
        if (state.serverId != call.serverId.hex || state.epoch != call.epoch.hex || state.deviceId != call.deviceId.hex) {
            // Another server, another life of its database, or another device: a refusal of the app's key belonged to
            // the one before.
            val stopped = if (state.stopped == Stop.NEEDS_NEW_KEY) Stop.NONE else state.stopped
            val moved = state.copy(
                serverId = call.serverId.hex,
                epoch = call.epoch.hex,
                deviceId = call.deviceId.hex,
                stopped = stopped,
                stoppedKeyId = if (stopped == Stop.NONE) null else state.stoppedKeyId,
            )
            state = startComparison(moved, forgetDeletions = true)
        }
        if (keyIds != null && state.syncKeyId == null && call.serverKeyId == keyIds.current) {
            // The first time the app can sync: it syncs with its current key. What it skipped before is fetched again.
            state = state.copy(syncKeyId = keyIds.current.value)
            if (state.skippedFrom != null) state = startComparison(state, forgetDeletions = false)
        }
        if (state.stopped == Stop.NEEDS_NEW_KEY && state.stoppedKeyId != call.serverKeyId.value) {
            // The server refused the app's key while the Sync app named another key of the server's. It names
            // another now: the key state below decides again.
            state = state.copy(stopped = Stop.NONE, stoppedKeyId = null)
        }
        state = endComparisonIfDone(state)
        save(state)
        return Begun(state, keyIds, keyStateOf(state, keyIds, call), call.serverKeyId)
    }

    private fun keyIdsNow(): RecordKeyIds? = try {
        keys.keyIds()
    } catch (_: BlobException) {
        null
    }

    private fun keyStateOf(state: SyncState, keyIds: RecordKeyIds?, call: CourierCall): KeyState {
        if (keyIds == null) return KeyState.NO_KEYS
        val p = keyIds.current
        val s = state.syncKeyId?.let(::KeyId)
        val c = call.serverKeyId
        return when {
            c !in keyIds.all -> KeyState.NOT_HELD
            p == s && s == c -> KeyState.SAME
            s != null && p != s && c == p -> KeyState.FOLLOW
            s != null && p != s && c == s -> KeyState.WAIT
            else -> KeyState.OLDER
        }
    }

    private fun sendBlock(state: SyncState, keyState: KeyState): SendBlock = when {
        state.stopped == Stop.NEWER -> SendBlock.UPDATE_THE_APP
        keyState == KeyState.NOT_HELD || state.stopped == Stop.NEEDS_NEW_KEY -> SendBlock.ENTER_THE_NEW_RECOVERY_KEY
        keyState == KeyState.WAIT -> SendBlock.WAITS_FOR_THE_SERVER
        keyState == KeyState.OLDER -> SendBlock.SERVER_NAMES_AN_OLDER_KEY
        else -> SendBlock.NONE
    }

    /**
     * Starts a comparison of everything: the cursor and Known are 0, no ID
     * is seen yet, and no stream is known to be on the server. Every
     * record stored now is looked at by the comparison, so the send mark
     * moves past them. Local changes made from now on are "ordinary".
     * After another server or epoch, the numbers of deleted files mean
     * nothing there, and are forgotten too.
     */
    private suspend fun SyncStore.startComparison(state: SyncState, forgetDeletions: Boolean): SyncState {
        val mark = maxOf(state.sendMark, lastChangeNumber())
        clearSeen()
        unsendAll(SendKind.COMPARISON)
        clearBatch()
        forgetStreamsOnServer()
        dropTakenUpTo(mark)
        if (forgetDeletions) forgetDeletions()
        return state.copy(
            cursor = 0,
            known = 0,
            countedThrough = 0,
            sendMark = mark,
            comparison = Comparison.FETCHING,
            skippedFrom = null,
            skippedAnotherKey = 0,
            skippedDamaged = 0,
            skippedNewer = 0,
            skippedNotValid = 0,
        )
    }

    /** The page that says that no more wait ends the fetching: every stored record that was not seen goes out. */
    private suspend fun SyncStore.finishFetching(state: SyncState): SyncState {
        var after = 0L
        do {
            val changes = content.changesSince(after, CHANGE_PAGE)
            changes.forEach { change ->
                if (!isSeen(change.id)) sendComparison(change.id, change.changeNumber)
                after = change.changeNumber
            }
        } while (changes.size == CHANGE_PAGE)
        clearSeen()
        return endComparisonIfDone(state.copy(comparison = Comparison.SENDING))
    }

    private suspend fun SyncStore.endComparisonIfDone(state: SyncState): SyncState =
        if (state.comparison == Comparison.SENDING && countSend(SendKind.COMPARISON) == 0L) state.copy(comparison = Comparison.NONE) else state

    /**
     * Step 1 of `export`: every change above the send mark that did not
     * come from sync goes into **To send** as "ordinary", until there are
     * enough for a batch or no change is left.
     */
    private suspend fun SyncStore.queueChanges(state: SyncState, kind: SendKind, most: Int): SyncState {
        var mark = state.sendMark
        do {
            val changes = content.changesSince(mark, CHANGE_PAGE)
            changes.forEach { change ->
                if (takenNumber(change.id) != change.changeNumber) sendOrdinary(change.id, change.changeNumber)
                mark = change.changeNumber
            }
            val enough = kind == SendKind.ORDINARY && countSend(SendKind.ORDINARY) >= most
        } while (changes.size == CHANGE_PAGE && !enough)
        dropTakenUpTo(mark)
        return state.copy(sendMark = mark)
    }

    /** One record that goes into a batch. */
    private class Built(val id: String, val blob: ByteArray, val deletedFile: Boolean)

    private class BuiltBatch(val records: List<Built>, val state: SyncState)

    /** Steps 3 to 5 of `export`: the batch from **To send**, without the records that are held back or too large. */
    private suspend fun SyncStore.buildBatch(start: SyncState, kind: SendKind, most: Int, mostBytes: Long, syncKeyId: KeyId): BuiltBatch {
        var state = start
        val records = mutableListOf<Built>()
        var bytes = 0L
        var afterPosition = Long.MIN_VALUE
        var afterId = ""
        while (records.size < most) {
            val page = sendPage(kind, afterPosition, afterId, SEND_PAGE)
            if (page.isEmpty()) break
            for ((id, position) in page) {
                afterPosition = position
                afterId = id
                val record = content.find(id)
                if (record == null) {
                    unsend(id)
                    continue
                }
                val stream = sendableStream(record, syncKeyId) ?: continue
                val plaintext = SealedPlaintext.encode(content.dataVersion, record.entry, stream.part)
                val size = plaintext.size.toLong() + SyncFormat.SEALED_OVERHEAD
                if (size > SyncFormat.LARGEST_SEALED) {
                    unsend(id)
                    state = state.copy(tooLarge = state.tooLarge + 1)
                    continue
                }
                if (records.isNotEmpty() && bytes + size > mostBytes) return BuiltBatch(records, state)
                records += Built(id, seal(id, plaintext), record.isFile && record.isDeleted)
                bytes += size
                if (records.size >= most) break
            }
        }
        return BuiltBatch(records, state)
    }

    /** A record that may go, with its stream part. */
    private class Sendable(val part: StreamPart?)

    /**
     * Step 4 of `export`: null if [record] is held back, else what its
     * plaintext needs. Held back are a deleted record that is not wiped
     * yet in an app that wipes, every file's record while a file key is
     * sealed by a key that exists only on this phone, a file's record
     * whose wrapped key does not name [syncKeyId], and the record of a
     * file that is not deleted whose stream the server is not known to
     * have. The stream of a file's record is
     * listed from the first look on, so that it can go up while the
     * record waits for another reason.
     */
    private suspend fun SyncStore.sendableStream(record: SyncRecord, syncKeyId: KeyId): Sendable? {
        if (content.wipes && record.isDeleted && !record.wiped) return null
        val part = record.streamLength?.let { length ->
            // A deleted file needs no stream on the server, only the hash that its plaintext names.
            if (record.isDeleted) return@let StreamPart(length, storedStreamHash(record) ?: return null)
            val stream = stream(record.id)
            if (stream == null) {
                putStream(StreamState.of(record.id, length, here = content.hasStream(record.id, length)))
                return null
            }
            // A record that was deleted is live again: its stream may have work.
            if (stream.recordDeleted && !record.isDeleted) putStream(stream.copy(recordDeleted = false))
            val hash = stream.hash?.let(Hex::parse)
            if (!stream.onServer || hash == null) return null
            StreamPart(length, hash)
        }
        if (record.isFile && content.fileKeysOnlyOnThisPhone()) return null
        if (record.wrappedKeyId != null && record.wrappedKeyId != syncKeyId) return null
        return Sendable(part)
    }

    private fun seal(id: String, plaintext: ByteArray): ByteArray = try {
        keys.seal(id, plaintext)
    } catch (_: BlobException) {
        throw CourierRefused(Refusal.NOT_NOW)
    }

    /** One result of the server's answer to a batch ("`exported`", points 1 to 5). */
    private suspend fun SyncStore.applyOutcome(state: SyncState, entry: BatchEntry, outcome: SendOutcome, serverKeyId: KeyId): SyncState {
        val id = entry.recordId
        when (outcome.result) {
            SendResult.STORED, SendResult.STORED_SEND_STREAM_AGAIN -> {
                unsend(id)
                val stream = stream(id)
                if (entry.deletedFile) {
                    val known = stream ?: StreamState.of(id, 0, here = false)
                    putStream(known.copy(toDelete = true, deletedNumber = outcome.number))
                } else if (outcome.result == SendResult.STORED_SEND_STREAM_AGAIN && stream != null) {
                    putStream(stream.copy(onServer = false))
                }
            }
            SendResult.CHANGED_AFTER_CURSOR -> stream(id)?.let { putStream(it.copy(onServer = false)) }
            SendResult.ANOTHER_KEY_ID -> return state.copy(stopped = Stop.NEEDS_NEW_KEY, stoppedKeyId = serverKeyId.value)
            SendResult.NOT_A_SEALED_RECORD -> {
                unsend(id)
                return state.copy(refused = state.refused + 1)
            }
            SendResult.CHUNKS_BEING_DELETED -> Unit
        }
        return state
    }

    private class Step(val state: SyncState, val taken: Boolean)

    /** One record of a page: "What a reader checks", then the conflict rules. */
    private suspend fun SyncStore.takeOne(state: SyncState, begun: Begun, came: PageRecord): Step {
        val keyIds = begun.keyIds!!
        val syncKeyId = state.syncKeyId?.let(::KeyId)
        val named = keyIdOf(came.blob)
        val allowed = named == syncKeyId || (begun.keyState == KeyState.FOLLOW && named == keyIds.current)
        val syncsWithServersKey = syncKeyId != null && syncKeyId == begun.serverKeyId
        if (named != null && !allowed) return Step(anotherKey(state, came, syncsWithServersKey), false)
        val plaintext = try {
            keys.open(came.id, came.blob)
        } catch (refused: BlobException) {
            return when (refused.answer) {
                BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW -> throw CourierRefused(Refusal.NOT_NOW)
                BlobAnswer.NEEDS_ANOTHER_RECOVERY_KEY -> Step(anotherKey(state, came, syncsWithServersKey), false)
                // Every other blob that does not open is damaged (point 3). That holds also for a blob whose own
                // header names a newer version: the header is read before Tink checks anything, so a server can
                // change it. Only the version inside the plaintext says "newer" (point 4).
                else -> Step(damaged(state, came), false)
            }
        }
        val whole = when (val decoded = SealedPlaintext.decode(plaintext, content.dataVersion)) {
            SealedPlaintext.Decoded.Newer -> return Step(newer(state, came), false)
            SealedPlaintext.Decoded.NotValid -> return Step(notValid(state, came), false)
            is SealedPlaintext.Decoded.Whole -> decoded
        }
        val fields = whole.entry.fields
        if (fields.id != came.id || !fields.timesAreWithinLimits) return Step(notValid(state, came), false)
        val record = content.read(whole.dataVersion, whole.entry) ?: return Step(notValid(state, came), false)
        val stream = whole.stream
        val streamFits = if (stream == null) record.streamLength == null else record.streamLength == stream.length
        if (record.entry.fields != fields || !streamFits) return Step(notValid(state, came), false)

        removeDamaged(came.id)
        val stored = content.find(came.id)
        val storedHash = stored?.let { storedStreamHash(it) }
        val taken = content.take(record) { kept, arrived ->
            SyncOrder.tie(
                stored = kept,
                came = arrived,
                syncKeyId = syncKeyId,
                storedPlaintext = plaintextOf(kept, storedHash),
                camePlaintext = plaintextOf(arrived, stream?.hash),
            )
        }
        val fetching = state.comparison == Comparison.FETCHING
        // Conflict rules, point 8: after a tie with a record sealed in a lower data version, the winner goes out
        // sealed in this app's own version.
        val tieWithOlder = whole.dataVersion < content.dataVersion && stored?.entry?.fields?.updatedAt == fields.updatedAt
        when (taken.answer) {
            SyncTake.TAKEN -> {
                if (tieWithOlder) {
                    sendOrdinary(came.id, taken.changeNumber)
                } else {
                    putTaken(came.id, taken.changeNumber)
                    unsend(came.id)
                }
                if (fetching) addSeen(came.id)
                tookFile(record, stream)
            }
            SyncTake.SAME -> {
                unsend(came.id)
                if (fetching) addSeen(came.id)
            }
            SyncTake.STORED_WINS -> {
                sendOrdinary(came.id, taken.changeNumber)
                if (record.isDeleted && stored != null && stored.isFile && !stored.isDeleted) {
                    stream(came.id)?.let { putStream(it.copy(onServer = false)) }
                }
            }
        }
        return Step(state, taken.answer == SyncTake.TAKEN)
    }

    /** What sync keeps of a file's record that it took. */
    private suspend fun SyncStore.tookFile(record: SyncRecord, part: StreamPart?) {
        if (!record.isFile) return
        val stream = stream(record.id)
        if (record.isDeleted) {
            // Every device removes its own copy of the stream when it takes the deleted record, wiped or not: once
            // this transaction has ended (finishPending). The row keeps the stream's hash for a record brought back.
            val known = stream ?: StreamState.of(record.id, part?.length ?: 0, here = false)
            putStream(known.copy(hash = part?.let { Hex.of(it.hash) } ?: known.hash, toRemove = true))
            return
        }
        if (part != null) {
            val hash = Hex.of(part.hash)
            val doesNotFit = (stream?.hash != null && stream.hash != hash) || (stream?.doesNotFit == true && stream.hash == hash)
            putStream(
                StreamState(
                    fileId = record.id,
                    length = part.length,
                    hash = hash,
                    onServer = true,
                    here = !doesNotFit && content.hasStream(record.id, part.length),
                    doesNotFit = doesNotFit,
                    toDelete = false,
                    deletedNumber = null,
                    wrongAt = stream?.wrongAt,
                    toRemove = false,
                    recordDeleted = false,
                ),
            )
        }
    }

    private suspend fun SyncStore.anotherKey(state: SyncState, came: PageRecord, syncsWithServersKey: Boolean): SyncState {
        // An app that syncs with the server's current key answers with its own version, sealed with that key.
        if (syncsWithServersKey) content.find(came.id)?.let { sendOrdinary(came.id, it.changeNumber) }
        return state.copy(skippedAnotherKey = state.skippedAnotherKey + counted(state, came), skippedFrom = lowest(state.skippedFrom, came.number))
    }

    private suspend fun SyncStore.damaged(state: SyncState, came: PageRecord): SyncState {
        // Its own version answers a damaged one, once, until a version of the record opens.
        val stored = content.find(came.id)
        if (stored != null && !isDamaged(came.id)) {
            sendOrdinary(came.id, stored.changeNumber)
            addDamaged(came.id)
        }
        return state.copy(skippedDamaged = state.skippedDamaged + counted(state, came))
    }

    private fun newer(state: SyncState, came: PageRecord): SyncState = state.copy(
        skippedNewer = state.skippedNewer + 1,
        skippedFrom = lowest(state.skippedFrom, came.number),
        stopped = Stop.NEWER,
    )

    private fun notValid(state: SyncState, came: PageRecord): SyncState = state.copy(skippedNotValid = state.skippedNotValid + counted(state, came))

    /**
     * 1 for a skipped record that was not counted before, else 0. An update
     * moves the cursor back, and a record at or below the cursor of before
     * was counted when it was first skipped. The count of "newer" starts
     * again at the update, so it counts every such record once more.
     */
    private fun counted(state: SyncState, came: PageRecord): Long = if (came.number > state.countedThrough) 1 else 0

    private fun lowest(first: Long?, second: Long): Long = if (first == null) second else minOf(first, second)

    /** The key ID in bytes 6 to 9 of a sealed record, or null for one too short to name one. */
    private fun keyIdOf(blob: ByteArray): KeyId? {
        if (blob.size < SyncFormat.KEY_ID_OFFSET + 4) return null
        val reader = ByteReader(blob, SyncFormat.KEY_ID_OFFSET)
        return KeyId(reader.i32())
    }

    private fun plaintextOf(record: SyncRecord, hash: ByteArray?): ByteArray =
        SealedPlaintext.encode(content.dataVersion, record.entry, record.streamLength?.let { StreamPart(it, hash ?: NO_HASH) })

    /**
     * The hash of a stored file's stream, for the order of ties: the one
     * sync keeps, or computed from the stored stream and then kept. Null
     * for a record without a stream, or one whose stream is not here and
     * was never hashed.
     */
    private suspend fun SyncStore.storedStreamHash(record: SyncRecord): ByteArray? {
        val length = record.streamLength ?: return null
        val stream = stream(record.id)
        stream?.hash?.let { return Hex.parse(it) }
        if (!content.hasStream(record.id, length)) return null
        val hash = content.openStream(record.id).use(::sha256)
        putStream((stream ?: StreamState.of(record.id, length, here = true)).copy(hash = hash))
        return Hex.parse(hash)
    }

    /**
     * What the Sync app is to do with [stream] now, or null for nothing. It
     * keeps what it finds: whether the stream is here, and whether its
     * record is deleted, which leaves the stream out of later looks until
     * the record is live again. The row of a deleted record stays, with
     * the stream's hash, for a record that is brought back.
     */
    private suspend fun SyncStore.workFor(stream: StreamState): StreamWork? {
        if (stream.toDelete) return StreamWork.DELETE
        val record = content.find(stream.fileId)
        if (record == null) {
            removeStream(stream.fileId)
            return null
        }
        val length = record.streamLength
        if (record.isDeleted || length == null) {
            if (!stream.recordDeleted && !stream.toRemove) putStream(stream.copy(recordDeleted = true))
            return null
        }
        val here = !stream.doesNotFit && content.hasStream(stream.fileId, length)
        if (here != stream.here || stream.recordDeleted) putStream(stream.copy(here = here, recordDeleted = false))
        if (here) return if (stream.onServer) null else StreamWork.SEND
        val wrongToday = stream.wrongAt != null && clock.nowMillis() - stream.wrongAt < DAY_MILLIS
        return if (stream.hash != null && !wrongToday) StreamWork.FETCH else null
    }

    /** True if some stream has work now. */
    private suspend fun SyncStore.hasStreamWork(): Boolean {
        var afterId = ""
        while (true) {
            val page = streamPage(afterId, STREAM_PAGE)
            if (page.isEmpty()) return false
            page.forEach { stream ->
                afterId = stream.fileId
                if (workFor(stream) != null) return true
            }
        }
    }

    /** One entry of `streams`, with the hash of a stream to send computed and kept if it was not yet. */
    private suspend fun listed(stream: StreamState, work: StreamWork?): ListedStream? = when (work) {
        null -> null
        StreamWork.DELETE -> ListedStream(work, stream.fileId, NO_HASH, 0, 0, stream.deletedNumber ?: 0)
        StreamWork.FETCH -> {
            val part = partFile(stream.fileId)
            val here = if (part.isFile) part.length().coerceAtMost(stream.length) else 0L
            ListedStream(work, stream.fileId, Hex.parse(stream.hash!!)!!, stream.length, here, 0)
        }
        StreamWork.SEND -> {
            val hash = stream.hash ?: hashAndKeep(stream)
            hash?.let { ListedStream(work, stream.fileId, Hex.parse(it)!!, stream.length, 0, 0) }
        }
    }

    /** Hashes a stored stream outside any transaction, and keeps the hash. */
    private suspend fun hashAndKeep(stream: StreamState): String? {
        val hash = try {
            content.openStream(stream.fileId).use(::sha256)
        } catch (_: IOException) {
            return null
        }
        database.withWriteTransaction {
            val store = SyncStore(this)
            store.stream(stream.fileId)?.takeIf { it.hash == null }?.let { store.putStream(it.copy(hash = hash)) }
        }
        return hash
    }

    private fun partFile(fileId: String): File = File(fetchFolder, RecordIds.toText(RecordIds.toBytes(fileId)))

    private companion object {
        const val CHANGE_PAGE = 500
        const val SEND_PAGE = 200
        const val STREAM_PAGE = 200
        const val DAY_MILLIS = 24L * 60 * 60 * 1000
        val NO_HASH = ByteArray(SyncFormat.HASH_BYTES)

        /** The SHA-256 of everything [input] holds, in hex. */
        fun sha256(input: InputStream): String = Hex.of(StreamHash.of(input))
    }
}

/** An output stream that takes at most [room] bytes, and refuses the first byte past them. */
private class BoundedOutputStream(private val out: OutputStream, private var room: Long) : OutputStream() {
    override fun write(byte: Int) {
        if (room < 1) throw IOException("More bytes than the stream's length")
        out.write(byte)
        room--
    }

    override fun write(buffer: ByteArray, offset: Int, count: Int) {
        if (count > room) throw IOException("More bytes than the stream's length")
        out.write(buffer, offset, count)
        room -= count
    }

    override fun flush() = out.flush()

    override fun close() = out.close()
}
