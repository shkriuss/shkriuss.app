package app.shkriuss.feature.sync

import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.DeviceKeyGoneException
import app.shkriuss.core.crypto.NameKeyState
import app.shkriuss.core.crypto.StreamHash
import app.shkriuss.core.crypto.SyncKeys
import app.shkriuss.core.data.Clock
import app.shkriuss.core.security.CourierApp
import app.shkriuss.core.sync.ComparisonState
import app.shkriuss.core.sync.ExportedResult
import app.shkriuss.core.sync.ListedStream
import app.shkriuss.core.sync.Refusal
import app.shkriuss.core.sync.SendBlock
import app.shkriuss.core.sync.SendResult
import app.shkriuss.core.sync.StreamWork
import app.shkriuss.core.sync.SyncId
import app.shkriuss.core.sync.SyncStatus
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** Whether the phone's network is metered now. Tests pass their own. */
fun interface NetworkState {
    /** True on a metered network, and when the phone has no network at all. */
    fun isMetered(): Boolean
}

/** What a run does now, for the row of an app on Apps (docs/apps/sync/spec.md, "Apps", point 5). */
enum class RunStep {
    FETCHING,
    SENDING,
    COMPARING,
    SENDING_FILES,
    FETCHING_FILES,
}

/** The app a run serves now, what it does, and for files how far it got: [done] of [total] bytes. */
data class RunProgress(val app: String, val step: RunStep, val done: Long = 0, val total: Long = 0)

/** How a run ended. */
enum class RunEnd {
    /** This phone has not joined, or sync stopped: nothing ran. */
    NOT_JOINED,

    /** A wait holds: the day's limit, or the 4 hours after three failed runs. No request was made. */
    WAITING,

    /** Every request passed. */
    WORKED,

    /** It ended early: the server could not be reached, refused, or a problem holds. The state says which. */
    ENDED,
}

/**
 * One run (docs/architecture/sync-protocol.md, "When the Sync app runs";
 * docs/apps/sync/spec.md, "When Sync runs" and "Problems"). It asks for
 * `heads`, then serves every data app that needs it, in turn: the fetch
 * and the ordinary batches first, then streams, then the batches of a
 * comparison of everything. Every step can stop and go on: the next run
 * continues where this one ended.
 *
 * One run at a time. Nothing that passes through it is stored: batches,
 * pages and chunks stay in memory and pipes.
 */
