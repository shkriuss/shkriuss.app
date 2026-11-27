package app.shkriuss.core.sync

import app.shkriuss.core.crypto.KeyId
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The send rules (docs/architecture/sync-protocol.md, "Sending", and
 * "What the tests must cover", `core/sync-client` point 4): **Just taken**,
 * **To send**, every reason to hold a record back, each refusal, the
 * cursor's two moves, and a stop between a batch and its `exported`.
 */
@RunWith(RobolectricTestRunner::class)
class SendRulesTest : SyncTest() {
    @Test
    fun aRecordThatCameFromSyncIsNotSentBackUntilTheUserChangesIt() = runBlocking {
        val phone = device("phone")
        val tablet = device("tablet")
        val milk = phone.addItem("Milk")
        phone.runUntilQuiet()

        tablet.run()
        assertEquals("Just taken: the tablet sends nothing back", listOf(milk.record.id), server.stored)
        assertFalse(tablet.status().hasOrdinaryChanges)

        clock.advanceBy(10)
        tablet.editItem(milk.record.id, "Oat milk")
        tablet.run()
        assertEquals(listOf(milk.record.id, milk.record.id), server.stored)
    }

    @Test
    fun aRecordStaysInToSendUntilTheServerStoredItAndAStopBeforeExportedLosesNothing() = runBlocking {
        val phone = device("phone")
        val milk = phone.addItem("Milk")

        // The Sync app sends the batch, and stops before it hands the answer back.
        val batch = phone.client.export(phone.call(), ExportRequest(false, 100, server.mostBytes)) as ExportResult.Batch
        server.send(LISTS.value, phone.deviceId, batch.bytes.copyOfRange(17, batch.bytes.size))
        assertTrue("still to send", phone.status().hasOrdinaryChanges)

        // At the next run the record goes again, is refused because the server's copy is newer than the cursor,
        // and the fetch that follows finds it the same.
        assertEquals(listOf(0x01), phone.sendAll(comparison = false))
        assertFalse(phone.status().hasOrdinaryChanges)
        assertEquals("stored once", listOf(milk.record.id), server.stored)
        phone.run()
        assertEquals("and nothing is sent again", listOf(milk.record.id), server.stored)
    }

    @Test
    fun aNewExportVoidsTheTokenOfTheBatchBeforeAndAWrongAnswerChangesNothing() = runBlocking {
        val phone = device("phone")
        phone.addItem("Milk")
        val first = phone.client.export(phone.call(), ExportRequest(false, 100, server.mostBytes)) as ExportResult.Batch
        val second = phone.client.export(phone.call(), ExportRequest(false, 100, server.mostBytes)) as ExportResult.Batch
        val answer = server.send(LISTS.value, phone.deviceId, second.bytes.copyOfRange(17, second.bytes.size))

        assertEquals(ExportedResult.IGNORED, phone.client.exported(phone.call(), first.token, answer))
        assertEquals("not an answer", ExportedResult.IGNORED, phone.client.exported(phone.call(), second.token, byteArrayOf(0, 1, 2)))
        assertEquals("the token was used up", ExportedResult.IGNORED, phone.client.exported(phone.call(), second.token, answer))
        assertTrue(phone.status().hasOrdinaryChanges)

        val third = phone.client.export(phone.call(), ExportRequest(false, 100, server.mostBytes)) as ExportResult.Batch
        val otherEpoch = server.send(LISTS.value, phone.deviceId, third.bytes.copyOfRange(17, third.bytes.size)).also {
            SyncId(ByteArray(16) { 9 }).toBytes().copyInto(it, 1)
        }
        assertEquals("an answer of another epoch", ExportedResult.IGNORED, phone.client.exported(phone.call(), third.token, otherEpoch))
        assertTrue(phone.status().hasOrdinaryChanges)
    }

    @Test
    fun theCursorMovesToTheHeadAfterABatchOnlyIfNothingElseLayBetween() = runBlocking {
        val phone = device("phone")
        val tablet = device("tablet")
        phone.addItem("Milk")
        phone.run()
        assertEquals("nothing lay between: the cursor is the head", server.head(LISTS.value), phone.status().cursor)

        tablet.addItem("Bread")
        tablet.sendAll(comparison = false)
        val before = phone.status().cursor
        clock.advanceBy(10)
        phone.addItem("Tea")
        phone.sendAll(comparison = false)
        val status = phone.status()
        assertEquals("the tablet's record lies between: the cursor stays", before, status.cursor)
        assertEquals("Known is the head after the batch", server.head(LISTS.value), status.known)

        phone.fetchAll()
        assertEquals(3, phone.database.items().all().size)
        assertEquals(server.head(LISTS.value), phone.status().cursor)
    }

    @Test
    fun aDeletedRecordIsSentOnlyOnceWipedInAnAppThatWipes() = runBlocking {
        val phone = device("phone")
        val milk = phone.addItem("Milk")
        phone.run()
        clock.advanceBy(10)
        phone.deleteItem(milk.record.id)
        phone.run()
        assertEquals("held back while Undo is open", 1, server.stored.size)

        phone.wipeItem(milk.record.id)
        phone.run()
        assertEquals(2, server.stored.size)
    }

