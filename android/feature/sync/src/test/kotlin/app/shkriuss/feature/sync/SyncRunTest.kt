package app.shkriuss.feature.sync

import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.crypto.RequestMethod
import app.shkriuss.core.data.Clock
import app.shkriuss.core.sync.ComparisonState
import app.shkriuss.core.sync.ListedStream
import app.shkriuss.core.sync.StreamWork
import app.shkriuss.core.testing.TestClock
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * One run of Sync against a server in memory and data apps in memory
 * (docs/architecture/sync-protocol.md, "When the Sync app runs";
 * docs/apps/sync/spec.md, "When Sync runs" and "Problems").
 */
class SyncRunTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val clock = TestClock()
    private val keys by lazy { TestKeys(temporary.newFolder()) }
    private val server by lazy { FakeServer(clock) }
    private val water = FakeDataApp("water")
    private val notes = FakeDataApp("notes")
    private val couriers = FakeCouriers(water, notes)
    private val store = SyncStateStore(MemoryPreferences())
    private val scheduler = FakeScheduler()
    private var metered = false
    private val run by lazy {
        val sync = keys.sync.crypto.sync
        SyncRun(store, SyncServer(server, sync, clock), couriers, sync, { metered }, ProblemWriter(store, sync, scheduler, clock), clock)
    }

    private fun joined() {
        val state = joinedState(keys, server, clock)
        store.update { state }
    }

    private fun run(asked: Boolean = false): RunEnd = runBlocking { run.run(asked) }

    private fun storeOnServer(app: String, vararg numbers: Long) {
        numbers.forEach { number -> server.records.getOrPut(app) { mutableListOf() } += FakeRecord(id(number.toInt()), number, blob(server.keyId, number.toInt())) }
        server.heads[app] = numbers.max()
    }

    @Test
    fun aPhoneThatHasNotJoinedMakesNoRequest() {
        assertEquals(RunEnd.NOT_JOINED, run())
        store.update { it.copy(stage = Stage.JOINING) }
        assertEquals(RunEnd.NOT_JOINED, run())
        assertEquals(emptyList<String>(), server.paths())
    }

    @Test
    fun theFirstRunOfADayAsksEveryAppAndReadsTheDevicesThenAQuietRunAsksOnlyHeads() {
        joined()
        assertEquals(RunEnd.WORKED, run())
        assertEquals(listOf("/v1/heads", "/v1/devices"), server.paths())
        assertEquals(listOf("status", "export", "streams", "export", "status"), water.calls)
        assertNotNull(store.now().syncedAt)
        assertNotNull(store.now().app("water").goodAt)

        server.requests.clear()
        water.calls.clear()
        clock.advanceBy(15 * 60 * 1000L)
        assertEquals(RunEnd.WORKED, run())
        assertEquals("a quiet run: one request", listOf("/v1/heads"), server.paths())
        assertEquals("no app is woken", emptyList<String>(), water.calls)
    }

    @Test
    fun anAppWhoseHeadMovedFetchesEveryPageAndRemembersTheHead() {
        joined()
        run()
        storeOnServer("water", 1, 2, 3)
        store.update { it.copy(limits = Limits(2, 524_288, 256)) }
        server.requests.clear()
        assertEquals(RunEnd.WORKED, run())
        assertEquals(listOf("/v1/heads", "/v1/changes", "/v1/changes"), server.paths())
        assertEquals(3, water.taken.size)
        assertEquals(3, water.cursor)
        assertEquals(3, store.now().app("water").head)
        assertEquals("notes had nothing", emptyList<String>(), notes.taken)
    }

    @Test
    fun aPokedAppIsServedAndThePokeIsCleared() {
        joined()
        run()
        notes.toSend += id(9) to blob(server.keyId, 9)
        store.update { state -> state.withApp("notes") { it.copy(poked = true) } }
        assertEquals(RunEnd.WORKED, run())
        assertEquals(emptyList<Pair<ByteArray, ByteArray>>(), notes.toSend)
        assertEquals(1L, server.heads["notes"])
        assertFalse(store.now().app("notes").poked)
        assertFalse("nothing left to do", store.now().app("notes").work)
    }

    @Test
    fun aRecordThatChangedOnTheServerIsFetchedBeforeTheNextBatch() {
        joined()
        run()
        water.toSend += id(1) to blob(server.keyId, 1)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        // The server's copy changed after the batch's cursor: refused with 01.
        server.answerNext("/v1/changes", HttpResult.Answer(200, Bytes().u8(0).bytes(server.epoch.toBytes()).i64(0).i64(0).i32(1).u8(1).done()))
        server.requests.clear()
        run()
        val changes = server.requests.filter { it.url.contains("/v1/changes") }.map { it.method }
        assertEquals(listOf(RequestMethod.POST, RequestMethod.GET, RequestMethod.POST), changes)
        assertEquals(0, water.toSend.size)
    }

    @Test
    fun aFullServerStopsSendingUntilTheNextDayOrTryAgain() {
        joined()
        run()
        water.toSend += id(3) to blob(server.keyId, 3)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.refuseNext("/v1/changes", 0x08)
        run()
        assertTrue(store.now().full)
        assertEquals(SyncProblem.FULL, problemOf(store.now(), clock.nowMillis))

        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        assertFalse("sending is tried once a day", "/v1/changes" in server.paths())

        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        run(asked = true)
        assertFalse("Try again sends, and a stored batch ends it", store.now().full)
        assertEquals(1L, server.heads["water"])
    }

    @Test
    fun theDaysLimitStopsEveryRequestUntilMidnightUtc() {
        joined()
        run()
        server.refuseNext("/v1/heads", 0x07, 0x02)
        assertEquals(RunEnd.ENDED, run())
        assertEquals(DayWait.EVERYTHING, store.now().dayWait)
        assertEquals(SyncProblem.DAY_LIMIT, problemOf(store.now(), clock.nowMillis))
        server.requests.clear()
        assertEquals(RunEnd.WAITING, run(asked = true))
        assertEquals("Sync now skips no wait for 00:00 UTC", emptyList<String>(), server.paths())
        clock.nowMillis = SyncRun.nextUtcMidnight(clock.nowMillis)
        assertEquals(RunEnd.WORKED, run())
        assertNull(store.now().dayWait)
    }

    @Test
    fun cloudflaresLimitOfRequestsWaitsTooButOnlyBatchesOfAComparisonWaitAfter0701() {
        joined()
        run()
        server.answerNext("/v1/heads", HttpResult.Answer(SyncServer.DAY_REQUESTS_STATUS, ByteArray(0)))
        run()
        assertEquals(DayWait.EVERYTHING, store.now().dayWait)

        clock.nowMillis = SyncRun.nextUtcMidnight(clock.nowMillis) + 1_000
        water.comparison = ComparisonState.SENDING
        water.comparisonToSend += id(4) to blob(server.keyId, 4)
        water.toSend += id(5) to blob(server.keyId, 5)
        // The ordinary batch is stored; the comparison's batch is answered 07 01.
        server.answerNext("/v1/changes", null)
        server.refuseNext("/v1/changes", 0x07, 0x01)
        assertEquals(RunEnd.WORKED, run())
        assertEquals("the ordinary batch went", 0, water.toSend.size)
        assertEquals(1, water.comparisonToSend.size)
        assertEquals(DayWait.COMPARISONS, store.now().dayWait)
        assertNull("only comparisons wait: no problem", problemOf(store.now(), clock.nowMillis))

        water.toSend += id(6) to blob(server.keyId, 6)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        assertEquals("ordinary batches still go", 0, water.toSend.size)
        assertEquals("the comparison waits for 00:00 UTC", 1, water.comparisonToSend.size)
    }

    @Test
    fun answersThatStopSyncStopItAndCancelTheWorks() {
        joined()
        server.refuseNext("/v1/heads", 0x02)
        assertEquals(RunEnd.ENDED, run())
        assertEquals(Stage.STOPPED, store.now().stage)
        assertEquals(Stop.NOT_A_DEVICE, store.now().stop)
        assertEquals(1, scheduler.cancels)
        server.requests.clear()
        assertEquals("a stopped phone makes no request", RunEnd.NOT_JOINED, run())
        assertEquals(emptyList<String>(), server.paths())
    }

    @Test
    fun aRemovedPhoneDeletesItsDeviceKey() {
        joined()
        val alias = store.now().deviceAlias!!
        server.refuseNext("/v1/heads", 0x03)
        run()
        assertEquals(Stop.REMOVED, store.now().stop)
        assertNull(keys.sync.crypto.sync.deviceKey(alias))
        assertEquals(SyncProblem.REMOVED, problemOf(store.now(), clock.nowMillis))
    }

    @Test
    fun aClosedServerAndAVersionStopSync() {
        joined()
        server.serverState = ServerState.CLOSED
        run()
        assertEquals(Stop.CLOSED, store.now().stop)

        store.update { joinedState(keys, server, clock).copy(infoAt = null) }
        server.serverState = ServerState.IN_USE
        server.lowest = 2
        server.highest = 2
        run()
        assertEquals(Stop.UPDATE_SYNC, store.now().stop)

        store.update { joinedState(keys, server, clock) }
        server.refuseNext("/v1/heads", 0x01, 0x00, 0x00)
        run()
        assertEquals(Stop.UPDATE_SERVER, store.now().stop)
    }

    @Test
    fun aRequestThatDoesNotCheckIsSentOnceMoreThenIsAFaultThatAPassingRequestClears() {
        joined()
        run()
        server.refuseNext("/v1/heads", 0x04)
        server.requests.clear()
        assertEquals("sent again once, and passed", RunEnd.WORKED, run())
        assertEquals(listOf("/v1/heads", "/v1/heads"), server.paths())

        server.refuseNext("/v1/heads", 0x04)
        server.refuseNext("/v1/heads", 0x04)
        run()
        assertTrue(store.now().fault)
        assertEquals(SyncProblem.FAULT, problemOf(store.now(), clock.nowMillis))
        assertEquals("a fault is not a failed run", 0, store.now().failedRuns)
        run()
        assertFalse(store.now().fault)
    }

    @Test
    fun theClockOfA05IsShownUntilARequestPasses() {
        joined()
        run()
        server.refuseNext("/v1/heads", 0x05, 0, 0, 0, 0, 0, 0, 0, 0)
        run()
        assertEquals(-clock.nowMillis, store.now().clockOff)
        assertEquals(SyncProblem.CLOCK, problemOf(store.now(), clock.nowMillis))
        run()
        assertNull(store.now().clockOff)
    }

    @Test
    fun threeFailedRunsWaitFourHoursButSyncNowGoes() {
        joined()
        run()
        server.unreachable = true
        repeat(3) { assertEquals(RunEnd.ENDED, run()) }
        assertEquals(3, store.now().failedRuns)
        assertEquals(SyncProblem.CANNOT_REACH, problemOf(store.now(), clock.nowMillis))
        server.requests.clear()
        assertEquals(RunEnd.WAITING, run())
        assertEquals(emptyList<String>(), server.paths())
        server.unreachable = false
        assertEquals(RunEnd.WORKED, run(asked = true))
        assertEquals(0, store.now().failedRuns)
        assertNull(store.now().retryAt)
    }

    @Test
    fun aLackOfCpuTimeHalvesTheRequestAndADayLaterAHalvingIsUndone() {
        joined()
        run()
        storeOnServer("water", 1)
        server.answerNext("/v1/changes", HttpResult.Answer(SyncServer.CPU_TIME_STATUS, ByteArray(0)))
        server.requests.clear()
        run()
        assertEquals(1, store.now().halved)
        val fetches = server.requests.filter { it.url.contains("/v1/changes") }.map { it.url.substringAfter("most=") }
        assertEquals(listOf("100", "50"), fetches)
        clock.advanceBy(SyncRun.DAY_MILLIS)
        run()
        assertEquals(0, store.now().halved)
    }

    @Test
    fun anotherEpochIsTakenAndTheAppIsServedAgainWithIt() {
        joined()
        run()
        storeOnServer("water", 1)
        server.epoch = syncId(7)
        run()
        assertEquals(syncId(7), store.now().epoch)
        assertEquals(syncId(7), water.epoch)
        assertEquals(1, water.taken.size)
    }

    @Test
    fun tooMuchInOneRequestReadsInfoAgain() {
        joined()
        run()
        storeOnServer("water", 1)
        server.refuseNext("/v1/changes", 0x0c)
        server.limits = Triple(10L, 65_536L, 16L)
        server.requests.clear()
        run()
        assertEquals(Limits(10, 65_536, 16), store.now().limits)
        assertEquals("/v1/info", server.paths()[2])
    }

    @Test
    fun aLowerRevisionOrARemovedDeviceInAgainIsAPutBackAndTheDeviceIsRemovedAgain() {
        joined()
        server.revision = 5
        val lost = FakeDevice(syncId(9), ByteArray(65) { 4 }, removed = true, addedAt = 1, sealedName = ByteArray(60))
        server.devices += lost
        run()
        assertEquals(setOf(syncId(9).hex), store.now().removed)
        assertFalse(store.now().putBack)

        // The database is put back: the device is in again, and the revision is lower.
        lost.removed = false
        server.revision = 3
        run()
        assertTrue(store.now().putBack)
        assertTrue("removed again", lost.removed)
        assertEquals(SyncProblem.PUT_BACK, problemOf(store.now(), clock.nowMillis))
    }

    @Test
    fun lostKeysStopSync() {
        joined()
        keys.sync.crypto.sync.deleteNameKey()
        run()
        assertEquals(Stop.KEYS_GONE, store.now().stop)

        store.update { joinedState(keys, server, clock).copy(deviceId = syncId(3)) }
        run()
        assertEquals("a device key that does not give deviceId", Stop.KEYS_GONE, store.now().stop)
    }

    @Test
    fun anAppThatGivesNoAnswerIsLeftAndTheOthersAreServed() {
        joined()
        water.answers = false
        notes.toSend += id(2) to blob(server.keyId, 2)
        assertEquals(RunEnd.WORKED, run())
        assertEquals(1L, server.heads["notes"])
        assertNull(store.now().app("water").goodAt)
    }

    @Test
    fun anAppWithSyncOffIsRecordedAndSendsNothing() {
        joined()
        water.on = false
        water.toSend += id(2) to blob(server.keyId, 2)
        run()
        assertFalse(store.now().app("water").on)
        assertNull(server.heads["water"])
    }

    @Test
    fun aStreamIsSentInChunksTheServerLacksAfterItsHashIsChecked() {
        joined()
        run()
        val bytes = ByteArray(SyncRun.CHUNK_BYTES + 100) { (it % 251).toByte() }
        val fileId = id(0x31)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes), bytes.size.toLong(), 0, 0))
        val damaged = id(0x32)
        water.stored[hex(damaged)] = byteArrayOf(1, 2, 3)
        water.streams += ListedStream(StreamWork.SEND, uuid(damaged), sha256(byteArrayOf(9)), 3, 0, 0)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        run()
        assertEquals(2, server.chunks.keys.count { it.startsWith("water/${hex(fileId)}") })
        assertEquals(setOf(hex(damaged) to false, hex(fileId) to true), water.sent.toSet())
    }

    @Test
    fun aStreamIsFetchedAndFinishedButNotOnAMeteredNetwork() {
        joined()
        run()
        val bytes = ByteArray(5_000) { (it % 7).toByte() }
        val fileId = id(0x41)
        val hash = sha256(bytes)
        server.chunks["water/${hex(fileId)}/${hex(hash)}/0"] = bytes
        water.streams = listOf(ListedStream(StreamWork.FETCH, uuid(fileId), hash, bytes.size.toLong(), 0, 0))
        metered = true
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        run()
        assertEquals("files wait for Wi-Fi", emptyList<String>(), water.finished)

        metered = false
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        run()
        assertEquals(listOf(hex(fileId)), water.finished)
        assertTrue(bytes.contentEquals(water.written.getValue(hex(fileId)).toByteArray()))
    }

    @Test
    fun filesOnMobileDataMoveOnAMeteredNetwork() {
        joined()
        run()
        val bytes = ByteArray(10) { 1 }
        val fileId = id(0x51)
        val hash = sha256(bytes)
        server.chunks["water/${hex(fileId)}/${hex(hash)}/0"] = bytes
        water.streams = listOf(ListedStream(StreamWork.FETCH, uuid(fileId), hash, bytes.size.toLong(), 0, 0))
        metered = true
        store.update { state -> state.copy(filesOnMobile = true).withApp("water") { it.copy(poked = true) } }
        run()
        assertEquals(listOf(hex(fileId)), water.finished)
    }

    @Test
    fun aDeletedFilesChunksAreDeletedAndTheAppIsTold() {
        joined()
        run()
        val fileId = id(0x61)
        water.streams = listOf(ListedStream(StreamWork.DELETE, uuid(fileId), ByteArray(32), 0, 0, 12))
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        metered = true
        run()
        assertEquals("a deletion moves no chunk, so it goes on any network", listOf(hex(fileId)), water.deleted)
    }

    @Test
    fun aComparisonsBatchesGoAfterTheOrdinaryOnes() {
        joined()
        run()
        water.comparison = ComparisonState.SENDING
        water.comparisonToSend += id(7) to blob(server.keyId, 7)
        water.toSend += id(8) to blob(server.keyId, 8)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        run()
        val order = server.records.getValue("water").sortedBy { it.number }.map { it.id[0].toInt() }
        assertEquals(listOf(8, 7), order)
    }

    @Test
    fun aRefusedPageEndsTheAppForThisRunAndItsCursorStays() {
        joined()
        run()
        storeOnServer("water", 1)
        water.dropPages = true
        run()
        assertEquals(0, water.cursor)
        assertEquals("the head is not remembered, so the next run fetches again", 0, store.now().app("water").head)
    }

    private fun uuid(bytes: ByteArray): String {
        val text = hex(bytes)
        return "${text.substring(0, 8)}-${text.substring(8, 12)}-${text.substring(12, 16)}-${text.substring(16, 20)}-${text.substring(20)}"
    }

    @Test
    fun afterAResult05TheAppGetsNoFurtherBatchInThisRun() {
        joined()
        run()
        water.comparison = ComparisonState.SENDING
        water.toSend += id(1) to blob(server.keyId, 1)
        water.comparisonToSend += id(2) to blob(server.keyId, 2)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        // Its file's chunks are being deleted: not stored, for now.
        server.answerNext("/v1/changes", HttpResult.Answer(200, Bytes().u8(0).bytes(server.epoch.toBytes()).i64(0).i64(0).i32(1).u8(5).done()))
        server.requests.clear()
        run()
        assertEquals("one batch only", 1, server.requests.count { it.url.contains("/v1/changes") })
        assertEquals(1, water.toSend.size)
        assertEquals(1, water.comparisonToSend.size)
    }

    @Test
    fun aPageThatSaysMoreWaitAndMovesNothingIsAFault() {
        joined()
        run()
        storeOnServer("water", 1)
        server.answerNext("/v1/changes", HttpResult.Answer(200, Bytes().u8(0).bytes(server.epoch.toBytes()).i64(0).i64(0).u8(1).i32(0).done()))
        assertEquals(RunEnd.ENDED, run())
        assertTrue(store.now().fault)
    }

    @Test
    fun aLackOfCpuTimeOnAFileRequestHalvesOnceAndTheFilesWaitForTheNextRun() {
        joined()
        run()
        val bytes = ByteArray(10) { 3 }
        val fileId = id(0x71)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes), 10, 0, 0))
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.answerNext("/v1/files/send", HttpResult.Answer(SyncServer.CPU_TIME_STATUS, ByteArray(0)))
        server.requests.clear()
        assertEquals(RunEnd.WORKED, run())
        assertEquals("the same request is not made again", 1, server.paths().count { it == "/v1/files/send" })
        assertEquals(1, store.now().halved)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        run()
        assertEquals(listOf(hex(fileId) to true), water.sent)
    }

    @Test
    fun aStreamWhoseChunksAreAllOnTheServerIsSentOnAMeteredNetworkWithNoChunkMoved() {
        joined()
        run()
        val bytes = ByteArray(10) { 4 }
        val fileId = id(0x72)
        val hash = sha256(bytes)
        server.chunks["water/${hex(fileId)}/${hex(hash)}/0"] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), hash, 10, 0, 0))
        metered = true
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        assertEquals(listOf(hex(fileId) to true), water.sent)
        assertFalse("/v1/files/send" in server.paths())
    }

    @Test
    fun onlyTheChunksTheServerLacksAreSent() {
        joined()
        run()
        val bytes = ByteArray(SyncRun.CHUNK_BYTES + 5) { (it % 13).toByte() }
        val fileId = id(0x73)
        val hash = sha256(bytes)
        server.chunks["water/${hex(fileId)}/${hex(hash)}/0"] = bytes.copyOf(SyncRun.CHUNK_BYTES)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), hash, bytes.size.toLong(), 0, 0))
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        val sends = server.requests.filter { it.url.contains("/v1/files/send") }
        assertEquals(1, sends.size)
        assertEquals("one chunk, the second", 1, java.nio.ByteBuffer.wrap(sends.single().body!!).short.toInt())
        assertEquals(1, java.nio.ByteBuffer.wrap(sends.single().body!!, 2 + 16 + 32, 4).int)
        assertEquals(listOf(hex(fileId) to true), water.sent)
    }

    @Test
    fun whatARunWritesAfterTheUserLeftDoesNotOverwriteTheLeave() {
        joined()
        run()
        water.toSend += id(1) to blob(server.keyId, 1)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        // Leave, while the run serves Water: stage 0 and the server's values gone, then the keys.
        water.onStatus = { forgetServer(store, keys.sync.crypto.sync, scheduler) }
        run()
        assertEquals(SyncState(), store.now())
        assertNull("no problem from the run", problemOf(store.now(), clock.nowMillis))
    }

    @Test
    fun aRunStopsBeforeItsNextRequestWhenAndroidStoppedItsJob() {
        joined()
        run()
        storeOnServer("water", 1)
        var stopped = false
        water.onStatus = { stopped = true }
        server.requests.clear()
        assertEquals(RunEnd.ENDED, runBlocking { run.run(asked = false) { stopped } })
        assertEquals("heads only", listOf("/v1/heads"), server.paths())
        assertFalse(store.now().fault)
        assertEquals(0, store.now().failedRuns)
    }

    @Test
    fun aFullServerTakesNoChunksUntilSendingIsTriedAgain() {
        joined()
        run()
        val bytes = ByteArray(10) { 6 }
        val fileId = id(0x74)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes), 10, 0, 0))
        store.update { state -> state.copy(full = true, fullAt = clock.nowMillis).withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        assertFalse("/v1/files/send" in server.paths())
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        run(asked = true)
        assertEquals(listOf(hex(fileId) to true), water.sent)
    }

    @Test
    fun aResult05KeepsEachAppFromFurtherBatchesAlsoWhenItIsServedAgain() {
        joined()
        run()
        notes.toSend += id(1) to blob(server.keyId, 1)
        water.toSend += id(2) to blob(server.keyId, 2)
        store.update { state -> state.withApp("notes") { it.copy(poked = true) }.withApp("water") { it.copy(poked = true) } }
        val chunksBeingDeleted = HttpResult.Answer(200, Bytes().u8(0).bytes(server.epoch.toBytes()).i64(0).i64(0).i32(1).u8(5).done())
        server.answerNext("/v1/changes", chunksBeingDeleted)
        server.answerNext("/v1/changes", chunksBeingDeleted)
        // Notes pokes again while Water is served: it is served once more in this run, and gets no batch.
        water.onStatus = { store.update { state -> state.withApp("notes") { it.copy(poked = true) } } }
        server.requests.clear()
        notes.calls.clear()
        run()
        assertEquals(2, server.requests.count { it.url.contains("/v1/changes") })
        assertEquals("Notes is served twice", 4, notes.calls.count { it == "status" })
        assertEquals("and asked for one batch", 1, notes.calls.count { it == "export" })
    }

    @Test
    fun anAppWhoseTransferFailedIsServedAtTheNextRun() {
        joined()
        run()
        water.toSend += id(3) to blob(server.keyId, 3)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.answerNext("/v1/changes", HttpResult.NoAnswer)
        assertEquals(RunEnd.ENDED, run())
        assertTrue("its work is kept", store.now().app("water").work)
        assertFalse(store.now().app("water").poked)
        run()
        assertEquals(0, water.toSend.size)
    }

    @Test
    fun anAppWhoseListOfStreamsGivesNoAnswerIsNotRecordedAsServed() {
        joined()
        run()
        val servedAt = store.now().app("water").goodAt
        clock.advanceBy(60_000)
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(id(0x75)), ByteArray(32) { 1 }, 10, 0, 0))
        water.failCalls += "streams"
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        run()
        assertEquals("left for this run", servedAt, store.now().app("water").goodAt)
        assertTrue(store.now().app("water").work)
    }

    @Test
    fun aStreamThatCouldNotBeReadIsNotReportedAsDamaged() {
        joined()
        run()
        val fileId = id(0x76)
        water.stored[hex(fileId)] = ByteArray(10) { 1 }
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(ByteArray(10) { 1 }), 10, 0, 0))
        water.failCalls += "readStream"
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        run()
        assertEquals("nothing said about the stream", emptyList<Pair<String, Boolean>>(), water.sent)
        assertFalse("/v1/files/send" in server.paths())
    }

    @Test
    fun aRunStoppedWhileTheAppExportsSendsNoBatch() {
        joined()
        run()
        water.toSend += id(1) to blob(server.keyId, 1)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        var stopped = false
        water.onExport = { stopped = true }
        server.requests.clear()
        assertEquals(RunEnd.ENDED, runBlocking { run.run(asked = false) { stopped } })
        assertFalse("/v1/changes" in server.paths())
    }

    @Test
    fun aFileRequestThatRanOutOfCpuTimeStopsTheReadingOfALargeStream() {
        joined()
        run()
        val bytes = ByteArray(3 * SyncRun.CHUNK_BYTES) { (it % 11).toByte() }
        val fileId = id(0x77)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes), bytes.size.toLong(), 0, 0))
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.answerNext("/v1/files/send", HttpResult.Answer(SyncServer.CPU_TIME_STATUS, ByteArray(0)))
        server.requests.clear()
        run()
        assertEquals(1, server.paths().count { it == "/v1/files/send" })
        // The hash reads the stream once; the chunks are read up to the request that was refused, not to the end.
        assertEquals(bytes.size + 2L * SyncRun.CHUNK_BYTES, water.bytesRead)
    }

    @Test
    fun aStreamThatEndsEarlyIsLeftAndAnAppWithNoStreamIsToldItDoesNotFit() {
        joined()
        run()
        val short = id(0x78)
        water.stored[hex(short)] = ByteArray(5) { 2 }
        val missing = id(0x79)
        water.streams = listOf(
            ListedStream(StreamWork.SEND, uuid(missing), ByteArray(32) { 3 }, 10, 0, 0),
            ListedStream(StreamWork.SEND, uuid(short), sha256(ByteArray(10) { 2 }), 10, 0, 0),
        )
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        run()
        assertEquals("only the stream the app does not have", listOf(hex(missing) to false), water.sent)
    }

    @Test
    fun aNewEpochIsHandedToEveryAppAfterARunThatEndedAtTheListOfDevices() {
        joined()
        run()
        server.epoch = syncId(7)
        server.revision = 1
        server.answerNext("/v1/devices", HttpResult.NoAnswer)
        assertEquals(RunEnd.ENDED, run())
        assertEquals("the epoch waits for the next run", syncId(2), store.now().epoch)
        assertEquals(RunEnd.WORKED, run())
        assertEquals(syncId(7), store.now().epoch)
        assertEquals(syncId(7), water.epoch)
        assertEquals(syncId(7), notes.epoch)
    }

    @Test
    fun aNewEpochIsHandedAtTheNextRunToTheAppsThatARunDidNotReach() {
        joined()
        run()
        storeOnServer("notes", 1)
        server.epoch = syncId(7)
        // Notes comes first. Its fetch gets no answer, and the run ends before Water.
        server.answerNext("/v1/changes", HttpResult.NoAnswer)
        assertEquals(RunEnd.ENDED, run())
        assertEquals(syncId(2), water.epoch)
        assertTrue("Water waits with work", store.now().app("water").work)
        assertEquals(RunEnd.WORKED, run())
        assertEquals(syncId(7), water.epoch)
        assertFalse(store.now().app("water").work)
    }

    @Test
    fun anAppThatPokesEachTimeItIsServedMakesItsJobRunAgain() {
        joined()
        run()
        lateinit var pokeAgain: () -> Unit
        pokeAgain = {
            store.update { state -> state.withApp("water") { it.copy(poked = true) } }
            water.onStatus = pokeAgain
        }
        water.onStatus = pokeAgain
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        water.calls.clear()
        val end = run()
        assertEquals(RunEnd.WORKED, end)
        assertTrue("the poke is left", store.now().app("water").poked)
        assertEquals("three passes", 3, water.calls.count { it == "streams" })
        assertTrue(runsAgain(end, store.now()))
    }

    @Test
    fun aRunWithNoPokeLeftOrThatEndedEarlyDoesNotRunAgain() {
        joined()
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        val end = run()
        assertEquals(RunEnd.WORKED, end)
        assertFalse(runsAgain(end, store.now()))
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        assertFalse("a run that ended early waits for the next job", runsAgain(RunEnd.ENDED, store.now()))
    }

    @Test
    fun aStreamThatEndsEarlyOnItsSecondReadLeavesTheApp() {
        joined()
        run()
        val good = id(0x7a)
        water.stored[hex(good)] = ByteArray(10) { 4 }
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(good), sha256(ByteArray(10) { 4 }), 10, 0, 0))
        // The first read checks the hash; the second, for the chunks, ends early.
        water.cutRead = 2
        val goodAt = store.now().app("water").goodAt
        clock.advanceBy(60_000)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        water.calls.clear()
        run()
        assertEquals("nothing said about the stream", emptyList<Pair<String, Boolean>>(), water.sent)
        assertEquals("not recorded as served", goodAt, store.now().app("water").goodAt)
        assertEquals("no status after the streams", 1, water.calls.count { it == "status" })
        assertTrue(store.now().app("water").work)
    }

    @Test
    fun aStreamWhosePipeFailsWhileItIsFetchedLeavesTheApp() {
        joined()
        run()
        val bytes = ByteArray(5_000) { (it % 7).toByte() }
        val fileId = id(0x42)
        val hash = sha256(bytes)
        server.chunks["water/${hex(fileId)}/${hex(hash)}/0"] = bytes
        water.streams = listOf(ListedStream(StreamWork.FETCH, uuid(fileId), hash, bytes.size.toLong(), 0, 0))
        water.failWrites = true
        val goodAt = store.now().app("water").goodAt
        clock.advanceBy(60_000)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        water.calls.clear()
        run()
        assertEquals(emptyList<String>(), water.finished)
        assertEquals("not recorded as served", goodAt, store.now().app("water").goodAt)
        assertEquals("no status after the streams", 1, water.calls.count { it == "status" })
    }

    @Test
    fun infoThatPassesClearsAFaultAlsoWhenHeadsThenFails() {
        joined()
        store.update { it.copy(fault = true, clockOff = 7 * 60_000L) }
        clock.advanceBy(SyncRun.DAY_MILLIS)
        server.answerNext("/v1/heads", HttpResult.NoAnswer)
        assertEquals(RunEnd.ENDED, run())
        assertTrue("info was read", server.paths().contains("/v1/info"))
        assertFalse(store.now().fault)
        assertNull(store.now().clockOff)
    }

    @Test
    fun anAppWhoseImportAnswersAnotherCursorIsNotRecordedAsServed() {
        joined()
        run()
        storeOnServer("water", 1, 2, 3)
        water.cursorBehind = true
        run()
        assertEquals("its head is not taken", 0, store.now().app("water").head)
        water.cursorBehind = false
        water.cursor = 0
        run()
        assertEquals(3, store.now().app("water").head)
    }

    @Test
    fun moreChunksOnTheServerThanAStreamHasIsAFault() {
        joined()
        run()
        val bytes = ByteArray(10) { 5 }
        val fileId = id(0x43)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes), 10, 0, 0))
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.answerNext("/v1/files/have", HttpResult.Answer(200, Bytes().u8(0).i32(2).done()))
        assertEquals(RunEnd.ENDED, run())
        assertTrue(store.now().fault)
        assertEquals("the app is not told the stream is on the server", emptyList<Pair<String, Boolean>>(), water.sent)
    }

    @Test
    fun aRunStoppedWhileFilesAreSentTellsTheAppNothing() {
        joined()
        run()
        val bytes = ByteArray(10) { 6 }
        val fileId = id(0x44)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes), 10, 0, 0))
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        var stopped = false
        server.onRequest = { path -> if (path == "/v1/files/send") stopped = true }
        assertEquals(RunEnd.ENDED, runBlocking { run.run(asked = false) { stopped } })
        assertTrue("the chunk went", server.paths().contains("/v1/files/send"))
        assertEquals("no streamSent after the stop", emptyList<Pair<String, Boolean>>(), water.sent)
    }

    @Test
    fun anAppWhoseFirstStatusOfTheDayFailedIsAskedAgainAtTheNextRun() {
        joined()
        water.failCalls += "status"
        run()
        water.failCalls.clear()
        water.calls.clear()
        clock.advanceBy(15 * 60 * 1000L)
        run()
        assertTrue("water is asked again", "status" in water.calls)
        water.calls.clear()
        clock.advanceBy(15 * 60 * 1000L)
        run()
        assertEquals("then the day's check is done", emptyList<String>(), water.calls)
    }

    @Test
    fun aLackOfCpuTimeForHeadsEndsTheRunAndHalvesNothing() {
        joined()
        server.answerNext("/v1/heads", HttpResult.Answer(SyncServer.CPU_TIME_STATUS, ByteArray(0)))
        assertEquals(RunEnd.ENDED, run())
        assertEquals("one heads", 1, server.paths().count { it == "/v1/heads" })
        assertEquals(0, store.now().halved)
    }

    @Test
    fun aBatchOfTheOtherKindLeavesTheAppAndGoesNowhere() {
        joined()
        run()
        water.toSend += id(3) to blob(server.keyId, 3)
        water.otherKind = true
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        assertTrue("no batch was sent", server.requests.none { it.method == RequestMethod.POST && it.url.contains("/v1/changes") })
        assertEquals(1, water.toSend.size)
    }

    @Test
    fun aFullServerStaysFullUntilARecordIsStored() {
        joined()
        run()
        water.toSend += id(4) to blob(server.keyId, 4)
        store.update { state -> state.copy(full = true, fullAt = clock.nowMillis).withApp("water") { it.copy(poked = true) } }
        val nothingStored = HttpResult.Answer(200, Bytes().u8(0).bytes(server.epoch.toBytes()).i64(0).i64(0).i32(1).u8(5).done())
        server.answerNext("/v1/changes", nothingStored)
        run(asked = true)
        assertTrue("still full", store.now().full)
    }

    @Test
    fun anAppWhoseFirstStatusOfTheDayNamedAnotherVersionIsAskedAgain() {
        joined()
        water.courierVersion = 2
        run()
        water.courierVersion = 1
        water.calls.clear()
        clock.advanceBy(15 * 60 * 1000L)
        run()
        assertTrue("water is asked again", "status" in water.calls)
    }

    @Test
    fun aStreamThatChangedAfterItsCheckSendsNoChunkAndDoesNotFit() {
        joined()
        run()
        val bytes = ByteArray(10) { 8 }
        val fileId = id(0x45)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes), 10, 0, 0))
        // The check reads the good bytes; the read that sends gets others.
        water.changedRead = 2
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        assertFalse("no chunk went", "/v1/files/send" in server.paths())
        assertEquals(listOf(hex(fileId) to false), water.sent)
    }

    @Test
    fun aBatchForAnotherEpochLeavesTheAppAndGoesNowhere() {
        joined()
        run()
        water.toSend += id(6) to blob(server.keyId, 6)
        water.batchEpoch = syncId(9)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        assertTrue("no batch was sent", server.requests.none { it.method == RequestMethod.POST && it.url.contains("/v1/changes") })
        assertEquals(syncId(2), store.now().epoch)
    }

    @Test
    fun aRunWhoseJoinChangedWhileHeadsWasOnItsWayGivesNoAppTheNewJoin() {
        joined()
        run()
        water.calls.clear()
        notes.calls.clear()
        // While heads is on its way, the user leaves and joins another server. The Leave could not delete this
        // run's key, so its signed requests still pass.
        server.onRequest = { path ->
            if (path == "/v1/heads") {
                server.onRequest = {}
                store.update { joinedState(keys, server, clock).copy(serverId = syncId(8), epoch = syncId(9), statusAt = null, devicesAt = clock.nowMillis) }
            }
        }
        assertEquals(RunEnd.ENDED, run())
        assertEquals("no courier call", emptyList<String>(), water.calls + notes.calls)
    }

    @Test
    fun aStatusOfAnotherEpochLeavesTheApp() {
        joined()
        run()
        water.toSend += id(7) to blob(server.keyId, 7)
        water.statusEpoch = syncId(9)
        val goodAt = store.now().app("water").goodAt
        clock.advanceBy(60_000)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        assertTrue("no batch was sent", server.requests.none { it.method == RequestMethod.POST && it.url.contains("/v1/changes") })
        assertEquals(goodAt, store.now().app("water").goodAt)
    }

    @Test
    fun aRunStoppedWhileHeadsWasOnItsWayReadsNoListOfDevices() {
        joined()
        run()
        server.revision = 1
        var stopped = false
        server.onRequest = { path -> if (path == "/v1/heads") stopped = true }
        server.requests.clear()
        assertEquals(RunEnd.ENDED, runBlocking { run.run(asked = false) { stopped } })
        assertFalse("/v1/devices" in server.paths())
    }

    @Test
    fun aFileRequestOutOfCpuTimeHalvesItsItemsAlsoWhenOneRecordIsTheLimit() {
        joined()
        run()
        val bytes = ByteArray(10) { 9 }
        val fileId = id(0x48)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes), 10, 0, 0))
        store.update { state -> state.copy(limits = Limits(1, 524_288, 256)).withApp("water") { it.copy(poked = true) } }
        server.answerNext("/v1/files/have", HttpResult.Answer(SyncServer.CPU_TIME_STATUS, ByteArray(0)))
        run()
        assertEquals(1, store.now().halved)
        assertEquals(0, store.now().failedRuns)
    }

    @Test
    fun anEighthHalvingTakesAFileRequestOf256ItemsDownToOne() {
        joined()
        run()
        val bytes = ByteArray(10) { 9 }
        val fileId = id(0x4a)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes), 10, 0, 0))
        store.update { state ->
            state.copy(limits = Limits(1, 524_288, 256), halved = 7, halvedAt = clock.nowMillis).withApp("water") { it.copy(poked = true) }
        }
        server.answerNext("/v1/files/have", HttpResult.Answer(SyncServer.CPU_TIME_STATUS, ByteArray(0)))
        run()
        assertEquals(8, store.now().halved)
        assertEquals(0, store.now().failedRuns)
        assertFalse(store.now().fault)
    }

    @Test
    fun aPageOfMoreRecordsThanTheFetchAskedForIsAFault() {
        joined()
        run()
        store.update { it.copy(limits = Limits(2, 524_288, 256)) }
        storeOnServer("water", 1, 2, 3)
        server.ignoresMost = true
        run()
        assertTrue(store.now().fault)
        assertTrue("the page is not imported", water.taken.isEmpty())
    }

    @Test
    fun aPageOfRecordsOverTheByteLimitOfInfoIsAFaultButOneRecordAloneIsTaken() {
        joined()
        run()
        store.update { it.copy(limits = Limits(100, 65_536, 256)) }
        server.records.getOrPut("water") { mutableListOf() } += FakeRecord(id(1), 1, blob(server.keyId, 1, 70_000))
        server.heads["water"] = 1
        run()
        assertFalse(store.now().fault)
        assertEquals(1, water.taken.size)

        server.records.getValue("water") += listOf(FakeRecord(id(2), 2, blob(server.keyId, 2, 40_000)), FakeRecord(id(3), 3, blob(server.keyId, 3, 40_000)))
        server.heads["water"] = 3
        run()
        assertTrue(store.now().fault)
        assertEquals("the page is not imported", 1, water.taken.size)
    }

    @Test
    fun aFileRequestRefusedAsTooMuchHalvesItsItemsWhenOnlyTheRecordLimitFell() {
        joined()
        run()
        val bytes = ByteArray(10) { 9 }
        val fileId = id(0x49)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes), 10, 0, 0))
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.refuseNext("/v1/files/have", 0x0c)
        server.limits = Triple(10L, 524_288L, 256L)
        run()
        assertEquals(Limits(10, 524_288, 256), store.now().limits)
        assertEquals(1, store.now().halved)
        assertEquals(0, store.now().failedRuns)
    }

    @Test
    fun aFetchRefusedAsTooMuchIsHalvedWhenOnlyTheItemLimitFell() {
        joined()
        run()
        storeOnServer("water", 1)
        server.refuseNext("/v1/changes", 0x0c)
        server.limits = Triple(100L, 524_288L, 16L)
        server.requests.clear()
        run()
        assertEquals(1, store.now().halved)
        val fetches = server.requests.filter { it.url.contains("/v1/changes") }.map { it.url.substringAfter("most=") }
        assertEquals(listOf("100", "50"), fetches)
    }

    @Test
    fun aLastStatusOfAnotherEpochDoesNotRecordTheAppAsServed() {
        joined()
        run()
        water.toSend += id(7) to blob(server.keyId, 7)
        water.onExport = { water.statusEpoch = syncId(9) }
        val goodAt = store.now().app("water").goodAt
        clock.advanceBy(60_000)
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        assertTrue("the batch was sent", server.requests.any { it.method == RequestMethod.POST && it.url.contains("/v1/changes") })
        assertEquals(goodAt, store.now().app("water").goodAt)
        assertTrue("the app is served again", store.now().app("water").work)
    }

    @Test
    fun theCheckOfAStreamReadsAtMostOneBytePastItsListedLength() {
        joined()
        run()
        val bytes = ByteArray(3 * SyncRun.CHUNK_BYTES) { (it % 13).toByte() }
        val fileId = id(0x4a)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes.copyOf(10)), 10, 0, 0))
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        run()
        assertEquals(11L, water.bytesRead)
        assertEquals(listOf(hex(fileId) to false), water.sent)
    }

    @Test
    fun aRunStoppedWhileAStreamIsCheckedReadsNoMoreOfIt() {
        joined()
        run()
        val bytes = ByteArray(3 * SyncRun.CHUNK_BYTES) { (it % 7).toByte() }
        val fileId = id(0x4b)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes), bytes.size.toLong(), 0, 0))
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        assertEquals(RunEnd.ENDED, runBlocking { run.run(asked = false) { water.bytesRead > 0 } })
        assertTrue("the read ended at the stop", water.bytesRead < bytes.size)
        assertFalse("/v1/files/send" in server.paths())
    }

    @Test
    fun aStatusOfAnotherEpochKeepsTheWorkThatSyncKnew() {
        joined()
        run()
        store.update { state -> state.withApp("water") { it.copy(work = true) } }
        water.statusEpoch = syncId(9)
        run()
        assertTrue("the app is served again", store.now().app("water").work)
    }

    @Test
    fun aRunStoppedWhileAStreamIsSkippedToItsFirstMissingChunkReadsNoMoreOfIt() {
        joined()
        run()
        val bytes = ByteArray(3 * SyncRun.CHUNK_BYTES) { (it % 5).toByte() }
        val fileId = id(0x4c)
        val hash = sha256(bytes)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), hash, bytes.size.toLong(), 0, 0))
        repeat(2) { number -> server.chunks["water/${hex(fileId)}/${hex(hash)}/$number"] = ByteArray(SyncRun.CHUNK_BYTES) }
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        // The check reads the stream once; the stop comes with the first bytes of the second read.
        assertEquals(RunEnd.ENDED, runBlocking { run.run(asked = false) { water.bytesRead > bytes.size } })
        assertTrue("the skip ended at the stop", water.bytesRead < bytes.size + 2L * SyncRun.CHUNK_BYTES)
        assertFalse("/v1/files/send" in server.paths())
    }

    @Test
    fun aRunStoppedAfterA0CReadsNoInfo() {
        joined()
        run()
        storeOnServer("water", 1)
        server.refuseNext("/v1/changes", 0x0c)
        var stopped = false
        server.onRequest = { path -> if (path == "/v1/changes") stopped = true }
        server.requests.clear()
        assertEquals(RunEnd.ENDED, runBlocking { run.run(asked = false) { stopped } })
        assertFalse("/v1/info" in server.paths())
    }

    @Test
    fun aStreamLongerThanItsChunksCanBeNumberedLeavesTheApp() {
        joined()
        run()
        val bytes = ByteArray(10) { 1 }
        val fileId = id(0x4d)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes), Long.MAX_VALUE, 0, 0))
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        assertFalse("/v1/files/have" in server.paths())
        assertTrue("nothing is said about the stream", water.sent.isEmpty())
    }

    @Test
    fun aStatusOfAnotherEpochAfterAChangedCursorFetchesNothing() {
        joined()
        run()
        water.toSend += id(7) to blob(server.keyId, 7)
        var once = true
        water.onExport = {
            if (once) {
                // Another device stored the same record first: the batch is answered "changed after the cursor".
                once = false
                server.records.getOrPut("water") { mutableListOf() } += FakeRecord(id(7), 1, blob(server.keyId, 8))
                server.heads["water"] = 1
                water.statusEpoch = syncId(9)
            }
        }
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        assertTrue("the batch was sent", server.requests.any { it.method == RequestMethod.POST && it.url.contains("/v1/changes") })
        assertFalse("no fetch with that status", server.requests.any { it.method == RequestMethod.GET && it.url.contains("/v1/changes") })
    }

    @Test
    fun aRunStoppedAfterA04SendsTheRequestNoMoreTimes() {
        joined()
        run()
        server.refuseNext("/v1/heads", 0x04)
        var stopped = false
        server.onRequest = { path -> if (path == "/v1/heads") stopped = true }
        server.requests.clear()
        assertEquals(RunEnd.ENDED, runBlocking { run.run(asked = false) { stopped } })
        assertEquals(1, server.paths().count { it == "/v1/heads" })
    }

    @Test
    fun aFetchedStreamWithAllItsBytesHereIsFinishedWithoutAFetch() {
        joined()
        run()
        val fileId = id(0x4e)
        water.streams = listOf(ListedStream(StreamWork.FETCH, uuid(fileId), sha256(ByteArray(10)), 10, 10, 0))
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        assertFalse("/v1/files/fetch" in server.paths())
        assertEquals(listOf(hex(fileId)), water.finished)
    }

    @Test
    fun aNewKeyIdOfTheServerReachesEveryApp() {
        joined()
        run()
        water.calls.clear()
        server.keyId = KeyId(0x01020304)
        run()
        assertEquals(KeyId(0x01020304), store.now().keyId)
        assertTrue("water was served", "status" in water.calls)
    }

    @Test
    fun aNewKeyIdReachesEveryAppAlsoAfterARunThatEndedAtTheListOfDevices() {
        joined()
        run()
        server.keyId = KeyId(0x01020304)
        server.revision = 3
        server.answerNext("/v1/devices", HttpResult.NoAnswer)
        run()
        water.calls.clear()
        run()
        assertTrue("water was served", "status" in water.calls)
    }

    @Test
    fun aRunStoppedWhileAChunkIsReadReadsNoMoreOfIt() {
        joined()
        run()
        val bytes = ByteArray(3 * SyncRun.CHUNK_BYTES) { (it % 3).toByte() }
        val fileId = id(0x4f)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes), bytes.size.toLong(), 0, 0))
        // A pipe that gives at most 1,000 bytes at a time, as a slow app's pipe may.
        water.readLimit = 1_000
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        // The check reads the stream once; the stop comes with the first bytes of the second read.
        assertEquals(RunEnd.ENDED, runBlocking { run.run(asked = false) { water.bytesRead > bytes.size } })
        assertTrue("the chunk was not read to its end", water.bytesRead < bytes.size + SyncRun.CHUNK_BYTES)
        assertFalse("/v1/files/send" in server.paths())
    }

    @Test
    fun aRunStoppedWhileAChunkIsWrittenWritesNoMoreOfIt() {
        joined()
        run()
        val bytes = ByteArray(SyncRun.CHUNK_BYTES) { (it % 7).toByte() }
        val fileId = id(0x50)
        val hash = sha256(bytes)
        server.chunks["water/${hex(fileId)}/${hex(hash)}/0"] = bytes
        water.streams = listOf(ListedStream(StreamWork.FETCH, uuid(fileId), hash, bytes.size.toLong(), 0, 0))
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        // The stop comes with the first bytes the app takes.
        assertEquals(RunEnd.ENDED, runBlocking { run.run(asked = false) { (water.written[hex(fileId)]?.size() ?: 0) > 0 } })
        assertTrue("the chunk was not written to its end", water.written.getValue(hex(fileId)).size() < bytes.size)
        assertTrue("nothing is finished", water.finished.isEmpty())
    }

    @Test
    fun aFullServerAtAFileRequestStopsSendingAndFetchingGoesOn() {
        joined()
        run()
        val sendBytes = ByteArray(10) { 4 }
        val sendId = id(0x51)
        water.stored[hex(sendId)] = sendBytes
        val fetchBytes = ByteArray(10) { 6 }
        val fetchId = id(0x52)
        val fetchHash = sha256(fetchBytes)
        server.chunks["water/${hex(fetchId)}/${hex(fetchHash)}/0"] = fetchBytes
        water.streams = listOf(
            ListedStream(StreamWork.SEND, uuid(sendId), sha256(sendBytes), 10, 0, 0),
            ListedStream(StreamWork.FETCH, uuid(fetchId), fetchHash, 10, 0, 0),
        )
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.refuseNext("/v1/files/send", 0x08)
        assertEquals(RunEnd.WORKED, run())
        assertTrue(store.now().full)
        assertEquals("the fetch went on", listOf(hex(fetchId)), water.finished)
    }

    @Test
    fun aLeaveJustAfterTheRunLookedAtTheStateIsKept() {
        joined()
        run()
        var hook: () -> Unit = {}
        val hooked = object : Clock {
            override fun nowMillis(): Long {
                val once = hook
                hook = {}
                once()
                return clock.nowMillis
            }
        }
        val sync = keys.sync.crypto.sync
        val late = SyncRun(store, SyncServer(server, sync, hooked), couriers, sync, { metered }, ProblemWriter(store, sync, scheduler, hooked), hooked)
        // The user leaves right after the run saw the phone joined.
        hook = { forgetServer(store, sync, scheduler) }
        assertEquals(RunEnd.NOT_JOINED, runBlocking { late.run(asked = false) })
        assertEquals(Stage.NOT_JOINED, store.now().stage)
        assertNull(store.now().stop)
    }

    @Test
    fun aNewEpochReachesAnAppThatCouldNotBeCalledWhenItCame() {
        joined()
        run()
        // Notes is being updated: Sync cannot call it in the run that finds the new epoch.
        couriers.apps.remove(notes)
        server.epoch = syncId(7)
        run()
        couriers.apps.add(notes)
        notes.calls.clear()
        run()
        assertTrue("notes is served", "status" in notes.calls)
        assertEquals(syncId(7), notes.epoch)
    }

    @Test
    fun aStatusAfterAChangedCursorThatCannotSyncFetchesNothing() {
        joined()
        run()
        water.toSend += id(7) to blob(server.keyId, 7)
        var once = true
        water.onExport = {
            if (once) {
                once = false
                server.records.getOrPut("water") { mutableListOf() } += FakeRecord(id(7), 1, blob(server.keyId, 8))
                server.heads["water"] = 1
                // The app cannot sync from now on, as when its keys cannot be used.
                water.canSync = false
            }
        }
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        assertTrue("the batch was sent", server.requests.any { it.method == RequestMethod.POST && it.url.contains("/v1/changes") })
        assertFalse("no fetch with that status", server.requests.any { it.method == RequestMethod.GET && it.url.contains("/v1/changes") })
    }

    @Test
    fun aPokeWhoseStatusDoesNotComeStaysAsWork() {
        joined()
        run()
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        water.failCalls += "status"
        run()
        assertFalse(store.now().app("water").poked)
        assertTrue("the next run serves the app again", store.now().app("water").work)
    }

    @Test
    fun aPokeWhoseRunStopsBeforeItsStatusStaysAsWork() {
        joined()
        run()
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        // Android stops the job as soon as the serve of the app has begun.
        assertEquals(RunEnd.ENDED, runBlocking { run.run(asked = false) { !store.now().app("water").poked } })
        assertTrue("the next run serves the app again", store.now().app("water").work)
    }

    @Test
    fun aStreamThatChangedInAChunkTheServerHasDoesNotFit() {
        joined()
        run()
        val bytes = ByteArray(3 * SyncRun.CHUNK_BYTES) { (it % 9).toByte() }
        val fileId = id(0x53)
        val hash = sha256(bytes)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), hash, bytes.size.toLong(), 0, 0))
        repeat(2) { number -> server.chunks["water/${hex(fileId)}/${hex(hash)}/$number"] = ByteArray(SyncRun.CHUNK_BYTES) }
        // The stored file changes in its first chunk, which the server has, between the check and the read that sends.
        water.changedRead = water.reads + 2
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        server.requests.clear()
        run()
        assertFalse("/v1/files/send" in server.paths())
        assertEquals(listOf(hex(fileId) to false), water.sent)
    }

    @Test
    fun aStreamThatGrewAfterItsCheckDoesNotFit() {
        joined()
        run()
        val bytes = ByteArray(10) { 7 }
        val fileId = id(0x54)
        water.stored[hex(fileId)] = bytes
        water.streams = listOf(ListedStream(StreamWork.SEND, uuid(fileId), sha256(bytes), 10, 0, 0))
        // The stored file grows by a byte between the check and the read that sends.
        water.grownRead = water.reads + 2
        store.update { state -> state.withApp("water") { it.copy(poked = true) } }
        run()
        assertEquals(listOf(hex(fileId) to false), water.sent)
    }
}