class SyncRun(
    private val store: SyncStateStore,
    private val server: SyncServer,
    private val couriers: Couriers,
    private val keys: SyncKeys,
    private val network: NetworkState,
    private val problems: ProblemWriter,
    private val clock: Clock,
) {
    private val oneAtATime = Mutex()
    private val progress = MutableStateFlow<RunProgress?>(null)
    private val going = MutableStateFlow(false)

    /** True while a run goes. */
    val isRunning: StateFlow<Boolean> = going.asStateFlow()

    /** What the run does now, or null between the apps and when no run goes. */
    val now: StateFlow<RunProgress?> = progress.asStateFlow()

    /**
     * One run. [asked] is true for **Sync now** and **Try again**: it
     * skips the 4-hour wait and tries sending on a full server. The run
     * asks [stopped] before each request and each courier call, and ends
     * there when Android stopped its job.
     */
    suspend fun run(asked: Boolean, stopped: () -> Boolean = { false }): RunEnd = oneAtATime.withLock {
        withContext(Dispatchers.IO) {
            going.value = true
            try {
                runLocked(asked, stopped)
            } finally {
                progress.value = null
                going.value = false
            }
        }
    }

    private fun runLocked(asked: Boolean, stopped: () -> Boolean): RunEnd {
        if (stopped() || store.now().stage != Stage.JOINED) return RunEnd.NOT_JOINED
        val now = clock.nowMillis()
        val state = try {
            store.update { it.withWaitsOver(now) }
        } catch (_: CouldNotSaveException) {
            return RunEnd.ENDED
        }
        if (state.dayWait == DayWait.EVERYTHING) return RunEnd.WAITING
        if (state.failedRuns >= SyncState.MOST_FAILED_RUNS && state.retryAt != null && now < state.retryAt && !asked) return RunEnd.WAITING
        val session = try {
            sessionOf(state, keys)
        } catch (_: BlobException) {
            // The Keystore cannot be used now, as before the first unlock. The next run tries.
            return RunEnd.ENDED
        }
        return try {
            if (session == null) throw EndRun(Reason.Stopped(Stop.KEYS_GONE))
            if (keys.nameKeyState() == NameKeyState.MISSING || keys.nameKeyState() == NameKeyState.LOST) throw EndRun(Reason.Stopped(Stop.KEYS_GONE))
            OneRun(session, asked, stopped).go()
            store.update { if (it.isJoinedWith(session)) it.copy(syncedAt = clock.nowMillis(), failedRuns = 0, retryAt = null) else it }
            RunEnd.WORKED
        } catch (_: RunStopped) {
            RunEnd.ENDED
        } catch (end: EndRun) {
            ended(end.reason, session, state)
            RunEnd.ENDED
        } catch (_: DeviceKeyGoneException) {
            ended(Reason.Stopped(Stop.KEYS_GONE), session, state)
            RunEnd.ENDED
        } catch (_: BlobException) {
            // The Keystore cannot be used now, as before the first unlock. The next run tries.
            RunEnd.ENDED
        } catch (_: CouldNotSaveException) {
            RunEnd.ENDED
        }
    }

    /**
     * Writes what [reason] says, only while the phone is still the device
     * of [joined], and joined with [session] when there is one: a Leave or
     * a new join while the run went keeps what it wrote. A write that fails
     * is left: the next run meets the same answer.
     */
    private fun ended(reason: Reason, session: Session?, joined: SyncState) {
        try {
            problems.write(reason, countsAsFailedRun = true, session = session, onlyIf = { it.isSameDeviceAs(joined) })
        } catch (_: CouldNotSaveException) {
            // The next run meets the same answer.
        }
    }

    /** The work of one run, with the session it signs with. */
    private inner class OneRun(private val session: Session, private val asked: Boolean, private val stopped: () -> Boolean) {
        private var heads: Heads? = null
        private var apps: List<CourierApp> = emptyList()
        private var sendingStopped = false

        /** True after a lack of CPU time or a `0C` on a file request: the files wait for the next run, with less in each request. */
        private var filesStopped = false

        /** A courier call of the app being served failed: it is left for this run, and nothing records it as served well. */
        private var appLeft = false

        /** The apps that got a result `05`: they get no further batch in this run. */
        private val noMoreBatchesFor = mutableSetOf<String>()

        /** Ends the run here when Android stopped its job. */
        private fun checkStop() {
            if (stopped()) throw RunStopped()
        }

        /**
         * One write of the state, made only while the phone is still joined
         * with this run's session. A Leave, a cancel or a new join while
         * the run went keeps what it wrote.
         */
        private fun write(change: (SyncState) -> SyncState) {
            store.update { if (it.isJoinedWith(session)) change(it) else it }
        }

        fun go() {
            val start = store.now()
            val now = clock.nowMillis()
            if (start.limits == null || !sameUtcDay(start.infoAt, now)) readInfo()
            val heads = readHeads()
            val firstOfDay = !sameUtcDay(store.now().statusAt, now)
            apps = couriers.find().passed.sortedBy { it.name.value }
            val epochMoved = start.epoch != heads.epoch
            if (epochMoved) takeEpoch(heads.epoch)
            var toServe = apps.filter { firstOfDay || epochMoved || needs(it.name.value, heads) }
            repeat(PASSES) {
                toServe.forEach {
                    checkStop()
                    serve(it)
                }
                // A poke that came while the run served its app marks it again: it is served again before the run ends.
                // One left after the last pass makes the job run again (runsAgain).
                toServe = apps.filter { store.now().app(it.name.value).poked }
                if (toServe.isEmpty()) return@repeat
            }
            if (firstOfDay) write { it.copy(statusAt = clock.nowMillis()) }
        }

        private fun needs(app: String, heads: Heads): Boolean {
            val known = store.now().app(app)
            val head = heads.of(app)
            return known.poked || known.work || head.head != known.head || head.told < known.head
        }

        /** `info`, and its limits. A version other than 1 stops sync; a closed server too. */
        fun readInfo() {
            val info = valueOf(server.info(session.address))
            when {
                info.state == ServerState.CLOSED -> throw EndRun(Reason.Stopped(Stop.CLOSED))
                info.lowest > ServerInfo.VERSION -> throw EndRun(Reason.Stopped(Stop.UPDATE_SYNC))
                info.highest < ServerInfo.VERSION -> throw EndRun(Reason.Stopped(Stop.UPDATE_SERVER))
            }
            passed()
            write { it.copy(limits = info.limits, infoAt = clock.nowMillis()) }
        }

        /**
         * `heads`: the key ID and the revision, and the list of devices when
         * it is due. The epoch is taken after, by [takeEpoch]: a run that
         * ends at the list of devices leaves it for the next run.
         */
        private fun readHeads(): Heads {
            val heads = valueOf(retrying { server.heads(session) })
            passed()
            this.heads = heads
            val state = store.now()
            val putBack = heads.revision < state.revision
            write { it.copy(keyId = heads.keyId, putBack = it.putBack || putBack) }
            if (heads.revision != state.revision || !sameUtcDay(state.devicesAt, clock.nowMillis())) {
                DeviceList(store, server, clock).read(session, heads.revision)
            }
            return heads
        }

        /**
         * A new epoch, and in the same write every app marked with work:
         * an app this run does not reach is served at the next run, whose
         * courier calls carry the new epoch, so that it compares everything.
         */
        private fun takeEpoch(epoch: SyncId) {
            write { state -> apps.fold(state.copy(epoch = epoch)) { marked, app -> marked.withApp(app.name.value) { it.copy(work = true) } } }
        }

        /** A request passed: the clock and the fault no longer hold. */
        private fun passed() {
            val state = store.now()
            if (state.fault || state.clockOff != null) write { it.copy(fault = false, clockOff = null) }
        }

        private fun serve(app: CourierApp) {
            var epochs = 0
            while (true) {
                try {
                    serveOnce(app)
                    return
                } catch (moved: EpochMoved) {
                    // Every app compares everything: each courier call from now on carries the new epoch.
                    takeEpoch(moved.epoch)
                    if (++epochs >= MOST_EPOCHS) throw EndRun(Reason.Fault)
                } finally {
                    progress.value = null
                }
            }
        }

        private fun serveOnce(app: CourierApp) {
            val name = app.name.value
            write { state -> state.withApp(name) { it.copy(poked = false) } }
            appLeft = false
            val context = courierContext()
            val status = statusOf(app, context) ?: return
            // What the app has to do is kept before any transfer, so that a run that fails part way serves it again.
            record(name, status, goodNow = false)
            if (!status.isOn || !status.canSyncNow) return
            val heads = this.heads ?: return
            val head = heads.of(name)
            val needsFetch = status.cursor != head.head || head.told < status.known ||
                status.comparison == ComparisonState.FETCHING || status.wantsFetch
            if (needsFetch && !fetchAll(app, context, status)) return
            if (!sendBatches(app, context, comparison = false)) return
            val streamsSent = moveStreams(app, context) ?: return
            if (streamsSent && !sendBatches(app, context, comparison = false)) return
            if (!sendBatches(app, context, comparison = true)) return
            val after = statusOf(app, context) ?: return
            write { state -> state.withApp(name) { it.copy(head = head.head) } }
            record(name, after, goodNow = true)
        }

        private fun record(name: String, status: SyncStatus, goodNow: Boolean) {
            val work = status.hasOrdinaryChanges || status.hasComparisonRecords || status.hasStreamsToMove ||
                status.comparison != ComparisonState.NONE || status.wantsFetch
            write { state ->
                state.withApp(name) { it.copy(on = status.isOn, work = status.isOn && work, goodAt = if (goodNow) clock.nowMillis() else it.goodAt) }
            }
        }

        private fun courierContext(): CourierContext {
            val state = store.now()
            val serverId = state.serverId ?: throw EndRun(Reason.Stopped(Stop.KEYS_GONE))
            val epoch = state.epoch ?: throw EndRun(Reason.Stopped(Stop.KEYS_GONE))
            val deviceId = state.deviceId ?: throw EndRun(Reason.Stopped(Stop.KEYS_GONE))
            val keyId = state.keyId ?: throw EndRun(Reason.Stopped(Stop.KEYS_GONE))
            return CourierContext(serverId, epoch, deviceId, keyId)
        }

        /** The app's `status`, or null when it gave none or refused: then it is left for this run. Sync off is recorded. */
        private fun statusOf(app: CourierApp, context: CourierContext): SyncStatus? = when (val answer = couriers.status(app, context)) {
            is CourierAnswer.Done -> answer.value.takeIf { it.courierVersion == ServerInfo.VERSION }
            is CourierAnswer.Refused -> {
                if (answer.refusal == Refusal.OFF) {
                    write { state -> state.withApp(app.name.value) { it.copy(on = false, work = false) } }
                }
                null
            }
            CourierAnswer.NoAnswer -> null
        }

        /** Fetches every page above the app's cursor and hands each to `import`. False when the app is left for this run. */
        private fun fetchAll(app: CourierApp, context: CourierContext, status: SyncStatus): Boolean {
            val name = app.name.value
            var cursor = status.cursor
            var known = status.known
            progress.value = RunProgress(name, if (status.comparison == ComparisonState.NONE) RunStep.FETCHING else RunStep.COMPARING)
            while (true) {
                checkStop()
                val fetched = when (val answer = retrying { server.fetch(session, name, cursor, known, context.epoch, mostRecords()) }) {
                    is ServerAnswer.Done -> answer.value
                    is ServerAnswer.OtherEpoch -> throw EpochMoved(answer.epoch)
                    else -> fail(answer)
                }
                passed()
                if (fetched.page.since != cursor || fetched.page.epoch != context.epoch) throw EndRun(Reason.Fault)
                // A page that says more wait, and moves nothing forward, would be fetched again and again.
                if (fetched.page.more && fetched.page.through <= cursor) throw EndRun(Reason.Fault)
                when (val imported = couriers.import(app, context, fetched.bytes)) {
                    is CourierAnswer.Done -> when (val result = imported.value) {
                        is Imported.Taken -> {
                            // A page that is taken moves the cursor to its Through: any other answer is a failed call.
                            if (result.cursor != fetched.page.through) return false
                            cursor = result.cursor
                            known = maxOf(known, fetched.page.through, cursor)
                        }
                        Imported.Dropped -> return false
                    }
                    else -> return false
                }
                if (!fetched.page.more) return true
            }
        }

        /** Sends batches of [comparison] records until the app has none. False when the app is left for this run. */
        private fun sendBatches(app: CourierApp, context: CourierContext, comparison: Boolean): Boolean {
            val name = app.name.value
            var tries = 0
            repeat(MOST_BATCHES) {
                checkStop()
                if (!sendingAllowed() || (comparison && comparisonsWait()) || name in noMoreBatchesFor) return true
                progress.value = RunProgress(name, if (comparison) RunStep.COMPARING else RunStep.SENDING)
                val batch = when (val answer = couriers.export(app, context, comparison, mostRecords(), mostBytes())) {
                    is CourierAnswer.Done -> answer.value ?: return true
                    else -> return false
                }
                checkStop()
                when (val answer = server.send(session, name, batch)) {
                    is ServerAnswer.Done -> {
                        passed()
                        tries = 0
                        if (store.now().full) write { it.copy(full = false, fullAt = null) }
                        val sent = answer.value
                        if (sent.answer.epoch != context.epoch) throw EndRun(Reason.Fault)
                        when (val taken = couriers.exported(app, context, batch.token, sent.bytes)) {
                            is CourierAnswer.Done -> if (taken.value == ExportedResult.IGNORED) return false
                            else -> return false
                        }
                        val results = sent.answer.outcomes.map { it.result }
                        if (SendResult.CHANGED_AFTER_CURSOR in results) {
                            // The fetch brings the version that was in the way, and the app's merge decides.
                            val status = statusOf(app, context) ?: return false
                            if (!fetchAll(app, context, status)) return false
                        }
                        if (SendResult.CHUNKS_BEING_DELETED in results) {
                            noMoreBatchesFor += name
                            return true
                        }
                    }
                    ServerAnswer.Full -> {
                        sendingStopped = true
                        write { it.copy(full = true, fullAt = clock.nowMillis()) }
                        return true
                    }
                    is ServerAnswer.DayLimit -> {
                        if (!answer.comparisonsOnly || !comparison) fail(answer)
                        write { it.copy(dayWait = DayWait.COMPARISONS, dayWaitUntil = nextUtcMidnight(clock.nowMillis())) }
                        return true
                    }
                    ServerAnswer.OutOfCpuTime -> if (!halve() || ++tries > MOST_TRIES) fail(answer)
                    ServerAnswer.TooMuch -> if (!lessAfterTooMuch() || ++tries > MOST_TRIES) fail(answer)
                    is ServerAnswer.OtherEpoch -> throw EpochMoved(answer.epoch)
                    else -> fail(answer)
                }
            }
            return true
        }

        private fun sendingAllowed(): Boolean {
            if (sendingStopped) return false
            val state = store.now()
            // A full server: sending is tried once a day, and on Try again.
            return !state.full || asked || !sameUtcDay(state.fullAt, clock.nowMillis())
        }

        private fun comparisonsWait(): Boolean {
            val state = store.now()
            return state.dayWait != null && state.dayWaitUntil != null && clock.nowMillis() < state.dayWaitUntil
        }

        /**
         * Deletes, sends and fetches the streams the app lists. True if a
         * stream is now on the server; null when a courier call failed, so
         * that the app is left for this run.
         */
        private fun moveStreams(app: CourierApp, context: CourierContext): Boolean? {
            val list = when (val answer = couriers.streams(app, context)) {
                is CourierAnswer.Done -> answer.value
                else -> return null
            }
            deleteStreams(app, context, list.filter { it.work == StreamWork.DELETE })
            if (appLeft) return null
            // Asking which chunks the server has moves no chunk, so it goes on any network: only files/send and files/fetch wait.
            val sends = list.filter { it.work == StreamWork.SEND }
            // A full server takes no chunks either: sending is tried once a day, and on Try again.
            val sent = if (sends.isNotEmpty() && !filesStopped && sendingAllowed()) StreamSender(app, context).send(sends) else false
            val fetches = list.filter { it.work == StreamWork.FETCH }
            if (fetches.isNotEmpty() && !filesStopped && filesMayMove() && !appLeft) StreamFetcher(app, context).fetch(fetches)
            return if (appLeft) null else sent
        }

        private fun deleteStreams(app: CourierApp, context: CourierContext, deletes: List<ListedStream>) {
            deletes.chunked(fileItems()).forEach { group ->
                checkStop()
                if (filesStopped) return
                val files = group.map { it.fileIdBytes to it.deletedNumber }
                val results = fileValue(server.filesDelete(session, app.name.value, files)) ?: return
                passed()
                group.zip(results).forEach { (stream, result) ->
                    // After NOT_NOW the next run asks again. With no answer from the app, it is left for this run.
                    if (result != DeleteResult.NOT_NOW && couriers.streamDeleted(app, context, stream.fileIdBytes) !is CourierAnswer.Done) {
                        appLeft = true
                        return
                    }
                }
            }
        }

        private fun filesMayMove(): Boolean = store.now().filesOnMobile || !network.isMetered()

        /** Sends the chunks that the server lacks, many small streams to one request and one large chunk to one request. */
        private inner class StreamSender(private val app: CourierApp, private val context: CourierContext) {
            private val pending = mutableListOf<Pair<String, OutgoingChunk>>()
            private val left = mutableMapOf<String, Int>()
            private val failed = mutableSetOf<String>()
            private val byId = mutableMapOf<String, ListedStream>()
            private var total = 0L
            private var done = 0L
            private var stopped = false
            private var anySent = false

            fun send(streams: List<ListedStream>): Boolean {
                val have = mutableListOf<Long>()
                for (group in streams.chunked(fileItems())) {
                    checkStop()
                    have += fileValue(server.filesHave(session, app.name.value, group.map { StreamRef(it.fileIdBytes, it.hash) })) ?: return false
                }
                passed()
                total = streams.sumOf { it.length }
                streams.zip(have).forEach { (stream, chunksThere) ->
                    checkStop()
                    val chunks = chunkCount(stream.length)
                    // More chunks than the stream has is no answer the server can give.
                    if (chunksThere > chunks) throw EndRun(Reason.Fault)
                    val first = chunksThere.toInt()
                    done += minOf(stream.length, first.toLong() * CHUNK_BYTES)
                    show()
                    if (first == chunks) {
                        // Every chunk is there already: no chunk moves, so this goes on any network.
                        sent(stream)
                        return@forEach
                    }
                    if (appLeft || stopped || filesStopped || !filesMayMove()) return@forEach
                    // Damaged bytes never go to the server under the name of the good stream. A stream that could not
                    // be read at all is no proof of that: the app is left for this run, and nothing is said about it.
                    when (hashOf(stream)) {
                        HashCheck.FITS -> queue(stream, first, chunks)
                        HashCheck.DOES_NOT_FIT -> if (couriers.streamSent(app, context, stream.fileIdBytes, stream.hash, fits = false) !is CourierAnswer.Done) appLeft = true
                        HashCheck.UNREADABLE -> appLeft = true
                    }
                }
                flush()
                return anySent
            }

            /**
             * Whether the stored stream, read to its end, fits the hash and
             * the length that `streams` named. It does not fit only when it
             * was read past its listed length or its hash differs, or the
             * app says it has no stream. No answer, a refusal, a failed pipe
             * and a stream that ends early, as when the app's process ends
             * during the read, prove nothing about its bytes.
             */
            private fun hashOf(stream: ListedStream): HashCheck {
                val input = when (val answer = couriers.readStream(app, context, stream.fileIdBytes)) {
                    is CourierAnswer.Done -> answer.value ?: return HashCheck.DOES_NOT_FIT
                    else -> return HashCheck.UNREADABLE
                }
                return try {
                    input.use {
                        val counting = CountingInput(it)
                        val hash = StreamHash.of(counting)
                        when {
                            counting.count < stream.length -> HashCheck.UNREADABLE
                            counting.count == stream.length && hash.contentEquals(stream.hash) -> HashCheck.FITS
                            else -> HashCheck.DOES_NOT_FIT
                        }
                    }
                } catch (_: IOException) {
                    HashCheck.UNREADABLE
                }
            }

            private fun queue(stream: ListedStream, first: Int, chunks: Int) {
                val key = stream.fileId
                val input = (couriers.readStream(app, context, stream.fileIdBytes) as? CourierAnswer.Done)?.value
                if (input == null) {
                    appLeft = true
                    return
                }
                byId[key] = stream
                left[key] = chunks - first
                try {
                    input.use {
                        skipFully(it, first.toLong() * CHUNK_BYTES)
                        for (number in first until chunks) {
                            val length = chunkLength(stream.length, number)
                            // A stream that ends early on this second read is a failed courier call too.
                            val bytes = readFully(it, length) ?: run {
                                appLeft = true
                                return
                            }
                            if (pending.isNotEmpty() && (pending.size >= fileItems() || pending.sumOf { (_, chunk) -> chunk.bytes.size } + length > CHUNK_BYTES)) flush()
                            // A request that ran out of CPU time, a metered network or a failed courier call stops the
                            // reading too, so that no more chunks of a large file wait in memory.
                            if (stopped || filesStopped || appLeft || key in failed) return
                            pending += key to OutgoingChunk(stream.fileIdBytes, stream.hash, number, bytes, StreamHash.of(ByteArrayInputStream(bytes)))
                        }
                    }
                } catch (_: IOException) {
                    failed += key
                    appLeft = true
                }
            }

            private fun flush() {
                if (pending.isEmpty() || stopped || filesStopped) return
                checkStop()
                if (!filesMayMove()) {
                    // The network turned metered: no more chunks in this run.
                    stopped = true
                    return
                }
                progress.value = RunProgress(app.name.value, RunStep.SENDING_FILES, done, total)
                val chunks = pending.toList()
                pending.clear()
                val stored = fileValue(server.filesSend(session, app.name.value, chunks.map { it.second })) ?: return
                passed()
                chunks.zip(stored).forEach { (keyed, isStored) ->
                    val (key, chunk) = keyed
                    if (!isStored) {
                        failed += key
                        return@forEach
                    }
                    done += chunk.bytes.size
                    val remaining = (left[key] ?: 0) - 1
                    left[key] = remaining
                    if (remaining == 0 && key !in failed) byId[key]?.let(::sent)
                }
                show()
            }

            private fun sent(stream: ListedStream) {
                if (couriers.streamSent(app, context, stream.fileIdBytes, stream.hash, fits = true) is CourierAnswer.Done) anySent = true else appLeft = true
            }

            private fun show() {
                progress.value = RunProgress(app.name.value, RunStep.SENDING_FILES, done, total)
            }
        }

        /** Fetches the chunks of each stream the app wants, writes them through `writeStream` in order, and finishes each. */
        private inner class StreamFetcher(private val app: CourierApp, private val context: CourierContext) {
            private var total = 0L
            private var done = 0L

            fun fetch(streams: List<ListedStream>) {
                total = streams.sumOf { it.length }
                done = streams.sumOf { it.bytesHere }
                streams.forEach { stream ->
                    if (appLeft || filesStopped || !filesMayMove()) return
                    if (!fetchOne(stream)) return@forEach
                }
            }

            private fun fetchOne(stream: ListedStream): Boolean {
                val out = when (val answer = couriers.writeStream(app, context, stream.fileIdBytes, stream.bytesHere)) {
                    // The app does not want this stream now.
                    is CourierAnswer.Done -> answer.value ?: return false
                    else -> {
                        appLeft = true
                        return false
                    }
                }
                val chunks = chunkCount(stream.length)
                var here = stream.bytesHere
                val whole = try {
                    out.use {
                        var number = (here / CHUNK_BYTES).toInt()
                        while (number < chunks) {
                            checkStop()
                            if (filesStopped || !filesMayMove()) return false
                            val refs = mutableListOf<ChunkRef>()
                            var bytes = 0L
                            while (number < chunks && refs.size < fileItems() && bytes + chunkLength(stream.length, number) <= CHUNK_BYTES) {
                                val length = chunkLength(stream.length, number)
                                refs += ChunkRef(stream.fileIdBytes, stream.hash, number, length)
                                bytes += length
                                number++
                            }
                            progress.value = RunProgress(app.name.value, RunStep.FETCHING_FILES, done, total)
                            val fetched = fileValue(server.filesFetch(session, app.name.value, refs)) ?: return false
                            passed()
                            for ((ref, chunk) in refs.zip(fetched)) {
                                // A chunk the server lacks: another device must send it first. The app still wants the stream.
                                chunk ?: return false
                                val skip = (here - ref.number.toLong() * CHUNK_BYTES).coerceAtLeast(0).toInt()
                                writeAll(it, chunk, skip)
                                done += chunk.size - skip
                                here += chunk.size - skip
                            }
                        }
                        true
                    }
                } catch (_: IOException) {
                    // The app's pipe failed: a failed courier call leaves the app for this run.
                    appLeft = true
                    false
                }
                if (!whole || here != stream.length) return false
                if (couriers.finishStream(app, context, stream.fileIdBytes) !is CourierAnswer.Done) appLeft = true
                return true
            }

            private fun writeAll(out: OutputStream, chunk: ByteArray, skip: Int) {
                if (skip < chunk.size) out.write(chunk, skip, chunk.size - skip)
            }
        }

        /** Halves what one request carries, for a lack of CPU time. False when it is down to one record. */
        private fun halve(): Boolean {
            val state = store.now()
            val limits = state.limits ?: return false
            if (state.halved >= SyncState.MOST_HALVINGS || (limits.records shr state.halved) <= 1) return false
            write { it.copy(halved = it.halved + 1, halvedAt = clock.nowMillis()) }
            return true
        }

        /**
         * The value of a file request's [answer]. After a lack of CPU time
         * or a `0C` the request is not made again as it was: what one
         * request carries is halved, or `info` read again, and the files
         * wait for the next run (null). Any other answer ends the run.
         */
        private fun <T> fileValue(answer: ServerAnswer<T>): T? = when (answer) {
            is ServerAnswer.Done -> answer.value
            ServerAnswer.OutOfCpuTime -> if (halve()) null.also { filesStopped = true } else fail(answer)
            ServerAnswer.TooMuch -> if (lessAfterTooMuch()) null.also { filesStopped = true } else fail(answer)
            else -> fail(answer)
        }

        /** After `0C`: `info` again, and if its limits are not lower, a halving. */
        private fun lessAfterTooMuch(): Boolean {
            val before = store.now().limits
            readInfo()
            val after = store.now().limits
            return if (after != null && before != null && (after.records < before.records || after.bytes < before.bytes || after.fileItems < before.fileItems)) true else halve()
        }

        /** [call], made again after a lack of CPU time with half as much, and after `0C` with the limits of a new `info`. */
        private fun <T> retrying(call: () -> ServerAnswer<T>): ServerAnswer<T> {
            var tries = 0
            while (true) {
                checkStop()
                val answer = call()
                val again = when (answer) {
                    ServerAnswer.OutOfCpuTime -> halve()
                    ServerAnswer.TooMuch -> lessAfterTooMuch()
                    else -> return answer
                }
                if (!again || ++tries > MOST_TRIES) return answer
            }
        }

        private fun mostRecords(): Int {
            val state = store.now()
            val limits = state.limits ?: Limits(1, Limits.BYTES.first, 1)
            return maxOf(1, limits.records shr state.halved)
        }

        private fun mostBytes(): Int {
            val state = store.now()
            val limits = state.limits ?: Limits(1, Limits.BYTES.first, 1)
            return maxOf(SMALLEST_BYTES, limits.bytes shr state.halved)
        }

        private fun fileItems(): Int {
            val state = store.now()
            val limits = state.limits ?: Limits(1, Limits.BYTES.first, 1)
            return maxOf(1, limits.fileItems shr state.halved)
        }
    }

    /** Thrown inside a run when the server names another epoch: the app is served again with it. */
    private class EpochMoved(val epoch: SyncId) : Exception("Another epoch")

    /** What reading a stream to its end showed. */
    private enum class HashCheck {
        FITS,
        DOES_NOT_FIT,

        /** It could not be read: no answer, no stream, or a pipe that failed. That proves nothing about its bytes. */
        UNREADABLE,
    }

    /** Thrown inside a run when Android stopped its job. Nothing is written for it. */
    private class RunStopped : Exception("The run was stopped")

    internal companion object {
        /** A stream is cut into chunks of 4 MiB, and one request carries at most that much. */
        const val CHUNK_BYTES: Int = 4_194_304

        /** After three failed runs, one every 4 hours. */
        const val RETRY_WAIT_MILLIS: Long = 4 * 60 * 60 * 1000L

        const val DAY_MILLIS: Long = 24 * 60 * 60 * 1000L

        /** A halving is undone a day after it was made. */
        const val HALVING_UNDONE_MILLIS: Long = DAY_MILLIS

        /** The smallest byte limit a halving gives: one smallest sealed record. */
        const val SMALLEST_BYTES: Int = 50

        /** How often one run serves the apps that poked while it served them. */
        const val PASSES: Int = 3

        /** How many new epochs one run takes for one app before it counts as a fault. */
        const val MOST_EPOCHS: Int = 3

        /** How often one request is made again with less in one run. */
        const val MOST_TRIES: Int = 8

        /** The most batches of one kind one run sends for one app. Android ends a run long before. */
        const val MOST_BATCHES: Int = 10_000

        /** The value of [answer], or the end of the run that it means. */
        fun <T> valueOf(answer: ServerAnswer<T>): T = when (answer) {
            is ServerAnswer.Done -> answer.value
            else -> fail(answer)
        }

        /** The end of the run that a refusal or a failed request means. */
        fun fail(answer: ServerAnswer<*>): Nothing = throw EndRun(
            when (answer) {
                is ServerAnswer.Done -> Reason.Fault
                is ServerAnswer.Version -> when {
                    answer.lowest > ServerInfo.VERSION -> Reason.Stopped(Stop.UPDATE_SYNC)
                    answer.highest < ServerInfo.VERSION -> Reason.Stopped(Stop.UPDATE_SERVER)
                    else -> Reason.Fault
                }
                ServerAnswer.NotADevice -> Reason.Stopped(Stop.NOT_A_DEVICE)
                ServerAnswer.Removed -> Reason.Stopped(Stop.REMOVED)
                ServerAnswer.Closed -> Reason.Stopped(Stop.CLOSED)
                is ServerAnswer.Clock -> Reason.ClockOff(answer.serverTime)
                is ServerAnswer.DayLimit -> if (answer.comparisonsOnly) Reason.Fault else Reason.Wait(DayWait.EVERYTHING)
                ServerAnswer.DayRequestsUsed -> Reason.Wait(DayWait.EVERYTHING)
                ServerAnswer.Unreachable, ServerAnswer.NotTheWorker, ServerAnswer.UntrustedCertificate, ServerAnswer.OutOfCpuTime -> Reason.Unreachable
                ServerAnswer.Full -> Reason.Full
                else -> Reason.Fault
            },
        )

        /** The session of a joined phone, or null when a value it needs is missing or the device key does not give `deviceId`: lost keys. */
        fun sessionOf(state: SyncState, keys: SyncKeys): Session? {
            val address = state.address ?: return null
            val serverId = state.serverId ?: return null
            val alias = state.deviceAlias ?: return null
            val deviceId = state.deviceId ?: return null
            if (state.epoch == null) return null
            val key = keys.deviceKey(alias) ?: return null
            if (key.deviceId.toHex() != deviceId.hex) return null
            return Session(address, serverId, key)
        }

        /** True if [time] is on the same UTC day as [now]. A time later than now counts as long ago. */
        fun sameUtcDay(time: Long?, now: Long): Boolean = time != null && time <= now && time / DAY_MILLIS == now / DAY_MILLIS

        /** The first moment of the next UTC day after [now]. */
        fun nextUtcMidnight(now: Long): Long = (now / DAY_MILLIS + 1) * DAY_MILLIS

        /** How many chunks a stream of [length] bytes has. */
        fun chunkCount(length: Long): Int = ((length + CHUNK_BYTES - 1) / CHUNK_BYTES).toInt()

        /** The length of chunk [number] of a stream of [length] bytes. */
        fun chunkLength(length: Long, number: Int): Int = minOf(CHUNK_BYTES.toLong(), length - number.toLong() * CHUNK_BYTES).toInt()

        private fun skipFully(input: InputStream, count: Long) {
            var left = count
            val buffer = ByteArray(65_536)
            while (left > 0) {
                val read = input.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
                if (read < 0) throw IOException("The stream ended early")
                left -= read
            }
        }

        private fun readFully(input: InputStream, length: Int): ByteArray? {
            val bytes = ByteArray(length)
            var at = 0
            while (at < length) {
                val read = input.read(bytes, at, length - at)
                if (read < 0) return null
                at += read
            }
            return bytes
        }
    }
}