    @Test
    fun anAppThatDoesNotWipeSendsADeletionAtOnce() = runBlocking {
        val phone = device("phone", wipes = false)
        val milk = phone.addItem("Milk")
        phone.run()
        clock.advanceBy(10)
        phone.deleteItem(milk.record.id)
        phone.run()
        assertEquals(2, server.stored.size)
    }

    @Test
    fun aFilesRecordWaitsUntilItsStreamIsOnTheServer() = runBlocking {
        val phone = device("phone")
        val file = phone.addFile("photo.jpg", ByteArray(100) { 3 })

        assertEquals("held back: the server does not have its stream", emptyList<Int>(), phone.sendAll(comparison = false))
        assertTrue(phone.status().hasStreamsToMove)
        phone.moveStreams()
        assertFalse(phone.status().hasStreamsToMove)
        assertEquals(listOf(0x00), phone.sendAll(comparison = false))
        assertEquals(listOf(file.record.id), server.stored)
        assertEquals(1, server.streams.size)
    }

    @Test
    fun aFilesRecordWhoseKeyNamesAnotherKeyIdWaitsUntilItIsSealedAgain() = runBlocking {
        val phone = device("phone")
        val file = phone.addFile("photo.jpg", ByteArray(100) { 3 })
        phone.sealFileAgain(file.record.id, KeyId(0x01020304))
        assertEquals(emptyList<Int>(), phone.sendAll(comparison = false))
        phone.moveStreams()
        assertEquals("the stream went up, the record still waits", emptyList<Int>(), phone.sendAll(comparison = false))
        assertEquals(1, server.streams.size)

        phone.sealFileAgain(file.record.id)
        assertEquals(listOf(0x00), phone.sendAll(comparison = false))
    }

    @Test
    fun everyFilesRecordWaitsWhileAFileKeyIsSealedByAKeyOnlyOnThisPhone() = runBlocking {
        val phone = device("phone")
        val file = phone.addFile("photo.jpg", ByteArray(100) { 3 })
        phone.content.fileKeysOnlyHere = true
        phone.addItem("Milk")
        assertEquals("the item goes, the file waits", listOf(0x00), phone.sendAll(comparison = false))
        phone.moveStreams()
        assertEquals(emptyList<Int>(), phone.sendAll(comparison = false))

        phone.content.fileKeysOnlyHere = false
        assertEquals(listOf(0x00), phone.sendAll(comparison = false))
        assertTrue(file.record.id in server.stored)
    }

    @Test
    fun aRecordTooLargeToSealIsCountedAndTheOthersGo() = runBlocking {
        val phone = device("phone")
        phone.addItem("x".repeat(SyncFormat.LARGEST_SEALED))
        val milk = phone.addItem("Milk")

        assertEquals(listOf(0x00), phone.sendAll(comparison = false))
        assertEquals(listOf(milk.record.id), server.stored)
        val status = phone.status()
        assertEquals(1L, status.counts.tooLarge)
        assertFalse("taken out of To send", status.hasOrdinaryChanges)
    }

    @Test
    fun theLimitsOfTheSyncAppMakeSmallerBatchesAndOneRecordAloneAlwaysGoes() = runBlocking {
        val phone = device("phone")
        repeat(5) { phone.addItem("Item $it") }
        phone.addItem("y".repeat(300_000))

        val sizes = mutableListOf<Int>()
        while (true) {
            val batch = phone.client.export(phone.call(), ExportRequest(false, mostRecords = 2, mostBytes = 65_536)) as? ExportResult.Batch ?: break
            sizes += ByteReader(batch.bytes, 50).u32().toInt()
            phone.client.exported(phone.call(), batch.token, server.send(LISTS.value, phone.deviceId, batch.bytes.copyOfRange(17, batch.bytes.size)))
        }
        assertEquals(listOf(2, 2, 1, 1), sizes)
    }

    @Test
    fun eachRefusalOfTheServerIsHandled() = runBlocking {
        val phone = device("phone")
        val milk = phone.addItem("Milk")

        // 03: not a sealed record. It leaves To send and is counted.
        phone.exportAndAnswer { answer(it, 0x03) }
        assertFalse(phone.status().hasOrdinaryChanges)
        assertEquals(1L, phone.status().counts.refusedByTheServer)

        // 05: its file's chunks are being deleted. It stays.
        clock.advanceBy(10)
        phone.editItem(milk.record.id, "Oat milk")
        phone.exportAndAnswer { answer(it, 0x05) }
        assertTrue(phone.status().hasOrdinaryChanges)

        // 02: another key ID. The app stops and asks for the new recovery key.
        phone.exportAndAnswer { answer(it, 0x02) }
        val status = phone.status()
        assertEquals(SendBlock.ENTER_THE_NEW_RECOVERY_KEY, status.sendBlock)
        assertEquals(ExportResult.NothingToSend, phone.client.export(phone.call(), ExportRequest(false, 100, server.mostBytes)))
    }

    /** The server's answer `00` to [batch], with [code] for each record and no new number. */
    private fun answer(batch: ByteArray, code: Int): ByteArray {
        val count = ByteReader(batch, 50).u32().toInt()
        val head = server.head(LISTS.value)
        val writer = ByteWriter().u8(0).bytes(server.epoch.toBytes()).i64(head).i64(head).i32(count)
        repeat(count) { writer.u8(code) }
        return writer.toByteArray()
    }
}
