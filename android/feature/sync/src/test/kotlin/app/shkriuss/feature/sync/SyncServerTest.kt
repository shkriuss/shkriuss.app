package app.shkriuss.feature.sync

import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.crypto.RequestMethod
import app.shkriuss.core.testing.TestClock
import java.io.ByteArrayInputStream
import java.net.SocketTimeoutException
import java.security.cert.CertificateException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The server interface as Sync speaks it (docs/architecture/
 * sync-protocol.md, "The server interface"): the bodies it sends, every
 * answer byte with its own layout, and the answers that do not come from
 * the Worker.
 */
class SyncServerTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val clock = TestClock()
    private val keys by lazy { TestKeys(temporary.newFolder()) }
    private val sent = mutableListOf<HttpRequest>()
    private val answers = ArrayDeque<HttpResult>()
    private val server by lazy { SyncServer({ request -> sent += request; answers.removeFirst() }, keys.sync.crypto.sync, clock) }
    private val session by lazy {
        val sync = keys.sync.crypto.sync
        Session("https://sync.example.workers.dev", syncId(1), sync.makeDeviceKey(sync.newDeviceKeyNumber()))
    }

    private fun answer(vararg bytes: Int) = answers.addLast(HttpResult.Answer(200, ByteArray(bytes.size) { bytes[it].toByte() }))

    private fun answer(bytes: ByteArray) = answers.addLast(HttpResult.Answer(200, bytes))

    @Test
    fun everyRefusalIsReadWithItsOwnLayout() {
        fun read(vararg bytes: Int) = ServerLayouts.answer(ByteArray(bytes.size) { bytes[it].toByte() }) { Unit }
        assertEquals(ServerAnswer.Version(2, 3), read(0x01, 2, 3))
        assertEquals(ServerAnswer.NotADevice, read(0x02))
        assertEquals(ServerAnswer.Removed, read(0x03))
        assertEquals(ServerAnswer.DoesNotCheck, read(0x04))
        assertEquals(ServerAnswer.Clock(1_700_000_000_000), read(0x05, 0, 0, 1, 0x8b, 0xcf, 0xe5, 0x68, 0))
        assertEquals(ServerAnswer.Closed, read(0x06))
        assertEquals(ServerAnswer.DayLimit(comparisonsOnly = true), read(0x07, 1))
        assertEquals(ServerAnswer.DayLimit(comparisonsOnly = false), read(0x07, 2))
        assertEquals(ServerAnswer.Full, read(0x08))
        assertEquals(ServerAnswer.WrongCode, read(0x09))
        assertEquals(ServerAnswer.OtherAccount(KeyId(0x01020304)), read(0x0a, 1, 2, 3, 4))
        assertEquals(ServerAnswer.OtherEpoch(syncId(7)), ServerLayouts.answer(byteArrayOf(0x0b) + id(7)) { Unit })
        assertEquals(ServerAnswer.TooMuch, read(0x0c))
    }

    @Test
    fun anAnswerThatBreaksItsLayoutIsBroken() {
        fun read(vararg bytes: Int) = ServerLayouts.answer(ByteArray(bytes.size) { bytes[it].toByte() }) { Unit }
        listOf(
            intArrayOf(),
            intArrayOf(0x0d),
            intArrayOf(0x01, 2),
            intArrayOf(0x01, 3, 2),
            intArrayOf(0x02, 0),
            intArrayOf(0x05, 1, 2, 3),
            intArrayOf(0x07, 3),
            intArrayOf(0x0a, 1, 2, 3),
            intArrayOf(0x00, 1),
        ).forEach { assertEquals(it.joinToString(), ServerAnswer.Broken, read(*it)) }
    }

    @Test
    fun aTimeOutsideItsLimitsBreaksTheAnswer() {
        fun read(vararg bytes: Int) = ServerLayouts.answer(ByteArray(bytes.size) { bytes[it].toByte() }) { Unit }
        assertEquals("a clock after 9999", ServerAnswer.Broken, read(0x05, 1, 2, 3, 4, 5, 6, 7, 8))
        assertEquals("a clock below 0", ServerAnswer.Broken, read(0x05, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff))
        answer(Bytes().u8(0).u8(1).u8(1).bytes(id(1)).i64(-1).u8(1).i32(100).i32(524_288).i32(256).done())
        assertEquals("info's clock below 0", ServerAnswer.Broken, server.info("https://sync.example.workers.dev"))
        answer(Bytes().u8(0).u8(3).u8(2).bytes(id(1)).i64(99).u8(1).i32(100).i32(524_288).i32(256).done())
        assertEquals("a lowest version above the highest", ServerAnswer.Broken, server.info("https://sync.example.workers.dev"))
        answer(Bytes().u8(0).bytes("ABCD2345".toByteArray()).i64(clock.nowMillis + 60_000).done())
        assertTrue(server.enrolCode(session) is ServerAnswer.Done)
        answer(Bytes().u8(0).bytes("ABCD2345".toByteArray()).i64(-1).done())
        assertEquals("a device code that ends before 1970", ServerAnswer.Broken, server.enrolCode(session))
    }

    @Test
    fun aCutPageEndsAtItsLastRecordAndABatchAnswerEndsAtItsLastStoredRecord() {
        val record = Bytes().bytes(id(5)).i64(6).i32(60).bytes(blob(KeyId(1), 1)).done()
        fun page(through: Long, more: Int, records: Int) =
            Bytes().u8(0).bytes(id(2)).i64(4).i64(through).u8(more).i32(records).bytes(if (records == 1) record else ByteArray(0)).done()
        assertTrue(ServerLayouts.page(page(6, 1, 1)) is ServerAnswer.Done)
        assertTrue("a whole page ends at the head", ServerLayouts.page(page(8, 0, 1)) is ServerAnswer.Done)
        assertEquals("a cut page whose Through is above its last record", ServerAnswer.Broken, ServerLayouts.page(page(8, 1, 1)))
        assertEquals("a cut page with no record", ServerAnswer.Broken, ServerLayouts.page(page(8, 1, 0)))

        fun sent(after: Long, vararg numbers: Long?): ByteArray {
            val out = Bytes().u8(0).bytes(id(2)).i64(4).i64(after).i32(numbers.size)
            numbers.forEach { number -> if (number == null) out.u8(1) else out.u8(0).i64(number) }
            return out.done()
        }
        assertTrue(ServerLayouts.sent(sent(9, 7, 9), 2) is ServerAnswer.Done)
        assertTrue("nothing stored, the head stays", ServerLayouts.sent(sent(4, null), 1) is ServerAnswer.Done)
        assertEquals("a head after above the last record stored", ServerAnswer.Broken, ServerLayouts.sent(sent(12, 7, 9), 2))
        assertEquals("a head that moved with nothing stored", ServerAnswer.Broken, ServerLayouts.sent(sent(5, null), 1))
    }

    @Test
    fun aCertificateForAnotherNameIsUntrustedAndOtherFailuresAreNoAnswer() {
        assertEquals(HttpResult.Untrusted, HttpsTransport.resultOf(SSLPeerUnverifiedException("Hostname sync.example.org not verified")))
        assertEquals(HttpResult.Untrusted, HttpsTransport.resultOf(SSLHandshakeException("not trusted").apply { initCause(CertificateException("no path")) }))
        assertEquals(HttpResult.NoAnswer, HttpsTransport.resultOf(SSLHandshakeException("reset")))
        assertEquals(HttpResult.NoAnswer, HttpsTransport.resultOf(SocketTimeoutException()))
    }

    @Test
    fun infoTakesALimitOutsideItsBoundsAsTheNearest() {
        answer(Bytes().u8(0).u8(1).u8(2).bytes(id(1)).i64(99).u8(1).i32(0).i32(1_000_000).i32(1_000).done())
        val info = (server.info("https://sync.example.workers.dev") as ServerAnswer.Done).value
        assertEquals(ServerInfo(1, 2, syncId(1), 99, ServerState.IN_USE, Limits(1, 524_288, 256)), info)
        assertTrue(info.speaksVersion1)
        assertEquals("info is not signed", emptyMap<String, String>(), sent.single().headers)
        assertEquals("https://sync.example.workers.dev/v1/info", sent.single().url)
    }

    @Test
    fun aSignedRequestCarriesTheThreeHeaders() {
        answer(Bytes().u8(0).bytes(id(2)).bytes(byteArrayOf(1, 2, 3, 4)).i64(5).u8(1).u8(5).bytes("water".toByteArray()).i64(9).i64(8).done())
        val heads = (server.heads(session) as ServerAnswer.Done).value
        assertEquals(Heads(syncId(2), KeyId(0x01020304), 5, mapOf("water" to AppHead(9, 8))), heads)
        assertEquals("an app the answer does not name has head 0", AppHead(0, 0), heads.of("notes"))
        val request = sent.single()
        assertEquals(RequestMethod.GET, request.method)
        assertNull("a GET has no body", request.body)
        assertEquals(session.key.deviceId.toHex(), request.headers["shk-device"])
        assertEquals(clock.nowMillis.toString(), request.headers["shk-time"])
        assertTrue(Regex("[0-9a-f]{128}").matches(request.headers.getValue("shk-signature")))
    }

    @Test
    fun a04IsSentOnceMoreWithANewTimeAndThenCounts() {
        answer(0x04)
        answer(Bytes().u8(0).i64(3).done())
        assertEquals(ServerAnswer.Done(3L), server.removeDevice(session, syncId(9)))
        assertEquals(2, sent.size)

        sent.clear()
        answer(0x04)
        answer(0x04)
        assertEquals(ServerAnswer.DoesNotCheck, server.removeDevice(session, syncId(9)))
        assertEquals(2, sent.size)
        assertArrayEquals(id(9), sent.first().body)
    }

    @Test
    fun answersThatDoNotComeFromTheWorkerAreToldApart() {
        answers.addLast(HttpResult.Answer(SyncServer.DAY_REQUESTS_STATUS, ByteArray(0)))
        assertEquals(ServerAnswer.DayRequestsUsed, server.heads(session))
        answers.addLast(HttpResult.Answer(SyncServer.CPU_TIME_STATUS, ByteArray(0)))
        assertEquals(ServerAnswer.OutOfCpuTime, server.heads(session))
        answers.addLast(HttpResult.Answer(302, ByteArray(0)))
        assertEquals("a redirect is not followed", ServerAnswer.NotTheWorker, server.heads(session))
        answers.addLast(HttpResult.NoAnswer)
        assertEquals(ServerAnswer.Unreachable, server.heads(session))
        answers.addLast(HttpResult.Untrusted)
        assertEquals(ServerAnswer.UntrustedCertificate, server.info("https://sync.example.workers.dev"))
    }

    @Test
    fun aFetchNamesItsQueryAndItsPageIsReadAsTheDataAppReadsIt() {
        val page = Bytes().u8(0).bytes(id(2)).i64(4).i64(6).u8(0).i32(1).bytes(id(5)).i64(6).i32(60).bytes(blob(KeyId(1), 1)).done()
        answer(page)
        val fetched = (server.fetch(session, "water", since = 4, known = 6, epoch = syncId(2), most = 50) as ServerAnswer.Done).value
        assertArrayEquals("the page goes to import as it came", page, fetched.bytes)
        assertEquals(6, fetched.page.through)
        assertEquals(
            "https://sync.example.workers.dev/v1/changes?app=water&since=4&known=6&epoch=${syncId(2).hex}&most=50",
            sent.single().url,
        )
        answer(Bytes().u8(0).bytes(id(2)).i64(4).i64(3).u8(0).i32(0).done())
        assertEquals("Through below Since", ServerAnswer.Broken, server.fetch(session, "water", 4, 6, syncId(2), 50))
    }

    @Test
    fun theDevicesAreReadAndALongerListIsAFault() {
        val one = Bytes().bytes(id(3)).bytes(ByteArray(65) { 4 }).u8(2).i64(7).i64(86_400_000).u16(52).bytes(ByteArray(52)).done()
        answer(Bytes().u8(0).u16(1).bytes(one).done())
        val device = (server.devices(session) as ServerAnswer.Done).value.single()
        assertEquals(syncId(3), device.id)
        assertTrue(device.removed)
        assertEquals(86_400_000, device.seenDay)

        val addedBeforeTime = Bytes().bytes(id(3)).bytes(ByteArray(65) { 4 }).u8(1).i64(-1).i64(86_400_000).u16(52).bytes(ByteArray(52)).done()
        answer(Bytes().u8(0).u16(1).bytes(addedBeforeTime).done())
        assertEquals("an added time below 0", ServerAnswer.Broken, server.devices(session))
        val seenMidDay = Bytes().bytes(id(3)).bytes(ByteArray(65) { 4 }).u8(1).i64(7).i64(86_400_001).u16(52).bytes(ByteArray(52)).done()
        answer(Bytes().u8(0).u16(1).bytes(seenMidDay).done())
        assertEquals("a day seen that is not the start of a UTC day", ServerAnswer.Broken, server.devices(session))

        val many = Bytes().u8(0).u16(1_001)
        repeat(1_001) { many.bytes(Bytes().bytes(Bytes().i64(it.toLong()).i64(0).done()).bytes(ByteArray(65)).u8(1).i64(0).i64(0).u16(52).bytes(ByteArray(52)).done()) }
        answer(many.done())
        assertEquals(ServerAnswer.Broken, server.devices(session))
    }

    @Test
    fun filesSendSignsOnlyItsTableAndCarriesTheChunksAfterIt() {
        val bytes = byteArrayOf(1, 2, 3)
        val chunk = OutgoingChunk(id(6), sha256(bytes), 0, bytes, sha256(bytes))
        answer(0x00, 0x01)
        assertEquals(ServerAnswer.Done(listOf(false)), server.filesSend(session, "notes", listOf(chunk)))
        val body = sent.single().body!!
        assertEquals(2 + 88 + 3, body.size)
        assertArrayEquals(bytes, body.copyOfRange(90, 93))
    }

    @Test
    fun aFetchedChunkMustHaveTheLengthAskedFor() {
        val ref = ChunkRef(id(6), ByteArray(32), 0, 3)
        answer(Bytes().u8(0).u8(0).i32(3).bytes(byteArrayOf(7, 8, 9)).done())
        assertArrayEquals(byteArrayOf(7, 8, 9), (server.filesFetch(session, "notes", listOf(ref)) as ServerAnswer.Done).value.single())
        answer(Bytes().u8(0).u8(1).done())
        assertNull("not here", (server.filesFetch(session, "notes", listOf(ref)) as ServerAnswer.Done).value.single())
        answer(Bytes().u8(0).u8(0).i32(4).bytes(byteArrayOf(7, 8, 9, 0)).done())
        assertEquals(ServerAnswer.Broken, server.filesFetch(session, "notes", listOf(ref)))
    }

    @Test
    fun anAnswerLongerThanAnyOfTheProtocolIsNoAnswer() {
        assertNull(HttpsTransport.readAtMost(ByteArrayInputStream(ByteArray(11)), 10))
        assertEquals(10, HttpsTransport.readAtMost(ByteArrayInputStream(ByteArray(10)), 10)?.size)
    }
}