/** Why a run ended early, and what it writes. */
internal sealed interface Reason {
    data class Stopped(val stop: Stop) : Reason

    data object Fault : Reason

    /** The server's clock, from its `05`. */
    data class ClockOff(val serverTime: Long) : Reason

    data object Full : Reason

    data class Wait(val kind: DayWait) : Reason

    data object Unreachable : Reason
}

/** Thrown inside a run, and in the other steps that talk to the server, when an answer ends what they do. */
internal class EndRun(val reason: Reason) : Exception("The run ended")

/** True while the phone is joined, and with the device of [session]: a Leave or a new join since makes it false. */
internal fun SyncState.isJoinedWith(session: Session): Boolean = stage == Stage.JOINED && deviceId?.hex == session.key.deviceId.toHex()

/**
 * The same stage, server and device key as [other]: no Leave, join or stop
 * came between. A problem found from [other] is written only then.
 */
internal fun SyncState.isSameDeviceAs(other: SyncState): Boolean = stage == other.stage && address == other.address &&
    serverId == other.serverId && deviceAlias == other.deviceAlias && deviceId == other.deviceId

/** Counts the bytes it passes on. */
private class CountingInput(private val input: InputStream) : InputStream() {
    var count = 0L
        private set

    override fun read(): Int = input.read().also { if (it >= 0) count++ }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = input.read(buffer, offset, length).also { if (it > 0) count += it }
}

/** This state with the waits that are over taken out (docs/apps/sync/spec.md, "The clock or the time zone changes"). */
internal fun SyncState.withWaitsOver(now: Long): SyncState {
    var state = this
    val until = state.dayWaitUntil
    // A day wait ends at 00:00 UTC, and one that ends more than 24 hours ahead is over.
    if (until != null && (now >= until || until - now > SyncRun.DAY_MILLIS)) state = state.copy(dayWait = null, dayWaitUntil = null)
    val retry = state.retryAt
    if (retry != null && (now >= retry || retry - now > SyncRun.RETRY_WAIT_MILLIS)) state = state.copy(retryAt = null)
    val halvedAt = state.halvedAt
    if (state.halved > 0 && (halvedAt == null || now - halvedAt >= SyncRun.HALVING_UNDONE_MILLIS || halvedAt > now)) {
        state = state.copy(halved = state.halved - 1, halvedAt = now)
    }
    return state
}
