package app.shkriuss.core.sync

import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.data.RecordFields
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Every reason to skip a record, the first skipped number, and stopping
 * (docs/architecture/sync-protocol.md, "What a reader checks" and "Records
 * that are skipped"), and hostile pages ("What the tests must cover",
 * `core/sync-client` points 6 and 7). A skipped record is never written,
 * and the cursor moves past it.
 */
@RunWith(RobolectricTestRunner::class)
class SkipsTest : SyncTest() {
    private val id = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"

    private fun item(title: String, at: Long, deletedAt: Long? = null) =
        SyncRecord(BackupRecord(ListsContent.ITEM, RecordFields(id, createdAt = at, updatedAt = at, deletedAt = deletedAt), title.toByteArray()))

    @Test
    fun aRecordOfAnotherRecoveryKeyIsSkippedAndAnsweredWithTheAppsOwnVersion() = runBlocking {
        val phone = device("phone")
        val own = phone.addItem("Milk")
        phone.runUntilQuiet()
        val stranger = SoftwareKeysApp(temporary.newFolder(), AppName.of("lists")).crypto.also {
            it.setup.storeDerivedKeys(it.setup.createRecoveryKey())
        }
        val record = phone.content.syncRecordOf(own.copy(title = "Not ours"))
        val number = server.put(LISTS.value, own.record.id, stranger.records.seal(own.record.id, SealedPlaintext.encode(1, record.entry, null)))

        phone.fetchAll()
        val status = phone.status()
        assertEquals(1L, status.counts.anotherRecoveryKey)
        assertEquals(number, status.cursor)
        assertEquals("never written", "Milk", phone.database.items().find(own.record.id)?.title)
        assertTrue("the app syncs with the server's key: its own version goes", status.hasOrdinaryChanges)
    }

    @Test
    fun aDamagedRecordIsSkippedAndAnsweredOnceUntilAVersionOpens() = runBlocking {
        val phone = device("phone")
        val own = phone.addItem("Milk")
        phone.runUntilQuiet()
        val damaged = phone.seal(phone.content.syncRecordOf(own)).also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() }

        server.put(LISTS.value, own.record.id, damaged)
        phone.fetchAll()
        assertEquals(1L, phone.status().counts.damaged)
        assertEquals("answered with its own version", listOf(0x00), phone.sendAll(comparison = false))

        server.put(LISTS.value, own.record.id, damaged)
        phone.fetchAll()
        assertEquals(2L, phone.status().counts.damaged)
        assertFalse("a damaged version of it is not answered again", phone.status().hasOrdinaryChanges)

