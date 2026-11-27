package app.shkriuss.core.sync

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * A comparison of everything (docs/architecture/sync-protocol.md,
 * "Comparing everything", and "What the tests must cover",
 * `core/sync-client` point 5): against an empty server, a full one, and
 * one that lost records. It ends, also when it was stopped at each step,
 * and ordinary changes go out before it. After new keys: NewRecoveryKeyTest.
 */
@RunWith(RobolectricTestRunner::class)
class ComparisonTest : SyncTest() {
    @Test
    fun againstAnEmptyServerEveryRecordGoesAsAComparisonAndThenItEnds() = runBlocking {
        val phone = device("phone", on = false)
        val milk = phone.addItem("Milk")
        val file = phone.addFile("photo.jpg", ByteArray(500) { 1 })
        phone.client.setOn(true)

        phone.fetchAll()
        val fetched = phone.status()
        assertEquals(ComparisonState.SENDING, fetched.comparison)
        assertTrue(fetched.hasComparisonRecords)
        assertEquals("nothing is ordinary", emptyList<Int>(), phone.sendAll(comparison = false))

        phone.runUntilQuiet()
        assertEquals(ComparisonState.NONE, phone.status().comparison)
        assertEquals(setOf(milk.record.id, file.record.id), server.ids(LISTS.value))
    }

    @Test
    fun againstAFullServerADeviceWithTheSameRecordsSendsNothing() = runBlocking {
        val phone = device("phone")
        repeat(5) { phone.addItem("Item $it") }
        phone.addFile("photo.jpg", ByteArray(500) { 1 })
        phone.runUntilQuiet()
        val stored = server.stored.size

        // The user asks for a comparison: the server has every record as this device has it.
        phone.client.compare(phone.call())
        phone.runUntilQuiet()
        assertEquals(ComparisonState.NONE, phone.status().comparison)
        assertEquals(stored, server.stored.size)

        // A new device takes everything and sends nothing back.
        val tablet = device("tablet")
        tablet.runUntilQuiet()
        assertEquals(phone.records(), tablet.records())
        assertEquals(stored, server.stored.size)
    }

    @Test
    fun aServerThatLostRecordsIsFoundAndFilledAgain() = runBlocking {
        val phone = device("phone")
        val tablet = device("tablet")
        val empty = server.snapshot()
        repeat(3) { phone.addItem("Item $it") }
        phone.runUntilQuiet()
        tablet.runUntilQuiet()

        // The user puts the database back to the day before.
        server.putBack(empty)
        val epoch = server.epoch
        tablet.run()

        assertTrue("the device knew more: a new epoch", server.epoch != epoch)
        phone.runUntilQuiet()
        tablet.runUntilQuiet()
        assertEquals(3, server.ids(LISTS.value).size)
        assertEquals(phone.records(), tablet.records())
        assertEquals(ComparisonState.NONE, phone.status().comparison)
        assertEquals(ComparisonState.NONE, tablet.status().comparison)
    }

    @Test
    fun ordinaryChangesGoOutBeforeTheRecordsOfAComparison() = runBlocking {
        val phone = device("phone", on = false)
        repeat(4) { phone.addItem("Old $it") }
        phone.client.setOn(true)
        phone.fetchAll()

        clock.advanceBy(10)
        val new = phone.addItem("New")
        phone.sendAll(comparison = false)
        assertEquals("only the new item went as ordinary", listOf(new.record.id), server.stored)
        assertTrue(phone.status().hasComparisonRecords)

        phone.sendAll(comparison = true)
        assertEquals(5, server.ids(LISTS.value).size)
        assertEquals(ComparisonState.NONE, phone.status().comparison)
    }

    @Test
    fun aRecordOfTheComparisonThatTheUserChangesBecomesOrdinary() = runBlocking {
        val phone = device("phone", on = false)
        val old = phone.addItem("Old")
        phone.client.setOn(true)
        phone.fetchAll()
        clock.advanceBy(10)
        phone.editItem(old.record.id, "Changed")

        phone.sendAll(comparison = false)
        assertEquals(listOf(old.record.id), server.stored)
        assertEquals(ComparisonState.NONE, phone.status().comparison)
    }

    @Test
    fun aComparisonStoppedAtAnyCallGoesOnAndEnds() = runBlocking {
        for (stopAt in 1..12) {
            newServer()
            val phone = device("phone$stopAt", on = false)
            val tablet = device("tablet$stopAt")
            repeat(3) { tablet.addItem("Tablet $it") }
            tablet.runUntilQuiet()
            repeat(3) { phone.addItem("Phone $it") }
            phone.client.setOn(true)

            // The run stops after a number of calls, as when Android ends it.
            var calls = 0
            suspend fun step(action: suspend () -> Unit): Boolean {
                if (++calls > stopAt) return false
                action()
                return true
            }
            var go = step { phone.fetchAll(most = 1) }
            while (go) {
                val batch = phone.client.export(phone.call(), ExportRequest(true, 1, server.mostBytes)) as? ExportResult.Batch ?: break
                val answer = server.send(LISTS.value, phone.deviceId, batch.bytes.copyOfRange(17, batch.bytes.size))
                go = step { phone.client.exported(phone.call(), batch.token, answer) }
            }

            phone.runUntilQuiet()
            tablet.runUntilQuiet()
            assertEquals("stopped at $stopAt", 6, server.ids(LISTS.value).size)
            assertEquals("stopped at $stopAt", ComparisonState.NONE, phone.status().comparison)
            assertEquals("stopped at $stopAt", phone.records(), tablet.records())
        }
    }
}
