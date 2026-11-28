package app.shkriuss.feature.sync

import app.shkriuss.core.crypto.KeyId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sync's preferences file (docs/apps/sync/spec.md, "Data"): every value
 * goes out and comes back, a value outside its limits counts as missing,
 * and one step is one write of the file.
 */
class SyncStateStoreTest {
    private val preferences = MemoryPreferences()

    private val full = SyncState(
        stage = Stage.STOPPED,
        stop = Stop.UPDATE_SERVER,
        closing = true,
        joinedAt = 5,
        address = "https://sync.example.workers.dev:8443",
        serverId = syncId(1),
        epoch = syncId(2),
        keyId = KeyId(0x0a0b0c0d),
        revision = Long.MAX_VALUE,
        limits = Limits(7, 70_000, 9),
        halved = 7,
        halvedAt = 6,
        deviceAlias = Int.MAX_VALUE,
        deviceId = syncId(3),
        name = "Pixel 9 Pro",
        codeKind = CodeKind.SETUP_CODE,
        setupCode = "ABCDEFGHJKLMNPQRSTUVWXYZ23",
        deleteSetupCode = listOf("https://b.example.org", "https://a.example.org"),
        removed = setOf(syncId(4).hex, syncId(5).hex),
        filesOnMobile = true,
        apps = mapOf("water" to AppSync(head = 12, goodAt = 7, on = true, work = true, poked = true), "notes" to AppSync(head = 3)),
        infoAt = 8,
        statusAt = 9,
        devicesAt = 10,
        failedRuns = 3,
        retryAt = 11,
        dayWait = DayWait.COMPARISONS,
        dayWaitUntil = 12,
        full = true,
        fullAt = 13,
        clockOff = -420_000,
        putBack = true,
        fault = true,
        syncedAt = SyncState.LATEST_TIME,
    )

    @Test
    fun everyValueIsWrittenAndReadBack() {
        SyncStateStore(preferences).update { full }
        assertEquals(full, SyncStateStore(preferences).now())
    }

    @Test
    fun aStepIsOneWriteAndAStepThatChangesNothingWritesNothing() {
        val store = SyncStateStore(preferences)
        store.update { full }
        assertEquals(1, preferences.commits)
        store.update { it }
        assertEquals(1, preferences.commits)
        store.update { it.copy(fault = false, putBack = false) }
        assertEquals(2, preferences.commits)
        assertFalse("false is not stored", "fault" in preferences.values)
    }

    @Test
    fun aWriteTheFileRefusesChangesNothing() {
        val store = SyncStateStore(preferences)
        preferences.failWrites = true
        assertThrows(CouldNotSaveException::class.java) { store.update { full } }
        assertEquals(SyncState(), store.now())
        assertEquals(SyncState(), SyncStateStore(preferences).now())
    }

    @Test
    fun aWriteThatFailsAfterAndroidTookItIntoItsMapIsNotSavedByALaterOne() {
        val store = SyncStateStore(preferences)
        preferences.failAfterTheMap = true
        assertThrows(CouldNotSaveException::class.java) { store.update { full } }
        preferences.failAfterTheMap = false
        store.update { it.copy(filesOnMobile = true) }
        assertEquals(SyncState(filesOnMobile = true), store.now())
        assertEquals("the file holds what the store holds", SyncState(filesOnMobile = true), SyncStateStore(preferences).now())
    }

    @Test
    fun valuesOutsideTheirLimitsCountAsMissing() {
        preferences.values.putAll(
            mapOf(
                "stage" to 9,
                "address" to "http://sync.example.workers.dev",
                "serverId" to "XYZ",
                "keyId" to "0a0b0c0",
                "revision" to -1L,
                "limits" to "0,524288,256",
                "halved" to 8,
                "deviceAlias" to 0,
                "name" to " Pixel",
                "codeKind" to 3,
                "setupCode" to "ABCDEFGHJKLMNPQRSTUVWXYZ2I",
                "deleteSetupCode" to "https://a.example.org https://a.example.org",
                "failedRuns" to 4,
                "infoAt" to SyncState.LATEST_TIME + 1,
                "syncedAt" to -1L,
                "dayWait" to 2,
                "head.water" to -5L,
                "good.water" to 253_402_300_800_000L,
                "on.Water" to true,
                "fault" to "true",
            ),
        )
        val state = SyncStateStore(preferences).now()
        assertEquals(SyncState(apps = mapOf("water" to AppSync())), state)
    }

    @Test
    fun aStopIsSetExactlyWhenSyncStopped() {
        preferences.values["stage"] = 4
        assertEquals("a stop that cannot be read: the phone joins again", Stop.KEYS_GONE, SyncStateStore(preferences).now().stop)
        preferences.values["stage"] = 3
        preferences.values["stop"] = 2
        assertNull(SyncStateStore(preferences).now().stop)
    }

    @Test
    fun thisPhoneIsNeverAmongTheRemovedAndAtMost10000AreKept() {
        preferences.values["deviceId"] = syncId(3).hex
        preferences.values["removed"] = "${syncId(3).hex} ${syncId(4).hex}"
        assertEquals(emptySet<String>(), SyncStateStore(preferences).now().removed)
        assertThrows(IllegalArgumentException::class.java) { SyncState(removed = (0 until 10_001).map { "%032x".format(it) }.toSet()) }
        assertTrue(SyncState(removed = (0 until 10_000).map { "%032x".format(it) }.toSet()).removed.size == 10_000)
    }

    @Test
    fun theLimitsOfInfoAreKeptAsTheNearestBound() {
        assertEquals(Limits(1, 65_536, 256), Limits.nearest(0, 1, 1_000))
        assertEquals(Limits(100, 524_288, 1), Limits.nearest(4_294_967_295, 4_294_967_295, 0))
    }
}
