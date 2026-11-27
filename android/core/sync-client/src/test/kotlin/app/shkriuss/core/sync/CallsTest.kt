package app.shkriuss.core.sync

import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The calls as a whole: what is refused, what an app with sync off gives,
 * and a stop inside a call's transaction, which writes nothing, so that
 * the call can be made again ("What the tests must cover",
 * `core/sync-client` point 3).
 */
@RunWith(RobolectricTestRunner::class)
class CallsTest : SyncTest() {
    private suspend fun refusal(block: suspend () -> Unit): Refusal? = try {
        block()
        null
    } catch (refused: CourierRefused) {
        refused.refusal
    }

    @Test
    fun aVersionOfTheCourierInterfaceThisAppDoesNotKnowIsRefused() = runBlocking {
        val phone = device("phone")
        val call = phone.call().let { CourierCall(2, it.serverId, it.epoch, it.deviceId, it.serverKeyId) }
        assertEquals(Refusal.UPDATE, refusal { phone.client.status(call) })
        assertEquals(Refusal.UPDATE, refusal { phone.client.export(call, ExportRequest(false, 100, 65_536)) })
        assertEquals(Refusal.UPDATE, refusal { phone.client.import(call, ByteArray(0)) })
    }

    @Test
    fun anAppWithSyncOffGivesNothingAndTakesNothing() = runBlocking {
        val tablet = device("tablet")
        tablet.addItem("Milk")
        tablet.runUntilQuiet()
        val phone = device("phone", on = false)
        phone.addItem("Bread")

        val status = phone.status()
        assertFalse(status.isOn)
        assertFalse(status.hasOrdinaryChanges)
        assertEquals(ExportResult.NothingToSend, phone.client.export(phone.call(), ExportRequest(false, 100, 65_536)))
        val page = server.fetch(LISTS.value, phone.deviceId, 0, 0, server.epoch, 100)
        assertEquals(Refusal.OFF, refusal { phone.client.import(phone.call(), page) })
        assertEquals(1, phone.database.items().all().size)
        assertFalse(phone.client.isOn())

        // Turned on, it compares everything once.
        phone.client.setOn(true)
        phone.runUntilQuiet()
        assertEquals(2, phone.database.items().all().size)
        assertEquals(2, server.ids(LISTS.value).size)
    }

    @Test
    fun withoutKeysItCannotSyncNowAndAnImportIsRefusedAsAWhole() = runBlocking {
        val tablet = device("tablet")
        tablet.addItem("Milk")
        tablet.runUntilQuiet()
        val phone = device("phone", join = false)
        phone.keys.notNow = SoftwareKeysApp(temporary.newFolder(), LISTS).crypto

        assertFalse(phone.status().canSyncNow)
        assertNull(phone.status().keyId)
        val page = server.fetch(LISTS.value, phone.deviceId, 0, 0, server.epoch, 100)
        assertEquals(Refusal.NOT_NOW, refusal { phone.client.import(phone.call(), page) })
        assertEquals(0L, phone.status().cursor)
        assertEquals(ExportResult.NothingToSend, phone.client.export(phone.call(), ExportRequest(false, 100, 65_536)))

        phone.keys.notNow = null
        phone.runUntilQuiet()
        assertEquals(tablet.records(), phone.records())
    }

    @Test
    fun aStopInsideAnImportWritesNothingAndTheSamePageIsTakenLater() = runBlocking {
        val tablet = device("tablet")
        tablet.addItem("Milk")
        tablet.addItem("Bread")
        tablet.runUntilQuiet()
        val phone = device("phone", join = false)
        val page = server.fetch(LISTS.value, phone.deviceId, 0, 0, server.epoch, 100)

        // The write of Just taken fails after the first record was written, as when the app is stopped there.
        refuseWrites(phone, SyncSql.TAKEN)
        try {
            phone.client.import(phone.call(), page)
            fail("the import went through")
        } catch (_: Exception) {
            // Expected: the write failed.
        }
        allowWrites(phone, SyncSql.TAKEN)
        assertEquals(emptyList<ItemEntity>(), phone.database.items().all())
        assertEquals(0L, phone.status().cursor)

        assertTrue(phone.client.import(phone.call(), page) is ImportResult.Taken)
        assertEquals(tablet.records(), phone.records())
        phone.runUntilQuiet()
        assertEquals("nothing was sent back", 2, server.stored.size)
    }

    @Test
    fun aStopInsideAnExportOrAnExportedLosesNothing() = runBlocking {
        val phone = device("phone")
        val milk = phone.addItem("Milk")

        refuseWrites(phone, SyncSql.BATCH)
        try {
            phone.client.export(phone.call(), ExportRequest(false, 100, 65_536))
            fail("the export went through")
        } catch (_: Exception) {
            // Expected: the write failed.
        }
        allowWrites(phone, SyncSql.BATCH)

        val batch = phone.client.export(phone.call(), ExportRequest(false, 100, 65_536)) as ExportResult.Batch
        val answer = server.send(LISTS.value, phone.deviceId, batch.bytes.copyOfRange(17, batch.bytes.size))
        refuseWrites(phone, SyncSql.SEND)
        try {
            phone.client.exported(phone.call(), batch.token, answer)
            fail("exported went through")
        } catch (_: Exception) {
            // Expected: the write failed.
        }
        allowWrites(phone, SyncSql.SEND)
        assertTrue(phone.status().hasOrdinaryChanges)

        phone.runUntilQuiet()
        assertEquals(listOf(milk.record.id), server.stored)
        assertFalse(phone.status().hasOrdinaryChanges)
    }

    @Test
    fun afterTheLastPageTheAppSetsItsAlarmsAgain() = runBlocking {
        val tablet = device("tablet")
        val phone = device("phone")
        repeat(3) { tablet.addItem("Item $it") }
        tablet.runUntilQuiet()
        val before = phone.content.afterImports

        assertEquals("three pages", 3, phone.fetchAll(most = 1))
        assertEquals("once, after the last", before + 1, phone.content.afterImports)
    }

    @Test
    fun aStopBeforeTheAlarmsAreSetAgainIsFinishedByTheNextCall() = runBlocking {
        val tablet = device("tablet")
        val phone = device("phone")
        tablet.addItem("Milk")
        tablet.runUntilQuiet()
        val before = phone.content.afterImports

        phone.content.stopNextAfterImport = true
        try {
            phone.fetchAll()
        } catch (_: IllegalStateException) {
            // Expected: the app stopped after the import's commit, before it set its alarms again.
        }
        assertEquals(before, phone.content.afterImports)
        phone.status()
        assertEquals(before + 1, phone.content.afterImports)
        phone.status()
        assertEquals("once", before + 1, phone.content.afterImports)
    }

    private suspend fun refuseWrites(device: TestDevice, table: String) {
        device.database.useWriterConnection { connection ->
            listOf("INSERT", "UPDATE", "DELETE").forEach {
                connection.executeSQL("CREATE TRIGGER refuse_${it.lowercase()}_$table BEFORE $it ON $table BEGIN SELECT RAISE(ABORT, 'refused'); END")
            }
        }
    }

    private suspend fun allowWrites(device: TestDevice, table: String) {
        device.database.useWriterConnection { connection ->
            listOf("insert", "update", "delete").forEach { connection.executeSQL("DROP TRIGGER refuse_${it}_$table") }
        }
    }
}
