package app.shkriuss.feature.sync

import android.os.Bundle
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.NameKeyState
import app.shkriuss.core.sync.Courier
import app.shkriuss.core.sync.Refusal
import app.shkriuss.core.sync.SyncAppState
import app.shkriuss.core.sync.SyncStop
import app.shkriuss.core.testing.TestClock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * What Sync does at each start, what its own courier provider answers, and
 * the problems in their order (docs/apps/sync/spec.md, "Stopped between
 * two writes", "Problems"; docs/architecture/sync-protocol.md, "What the
 * Sync app answers").
 */
@RunWith(RobolectricTestRunner::class)
class SyncServicesTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val clock = TestClock()
    private val keys by lazy { TestKeys(temporary.newFolder()) }
    private val server by lazy { FakeServer(clock) }
    private val store = SyncStateStore(MemoryPreferences())
    private val scheduler = FakeScheduler()
    private var metered = false
    private val services by lazy {
        val sync = keys.sync.crypto.sync
        SyncServices(store, sync, SyncServer(server, sync, clock), FakeCouriers(), scheduler, { metered }, clock, "Pixel 9 Pro")
    }
    private val water = AppName.of("water")

    private fun call(method: String, version: Int = Courier.VERSION) = services.answer(water, method, Bundle().apply { putInt(Courier.VERSION_KEY, version) })

    @Test
    fun aJoinedPhoneAsksForItsPeriodicWorkAtEachStart() {
        store.update { joinedState(keys, server, clock) }
        services.startChecks()
        assertEquals(1, scheduler.periodic)
        assertEquals(Stage.JOINED, store.now().stage)
    }

    @Test
    fun aJoinedPhoneThatLostItsKeysStops() {
        store.update { joinedState(keys, server, clock) }
        keys.sync.crypto.sync.deleteNameKey()
        services.startChecks()
        assertEquals(Stop.KEYS_GONE, store.now().stop)
        assertEquals(0, scheduler.periodic)
    }

    @Test
    fun deviceKeysThatNoStateNamesGoAtStart() {
        val sync = keys.sync.crypto.sync
        val left = sync.newDeviceKeyNumber()
        sync.makeDeviceKey(left)
        store.update { joinedState(keys, server, clock) }
        services.startChecks()
        assertNull(sync.deviceKey(left))
        assertTrue(sync.deviceKey(store.now().deviceAlias!!) != null)
    }

    @Test
    fun aRemovedPhoneWhoseKeyStayedLosesItAtTheNextStart() {
        // The deletion after the `03` failed: the state still names the key.
        val state = joinedState(keys, server, clock).copy(stage = Stage.STOPPED, stop = Stop.REMOVED)
        store.update { state }
        services.startChecks()
        assertNull(keys.sync.crypto.sync.deviceKey(state.deviceAlias!!))
        assertEquals(Stop.REMOVED, store.now().stop)
    }

    @Test
    fun aPhoneStoppedForAVersionKeepsItsKey() {
        val state = joinedState(keys, server, clock).copy(stage = Stage.STOPPED, stop = Stop.UPDATE_SERVER)
        store.update { state }
        server.highest = 0
        services.startChecks()
        assertTrue(keys.sync.crypto.sync.deviceKey(state.deviceAlias!!) != null)
    }

    @Test
    fun lostKeysFoundBeforeALeaveStopNothing() {
        val sync = keys.sync.crypto.sync
        val joined = joinedState(keys, server, clock)
        store.update { joined }
        // The check at start read the joined state; the user left before it wrote.
        forgetServer(store, sync, scheduler)
        val problems = ProblemWriter(store, sync, scheduler, clock)
        assertFalse(problems.stop(Stop.KEYS_GONE, onlyIf = { it.isSameDeviceAs(joined) }))
        assertEquals(Stage.NOT_JOINED, store.now().stage)
        store.update { joined }
        assertTrue("the same device still stops", problems.stop(Stop.KEYS_GONE, onlyIf = { it.isSameDeviceAs(joined) }))
        assertEquals(Stop.KEYS_GONE, store.now().stop)
    }

    @Test
    fun aPhoneThatHasNotJoinedKeepsNoKey() {
        val state = joinedState(keys, server, clock)
        services.startChecks()
        assertNull(keys.sync.crypto.sync.deviceKey(state.deviceAlias!!))
        assertEquals(NameKeyState.MISSING, keys.sync.crypto.sync.nameKeyState())
    }

    @Test
    fun aJoinLeftForADayIsCancelled() {
        store.update { it.copy(stage = Stage.JOINING, joinedAt = clock.nowMillis, address = server.address, deleteSetupCode = listOf(server.address)) }
        clock.advanceBy(SyncJoin.JOIN_LIFE_MILLIS - 1)
        services.startChecks()
        assertEquals(Stage.JOINING, store.now().stage)
        clock.advanceBy(1)
        services.startChecks()
        assertEquals(SyncState(deleteSetupCode = listOf(server.address)), store.now())
    }

    @Test
    fun aPhoneStoppedForAVersionReadsInfoAgainAndGoesOnWhenItNamesVersion1() {
        store.update { joinedState(keys, server, clock).copy(stage = Stage.STOPPED, stop = Stop.UPDATE_SERVER) }
        server.highest = 0
        services.startChecks()
        assertEquals(Stop.UPDATE_SERVER, store.now().stop)
        server.highest = 1
        services.startChecks()
        assertEquals(Stage.JOINED, store.now().stage)
        assertEquals(1, scheduler.periodic)
    }

    @Test
    fun aVersionCheckThatPassesClearsTheFaultAndTheClock() {
        store.update { joinedState(keys, server, clock).copy(stage = Stage.STOPPED, stop = Stop.UPDATE_SERVER, fault = true, clockOff = 7 * 60_000L) }
        services.startChecks()
        assertEquals(Stage.JOINED, store.now().stage)
        assertFalse(store.now().fault)
        assertNull(store.now().clockOff)
    }

    @Test
    fun aPokeMarksTheAppAndAsksForARunSoon() {
        store.update { joinedState(keys, server, clock) }
        assertEquals(0, call(Courier.POKE)!!.size())
        assertTrue(store.now().app("water").poked)
        assertEquals(listOf(false), scheduler.soon)
    }

    @Test
    fun aPokeBeforeTheJoinAsksForNothing() {
        call(Courier.POKE)
        assertFalse(store.now().app("water").poked)
        assertEquals(emptyList<Boolean>(), scheduler.soon)
    }

    @Test
    fun theStateSaysWhereThisPhoneStandsForTheAppThatAsks() {
        var state = SyncAppState.read(call(Courier.STATE)!!.getByteArray(Courier.BYTES)!!)!!
        assertFalse(state.joined)
        assertEquals(SyncStop.NOT_JOINED, state.stop)

        store.update { joinedState(keys, server, clock).withApp("water") { it.copy(goodAt = 77) } }
        metered = true
        state = SyncAppState.read(call(Courier.STATE)!!.getByteArray(Courier.BYTES)!!)!!
        assertTrue(state.joined)
        assertEquals(77, state.goodAt)
        assertEquals(SyncStop.NONE, state.stop)
        assertTrue("files wait for an unmetered network", state.filesWaitForUnmetered)

        store.update { it.copy(dayWait = DayWait.EVERYTHING, dayWaitUntil = SyncRun.nextUtcMidnight(clock.nowMillis)) }
        state = SyncAppState.read(call(Courier.STATE)!!.getByteArray(Courier.BYTES)!!)!!
        assertEquals(SyncStop.DAY_LIMIT, state.stop)
        assertEquals(SyncRun.nextUtcMidnight(clock.nowMillis), state.value)
    }

    @Test
    fun aCallOfAnotherVersionIsRefusedAndAnyOtherCallGetsNothing() {
        assertEquals(Refusal.UPDATE.name, call(Courier.STATE, version = 2)!!.getString(Courier.REFUSAL))
        assertNull(call(Courier.EXPORT))
        assertNull(services.answer(water, Courier.STATE, null)?.getByteArray(Courier.BYTES))
    }

    @Test
    fun theProblemsComeInTheirOrder() {
        val joined = joinedState(keys, server, clock)
        val now = clock.nowMillis
        assertNull(problemOf(joined, now))
        assertEquals(SyncProblem.PUT_BACK, problemOf(joined.copy(putBack = true), now))
        assertEquals(SyncProblem.CANNOT_REACH, problemOf(joined.copy(putBack = true, failedRuns = 3), now))
        assertEquals(SyncProblem.FULL, problemOf(joined.copy(failedRuns = 3, full = true), now))
        val day = joined.copy(full = true, dayWait = DayWait.EVERYTHING, dayWaitUntil = SyncRun.nextUtcMidnight(now))
        assertEquals(SyncProblem.DAY_LIMIT, problemOf(day, now))
        assertEquals(SyncProblem.FAULT, problemOf(day.copy(fault = true), now))
        assertEquals(SyncProblem.CLOCK, problemOf(day.copy(fault = true, clockOff = 1), now))
        assertEquals(SyncProblem.UPDATE_SYNC, problemOf(joined.copy(stage = Stage.STOPPED, stop = Stop.UPDATE_SYNC), now))
        assertEquals(SyncProblem.CLOSED, problemOf(joined.copy(stage = Stage.STOPPED, stop = Stop.CLOSED), now))
        assertNull("a join has no problem", problemOf(SyncState(stage = Stage.JOINING), now))
    }

    @Test
    fun tryAgainAsksForARunThatSkipsTheWait() {
        store.update { joinedState(keys, server, clock) }
        assertTrue(services.tryAgain())
        assertEquals(listOf(true), scheduler.soon)
        scheduler.refuse = true
        assertFalse("Could not start a run", services.syncNow())
    }

    @Test
    fun anInfoWhoseAnswerCameAfterALeaveWritesNothing() {
        store.update { joinedState(keys, server, clock).copy(stage = Stage.STOPPED, stop = Stop.UPDATE_SERVER) }
        server.onRequest = { path -> if (path == "/v1/info") forgetServer(store, keys.sync.crypto.sync, scheduler) }
        services.startChecks()
        assertEquals(SyncState(), store.now())
        assertEquals("no periodic job for a server the phone left", 0, scheduler.periodic)
    }
}
