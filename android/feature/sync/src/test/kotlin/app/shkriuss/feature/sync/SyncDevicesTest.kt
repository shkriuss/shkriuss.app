package app.shkriuss.feature.sync

import app.shkriuss.core.crypto.DeviceId
import app.shkriuss.core.crypto.NameKeyState
import app.shkriuss.core.testing.TestClock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The actions of Devices and **Close the server** (docs/apps/sync/
 * spec.md, "Devices" and "Settings"), with their writes in order.
 */
class SyncDevicesTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val clock = TestClock()
    private val keys by lazy { TestKeys(temporary.newFolder()) }
    private val server by lazy { FakeServer(clock) }
    private val store = SyncStateStore(MemoryPreferences())
    private val scheduler = FakeScheduler()
    private val devices by lazy {
        val sync = keys.sync.crypto.sync
        SyncDevices(store, SyncServer(server, sync, clock), sync, scheduler, ProblemWriter(store, sync, scheduler, clock), clock)
    }

    private fun joined(): SyncState {
        val state = joinedState(keys, server, clock)
        store.update { state }
        val sync = keys.sync.crypto.sync
        val own = DeviceId.ofBytes(state.deviceId!!.toBytes())!!
        server.devices += FakeDevice(state.deviceId, ByteArray(65), removed = false, addedAt = 1, sealedName = sync.sealName(own, "Pixel 9 Pro"))
        return state
    }

    @Test
    fun theListOpensTheNamesAndLeavesOutRemovedDevices() {
        joined()
        server.devices += FakeDevice(syncId(8), ByteArray(65), removed = false, addedAt = 2, sealedName = ByteArray(60) { 1 })
        server.devices += FakeDevice(syncId(9), ByteArray(65), removed = true, addedAt = 3, sealedName = ByteArray(60) { 2 })
        val rows = (devices.list() as DeviceAnswer.Done).value
        assertEquals(2, rows.size)
        val own = rows.single { it.thisPhone }
        assertEquals("Pixel 9 Pro", own.name)
        assertNull("a name this phone cannot read", rows.single { !it.thisPhone }.name)
        assertEquals(setOf(syncId(9).hex), store.now().removed)
        assertEquals(clock.nowMillis, store.now().devicesAt)
    }

    @Test
    fun renameSealsTheNameAndStoresItWithTheRevision() {
        joined()
        assertEquals(DeviceAnswer.Done(Unit), devices.rename("Tablet"))
        assertEquals("Tablet", store.now().name)
        assertEquals(1, store.now().revision)
        server.unreachable = true
        assertEquals(DeviceAnswer.Unreachable, devices.rename("Phone"))
        assertEquals("a rename that did not go changes nothing", "Tablet", store.now().name)
    }

    @Test
    fun aRemovedIdIsKeptBeforeTheRequestSoAFailedRemoveIsMadeAgain() {
        joined()
        val lost = FakeDevice(syncId(8), ByteArray(65), removed = false, addedAt = 2, sealedName = ByteArray(60))
        server.devices += lost
        server.unreachable = true
        assertEquals(DeviceAnswer.Unreachable, devices.remove(syncId(8)))
        assertTrue(syncId(8).hex in store.now().removed)
        server.unreachable = false
        devices.list()
        assertTrue("the next read of the list removes it", lost.removed)
        assertTrue(store.now().putBack)
    }

    @Test
    fun theDeviceCodeComesFromTheServer() {
        joined()
        assertEquals(DeviceAnswer.Done(DeviceCode("ABCD2345", clock.nowMillis + 600_000)), devices.deviceCode())
    }

    @Test
    fun leaveRemovesThisPhoneThenForgetsTheServerAndItsKeys() {
        val state = joined()
        assertEquals(DeviceAnswer.Done(Unit), devices.leave(anyway = false))
        assertTrue(server.devices.single { it.id == state.deviceId }.removed)
        assertEquals(Stage.NOT_JOINED, store.now().stage)
        assertNull(store.now().address)
        assertNull(keys.sync.crypto.sync.deviceKey(state.deviceAlias!!))
        assertEquals(NameKeyState.MISSING, keys.sync.crypto.sync.nameKeyState())
        assertEquals(1, scheduler.cancels)
    }

    @Test
    fun leaveAnywayWhenTheServerCannotBeReached() {
        joined()
        server.unreachable = true
        assertEquals(DeviceAnswer.Unreachable, devices.leave(anyway = false))
        assertEquals(Stage.JOINED, store.now().stage)
        assertEquals(DeviceAnswer.Done(Unit), devices.leave(anyway = true))
        assertEquals(Stage.NOT_JOINED, store.now().stage)
    }

    @Test
    fun closeSetsClosingFirstAndStopsForGood() {
        joined()
        assertEquals(DeviceAnswer.Done(Unit), devices.close())
        assertEquals(ServerState.CLOSED, server.serverState)
        assertEquals(Stop.CLOSED, store.now().stop)
        assertTrue("the dialog of a close shows until it is read", store.now().closing)
        devices.closeRead()
        assertFalse(store.now().closing)
    }

    @Test
    fun aCloseWhoseAnswerWasLostEndsAtTheNext06() {
        joined()
        server.serverState = ServerState.CLOSED
        assertEquals(DeviceAnswer.Done(Unit), devices.close())
        assertEquals(Stop.CLOSED, store.now().stop)
        assertTrue(store.now().closing)
    }

    @Test
    fun anAnswerThatEndsItWritesItsProblem() {
        joined()
        server.refuseNext("/v1/devices", 0x03)
        assertEquals(DeviceAnswer.Problem, devices.list())
        assertEquals(Stop.REMOVED, store.now().stop)
        assertEquals("a device action counts no failed run", 0, store.now().failedRuns)
    }
}
