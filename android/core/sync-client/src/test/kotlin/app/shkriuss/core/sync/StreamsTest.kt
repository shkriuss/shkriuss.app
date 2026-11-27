package app.shkriuss.core.sync

import java.io.ByteArrayOutputStream
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Streams (docs/architecture/sync-protocol.md, "Files", and "What the
 * tests must cover", `core/sync-client` point 8).
 */
@RunWith(RobolectricTestRunner::class)
class StreamsTest : SyncTest() {
    private val bytes = ByteArray(10_000) { (it * 7).toByte() }

    /** A phone that sent a file, and a tablet that has its record and wants its stream. */
    private suspend fun fileOnTheServer(): Triple<TestDevice, TestDevice, String> {
        val phone = device("phone")
        val tablet = device("tablet")
        val file = phone.addFile("photo.jpg", bytes)
        phone.runUntilQuiet()
        tablet.fetchAll()
        return Triple(phone, tablet, file.record.id)
    }

    private suspend fun listed(device: TestDevice): List<ListedStream> {
        val list = ByteArrayOutputStream().also { device.client.streams(device.call(), it) }.toByteArray()
        val reader = ByteReader(list, 9)
        return buildList {
            while (reader.remaining > 0) {
                val code = reader.u8()
                val work = StreamWork.entries.first { it.code == code }
                add(ListedStream(work, RecordIds.toText(reader.bytes(16)), reader.bytes(32), reader.i64(), reader.i64(), reader.i64()))
            }
        }
    }

    @Test
    fun aStreamThatDoesNotFitItsHashOrItsLengthIsDeletedAndFetchedAgainAtMostOnceADay() = runBlocking {
        val (_, tablet, id) = fileOnTheServer()
        val wanted = listed(tablet).single()
        assertEquals(StreamWork.FETCH, wanted.work)
        assertEquals(bytes.size.toLong(), wanted.length)

        // Other bytes of the right length.
        tablet.client.writeStream(tablet.call(), id, 0)!!.use { it.write(ByteArray(bytes.size)) }
        assertEquals(StreamFinish.WRONG, tablet.client.finishStream(tablet.call(), id))
        assertEquals(1L, tablet.status().counts.wrongStreams)
        assertFalse(tablet.fetchFolder.resolve(id).exists())
        assertEquals("not again today", emptyList<ListedStream>(), listed(tablet))

        // A day later, the right bytes, but too few of them.
        clock.advanceBy(24L * 60 * 60 * 1000)
        tablet.client.writeStream(tablet.call(), id, 0)!!.use { it.write(bytes, 0, bytes.size - 1) }
        assertEquals(StreamFinish.WRONG, tablet.client.finishStream(tablet.call(), id))

        clock.advanceBy(24L * 60 * 60 * 1000)
        tablet.moveStreams()
        assertEquals(TestDevice.sha256(bytes), tablet.storedStreams()[id])
        assertEquals(emptyList<ListedStream>(), listed(tablet))
    }

    @Test
    fun statusSaysThatAStreamWaitsToBeFetchedAlsoAfterAFetchStoppedOrDidNotFit() = runBlocking {
        val (_, tablet, id) = fileOnTheServer()
        assertTrue(tablet.status().hasStreamsToMove)

        tablet.client.writeStream(tablet.call(), id, 0)!!.use { it.write(bytes, 0, 4_000) }
        assertTrue("the fetch stopped half way", tablet.status().hasStreamsToMove)

        tablet.client.writeStream(tablet.call(), id, 0)!!.use { it.write(ByteArray(bytes.size)) }
        assertEquals(StreamFinish.WRONG, tablet.client.finishStream(tablet.call(), id))
        assertFalse("not again today", tablet.status().hasStreamsToMove)
        clock.advanceBy(24L * 60 * 60 * 1000)
        assertTrue("again a day later", tablet.status().hasStreamsToMove)
    }

    @Test
    fun aFileRecordBroughtBackBeforeItsStreamCameIsSentAndItsStreamFetched() = runBlocking {
        val (_, tablet, id) = fileOnTheServer()
        // The user deletes the file before its stream came, the Sync app looks at the streams, and Undo brings it back.
        clock.advanceBy(10)
        tablet.deleteFile(id)
        tablet.moveStreams()
        tablet.attachments.restore(id)

        tablet.runUntilQuiet()
        assertEquals(TestDevice.sha256(bytes), tablet.storedStreams()[id])
        assertEquals("its restore went to the server", 2, server.stored.count { it == id })
    }

    @Test
    fun aStopBeforeTheStreamOfADeletedFileIsRemovedIsFinishedByTheNextCall() = runBlocking {
        val (phone, tablet, id) = fileOnTheServer()
        tablet.moveStreams()
        clock.advanceBy(10)
        phone.deleteFile(id)
        phone.wipeFile(id)
        phone.runUntilQuiet()

        tablet.content.stopNextRemove = true
        try {
            tablet.fetchAll()
        } catch (_: IllegalStateException) {
            // Expected: the app stopped after the import's commit, before it removed the stream.
        }
        assertTrue("still here", id in tablet.storedStreams())
        tablet.status()
        assertFalse(id in tablet.storedStreams())
    }

    @Test
    fun aFetchThatStopsGoesOnWhereTheBytesEnd() = runBlocking {
        val (_, tablet, id) = fileOnTheServer()
        tablet.client.writeStream(tablet.call(), id, 0)!!.use { it.write(bytes, 0, 4_000) }

        val wanted = listed(tablet).single()
        assertEquals(4_000L, wanted.bytesHere)
        assertNull("not from beyond what is here", tablet.client.writeStream(tablet.call(), id, 5_000))
        tablet.client.writeStream(tablet.call(), id, 4_000)!!.use { it.write(bytes, 4_000, bytes.size - 4_000) }
        assertEquals(StreamFinish.STORED, tablet.client.finishStream(tablet.call(), id))
        assertEquals(TestDevice.sha256(bytes), tablet.storedStreams()[id])
    }

    @Test
    fun noByteIsTakenPastTheLengthTheRecordNames() = runBlocking {
        val (_, tablet, id) = fileOnTheServer()
        val out = tablet.client.writeStream(tablet.call(), id, 0)!!
        out.write(bytes)
        assertThrows(IOException::class.java) { out.write(1) }
        out.close()
        assertEquals(bytes.size.toLong(), tablet.fetchFolder.resolve(id).length())
    }

    @Test
    fun aStreamNoRecordWantsIsNotTaken() = runBlocking {
        val tablet = device("tablet")
        val id = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"
        assertNull(tablet.client.writeStream(tablet.call(), id, 0))
        assertEquals(StreamFinish.NOT_WANTED, tablet.client.finishStream(tablet.call(), id))
        assertNull(tablet.client.readStream(tablet.call(), id))
    }

    @Test
    fun aStoredStreamThatNoLongerFitsItsHashIsNotSent() = runBlocking {
        val phone = device("phone")
        val file = phone.addFile("photo.jpg", bytes)
        phone.sendAll(comparison = false)
        listed(phone)
        // The stored file changes after its hash was taken.
        phone.content.streamFile(file.record.id).writeBytes(ByteArray(bytes.size) { 1 })

        phone.moveStreams()
        phone.sendAll(comparison = false)
        assertTrue("no bytes went", server.streams.isEmpty())
        assertTrue("and no record whose file is missing", server.ids(LISTS.value).isEmpty())
        assertEquals("the app wants it fetched", StreamWork.FETCH, listed(phone).single().work)
    }

    @Test
    fun aDeletedFileIsRemovedOnTheOtherDevicesAndItsChunksAreDeleted() = runBlocking {
        val (phone, tablet, id) = fileOnTheServer()
        tablet.moveStreams()
        clock.advanceBy(10)
        phone.deleteFile(id)
        phone.wipeFile(id)
        phone.runUntilQuiet()

        assertTrue("the chunks are deleted", server.streams.isEmpty())
        assertEquals(TestServer.Mark.DELETED, server.copyOf(LISTS.value, id)?.mark)
        tablet.runUntilQuiet()
        assertFalse(id in tablet.storedStreams())
    }

    @Test
    fun aFileTheAppBringsBackRightAfterTheImportKeepsItsStream() = runBlocking {
        val (phone, tablet, id) = fileOnTheServer()
        tablet.moveStreams()
        clock.advanceBy(10)
        phone.deleteFile(id)
        phone.wipeFile(id)
        phone.runUntilQuiet()

        // Right after the import took the deletion, and before sync removes the stream, the app's own write brings
        // the record back, as a restore of a backup could.
        tablet.content.afterTake = { fileId ->
            tablet.content.afterTake = null
            clock.advanceBy(10)
            tablet.attachments.restore(fileId)
        }
        tablet.fetchAll()

        assertEquals(null, tablet.database.attachments().find(id)?.record?.deletedAt)
        assertTrue("the stream stays", id in tablet.storedStreams())
    }

    /** The tablet deletes the file; the phone brings it back, with a later edit. */
    private suspend fun bringBack(beforeTheDeletion: Boolean, whileItRuns: Boolean) {
        val (phone, tablet, id) = fileOnTheServer()
        tablet.moveStreams()
        phone.runUntilQuiet()
        clock.advanceBy(10)
        tablet.deleteFile(id)
        tablet.wipeFile(id)
        tablet.sendAll(comparison = false)
        if (!beforeTheDeletion) {
            if (whileItRuns) server.mark(LISTS.value, id, TestServer.Mark.BEING_DELETED) else tablet.moveStreams()
        }

        // The phone undoes its own deletion later: its version is newer and not deleted.
        clock.advanceBy(10)
        phone.deleteFile(id)
        phone.attachments.restore(id)
        phone.run()
        if (whileItRuns) {
            assertTrue("not stored while the chunks are being deleted", phone.status().hasOrdinaryChanges)
            server.streams.keys.removeAll { it.first == id }
            server.mark(LISTS.value, id, TestServer.Mark.DELETED)
        }
        repeat(2) {
            phone.runUntilQuiet()
            tablet.runUntilQuiet()
        }

        assertEquals(phone.records(), tablet.records())
        assertEquals(null, tablet.database.attachments().find(id)?.record?.deletedAt)
        assertEquals("the stream is on the server again", TestDevice.sha256(bytes), server.streams.entries.single().value.let(TestDevice::sha256))
        assertEquals(TestDevice.sha256(bytes), tablet.storedStreams()[id])
    }

    @Test
    fun aFileThatCameBackBeforeTheChunksWereDeletedKeepsThem() = runBlocking {
        bringBack(beforeTheDeletion = true, whileItRuns = false)
    }

    @Test
    fun aFileThatCameBackWhileTheChunksWereBeingDeletedWaitsAndSendsThemAgain() = runBlocking {
        bringBack(beforeTheDeletion = false, whileItRuns = true)
    }

    @Test
    fun aFileThatCameBackAfterTheChunksWereDeletedSendsThemAgain() = runBlocking {
        bringBack(beforeTheDeletion = false, whileItRuns = false)
    }
}