        // A version opens: the next damaged one is answered again.
        phone.fetchAll()
        server.put(LISTS.value, own.record.id, phone.seal(phone.content.syncRecordOf(own)))
        phone.fetchAll()
        server.put(LISTS.value, own.record.id, damaged)
        phone.fetchAll()
        assertTrue(phone.status().hasOrdinaryChanges)
    }

    @Test
    fun aNewerRecordStopsSendingUntilTheAppIsUpdatedAndIsThenFetchedAgain() = runBlocking {
        val newer = device("newer", dataVersion = 2)
        val older = device("older", dataVersion = 1)
        val pinned = newer.addItem("Milk")
        newer.pinItem(pinned.record.id)
        newer.runUntilQuiet()
        val olderItem = older.addItem("Bread")

        older.fetchAll()
        val status = older.status()
        assertEquals(1L, status.counts.newer)
        assertEquals(SendBlock.UPDATE_THE_APP, status.sendBlock)
        assertNull("never written", older.database.items().find(pinned.record.id))
        assertEquals("it stopped sending", ExportResult.NothingToSend, older.client.export(older.call(), ExportRequest(false, 100, server.mostBytes)))

        // The app is updated to data version 2: it fetches from just below the skipped record, and sends again.
        val updated = updated(older, dataVersion = 2)
        updated.runUntilQuiet()
        assertEquals(SendBlock.NONE, updated.status().sendBlock)
        assertEquals(0L, updated.status().counts.newer)
        assertEquals(true, updated.database.items().find(pinned.record.id)?.pinned)
        assertTrue(olderItem.record.id in server.ids(LISTS.value))
    }

    @Test
    fun aRecordOfALowerDataVersionIsReadByTheReaderOfThatVersion() = runBlocking {
        val older = device("older", dataVersion = 1)
        val newer = device("newer", dataVersion = 2)
        val milk = older.addItem("Milk")
        older.runUntilQuiet()

        newer.runUntilQuiet()
        assertEquals(false, newer.database.items().find(milk.record.id)?.pinned)
        assertEquals("Milk", newer.database.items().find(milk.record.id)?.title)
    }

    @Test
    fun aPlaintextOfAHigherVersionIsNewer() = runBlocking {
        val phone = device("phone")
        val plaintext = SealedPlaintext.encode(1, item("Milk", 1_000).entry, null).also { it[0] = 2 }
        server.put(LISTS.value, id, phone.keys.seal(id, plaintext))

        phone.fetchAll()
        assertEquals(1L, phone.status().counts.newer)
        assertEquals(SendBlock.UPDATE_THE_APP, phone.status().sendBlock)
    }

    @Test
    fun recordsThatOpenButBreakALimitOrALayoutAreNotValid() = runBlocking {
        val phone = device("phone")
        val ids = List(6) { "11111111-2222-4333-8444-55555555555$it" }
        fun item(at: Int, title: String = "Milk", time: Long = 1_000) =
            SyncRecord(BackupRecord(ListsContent.ITEM, RecordFields(ids[at], createdAt = time, updatedAt = time, deletedAt = null), title.toByteArray()))
        val notValid = listOf(
            // The ID inside is not the ID outside.
            ids[0] to phone.keys.seal(ids[0], SealedPlaintext.encode(1, item(1).entry, null)),
            // A type the app does not have.
            ids[1] to phone.seal(SyncRecord(BackupRecord("shelf", item(1).entry.fields, ByteArray(0)))),
            // Content that is not valid: a live item without a title.
            ids[2] to phone.seal(item(2, title = "")),
            // A time no record can hold.
            ids[3] to phone.seal(item(3, time = -5)),
            // A stream part on a record without a stream.
            ids[4] to phone.seal(item(4), StreamPart(10, ByteArray(32))),
            // Something after the stream part.
            ids[5] to phone.keys.seal(ids[5], SealedPlaintext.encode(1, item(5).entry, null) + 0),
        )
        notValid.forEach { (id, blob) -> server.put(LISTS.value, id, blob) }

        phone.fetchAll()
        assertEquals(notValid.size.toLong(), phone.status().counts.notValid)
        assertEquals(emptyList<ItemEntity>(), phone.database.items().all())
        assertEquals(server.head(LISTS.value), phone.status().cursor)
    }

    @Test
    fun theFirstSkippedNumberIsTheLowestAndTheCountsHoldNoContent() = runBlocking {
        val newer = device("newer", dataVersion = 2)
        val phone = device("phone", dataVersion = 1)
        val first = newer.addItem("First").also { newer.pinItem(it.record.id) }
        newer.runUntilQuiet()
        val firstNumber = server.copyOf(LISTS.value, first.record.id)!!.number
        newer.addItem("Second")
        newer.runUntilQuiet()

        phone.fetchAll()
        assertEquals(2L, phone.status().counts.newer)
        val updated = updated(phone, dataVersion = 2)
        updated.fetchAll()
        assertEquals("both are fetched again from just below the first", 2, updated.database.items().all().size)
        assertTrue(firstNumber < server.head(LISTS.value))
    }

    @Test
    fun hostilePagesAreDroppedAndNothingIsWritten() = runBlocking {
        val phone = device("phone")
        val tablet = device("tablet")
        tablet.addItem("Milk")
        tablet.runUntilQuiet()
        val good = server.fetch(LISTS.value, phone.deviceId, 0, 0, phone.epoch, 100)

        val hostile = mapOf(
            "a wrong epoch" to good.copyOf().also { SyncId(ByteArray(16) { 9 }).toBytes().copyInto(it, 1) },
            "a wrong start" to good.copyOf().also { ByteWriter().i64(1).toByteArray().copyInto(it, 17) },
            "a page that is cut" to good.copyOf(good.size - 1),
            "a record too large" to ByteWriter().u8(0).bytes(phone.epoch.toBytes()).i64(0).i64(1).u8(0).i32(1)
                .bytes(RecordIds.toBytes(id)).i64(1).i32(SyncFormat.LARGEST_SEALED + 1).bytes(ByteArray(SyncFormat.LARGEST_SEALED + 1)).toByteArray(),
        )
        hostile.forEach { (what, page) ->
            assertEquals(what, ImportResult.Dropped, phone.client.import(phone.call(), page))
            assertEquals(what, 0L, phone.status().cursor)
            assertEquals(what, emptyList<ItemEntity>(), phone.database.items().all())
        }

        // An ID outside that is not the record's: the blob does not open under it.
        val swapped = good.copyOf().also { RecordIds.toBytes(id).copyInto(it, 1 + 16 + 8 + 8 + 1 + 4) }
        phone.client.import(phone.call(), swapped)
        assertEquals(1L, phone.status().counts.damaged)
        assertEquals(emptyList<ItemEntity>(), phone.database.items().all())
    }
}
