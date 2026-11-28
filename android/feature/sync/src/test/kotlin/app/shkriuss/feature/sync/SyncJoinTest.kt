package app.shkriuss.feature.sync

import app.shkriuss.core.crypto.DeviceJoinRequest
import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.crypto.NameKeyState
import app.shkriuss.core.testing.TestClock
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The join steps (docs/apps/sync/spec.md, "The join steps"), with each
 * step's writes in their order ("Stopped between two writes"), a real
 * device key and a join that a data app signed with its own words.
 */
class SyncJoinTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val clock = TestClock()
    private val keys by lazy { TestKeys(temporary.newFolder()) }
    private val server by lazy { FakeServer(clock) }
    private val store = SyncStateStore(MemoryPreferences())
    private val scheduler = FakeScheduler()
    private val join by lazy { SyncJoin(store, SyncServer(server, keys.sync.crypto.sync, clock), keys.sync.crypto.sync, scheduler, clock, "Pixel 9 Pro") }

    private fun requestFor(): DeviceJoinRequest = (join.joinRequest() as KeyStep.Request).request

    @Test
    fun theAddressStepStartsTheJoinWithWhatInfoGives() {
        assertEquals(AddressStep.Ready(hasAccount = true), join.enterAddress("sync.example.workers.dev"))
        val state = store.now()
        assertEquals(Stage.JOINING, state.stage)
        assertEquals(server.address, state.address)
        assertEquals(server.serverId, state.serverId)
        assertEquals(clock.nowMillis, state.joinedAt)
        assertEquals(Limits(100, 524_288, 256), state.limits)
        server.serverState = ServerState.NO_ACCOUNT
        assertEquals(AddressStep.Ready(hasAccount = false), join.enterAddress("sync.example.workers.dev"))
    }

    @Test
    fun theAddressStepSaysWhatIsWrongBeforeAnyKeyIsMade() {
        assertEquals(AddressStep.NotAnAddress, join.enterAddress("http://sync.example.workers.dev"))
        server.clockOffset = 7 * 60 * 1000L
        assertEquals(AddressStep.ClockOff(7 * 60 * 1000L), join.enterAddress("sync.example.workers.dev"))
        server.clockOffset = 0
        server.serverState = ServerState.CLOSED
        assertEquals(AddressStep.Closed, join.enterAddress("sync.example.workers.dev"))
        server.serverState = ServerState.IN_USE
        server.lowest = 2
        server.highest = 2
        assertEquals(AddressStep.UpdateSync, join.enterAddress("sync.example.workers.dev"))
        server.lowest = 0
        server.highest = 0
        assertEquals(AddressStep.UpdateServer, join.enterAddress("sync.example.workers.dev"))
        server.unreachable = true
        assertEquals(AddressStep.Unreachable, join.enterAddress("sync.example.workers.dev"))
        server.unreachable = false
        server.answerNext("/v1/info", HttpResult.Untrusted)
        assertEquals(AddressStep.Untrusted, join.enterAddress("sync.example.workers.dev"))
        server.answerNext("/v1/info", HttpResult.Answer(200, byteArrayOf(0, 1)))
        assertEquals(AddressStep.NotASyncServer, join.enterAddress("sync.example.workers.dev"))
        server.answerNext("/v1/info", HttpResult.Answer(301, ByteArray(0)))
        assertEquals("a redirect", AddressStep.NotASyncServer, join.enterAddress("sync.example.workers.dev"))
        assertEquals(Stage.NOT_JOINED, store.now().stage)
        assertNull(store.now().deviceAlias)
    }

    @Test
    fun theSetupCodeIsStoredBeforeItShowsAndShowsAgain() {
        join.enterAddress("sync.example.workers.dev")
        val code = (join.setupCode() as SetupCodeStep.Code).code
        assertTrue(SyncState.isSetupCode(code))
        assertEquals(code, store.now().setupCode)
        assertEquals(listOf(server.address), store.now().deleteSetupCode)
        assertEquals("the same code shows again", SetupCodeStep.Code(code), join.setupCode())
    }

    @Test
    fun withEightSetupCodesWaitingNoNewCodeIsMade() {
        val waiting = (1..8).map { "https://s$it.example.org" }
        store.update { it.copy(deleteSetupCode = waiting) }
        join.enterAddress("sync.example.workers.dev")
        assertEquals(SetupCodeStep.TooManyWaiting, join.setupCode())
        assertTrue(join.setupCodeDeleted("https://s1.example.org"))
        assertTrue(join.setupCode() is SetupCodeStep.Code)
    }

    @Test
    fun theDeviceKeyIsMadeAfterItsNumberAndItsIdIsStored() {
        join.enterAddress("sync.example.workers.dev")
        val request = requestFor()
        val state = store.now()
        val key = keys.sync.crypto.sync.deviceKey(state.deviceAlias!!)!!
        assertEquals(key.deviceId.toHex(), state.deviceId!!.hex)
        assertEquals(server.address, request.address)
        assertArrayEquals("the same join keeps its key", request.devicePublicKey, requestFor().devicePublicKey)
    }

    @Test
    fun aSignedJoinIsSentAndJoinsTheServer() {
        join.enterAddress("sync.example.workers.dev")
        join.chooseCode(CodeKind.DEVICE_CODE)
        val request = requestFor()
        val step = join.takeSignedJoin(keys.sign(request, clock.nowMillis), request, "ABCD2345")
        assertEquals(EnrolStep.Joined(showedSetupCode = false), step)
        val state = store.now()
        assertEquals(Stage.JOINED, state.stage)
        assertEquals(server.epoch, state.epoch)
        assertEquals(keys.recoveryKey.keyId, state.keyId)
        assertEquals("Pixel 9 Pro", state.name)
        assertNull(state.joinedAt)
        assertNull(state.codeKind)
        assertEquals(NameKeyState.STORED, keys.sync.crypto.sync.nameKeyState())
        assertEquals(1, scheduler.periodic)
        val body = server.requests.last { it.url.endsWith("/v1/enrol") }.body!!
        assertEquals("a device code", 1, body[0].toInt())
    }

    @Test
    fun aJoinWithASetupCodeShowsTheStepToDeleteIt() {
        join.enterAddress("sync.example.workers.dev")
        val code = (join.setupCode() as SetupCodeStep.Code).code
        val request = requestFor()
        assertEquals(EnrolStep.Joined(showedSetupCode = true), join.takeSignedJoin(keys.sign(request, clock.nowMillis), request, code))
        assertNull("the setup code goes with the join", store.now().setupCode)
        assertEquals("the line to delete it stays", listOf(server.address), store.now().deleteSetupCode)
    }

    @Test
    fun aJoinThatWasSignedForAnotherRequestIsNotSent() {
        join.enterAddress("sync.example.workers.dev")
        join.chooseCode(CodeKind.DEVICE_CODE)
        val request = requestFor()
        val other = DeviceJoinRequest.of(request.serverId, "https://other.example.org", request.devicePublicKey)!!
        assertEquals(EnrolStep.NotForThisJoin, join.takeSignedJoin(keys.sign(other, clock.nowMillis), request, "ABCD2345"))
        assertFalse(server.requests.any { it.url.endsWith("/v1/enrol") })
    }

    @Test
    fun eachAnswerOfEnrolGoesToItsStep() {
        join.enterAddress("sync.example.workers.dev")
        join.chooseCode(CodeKind.DEVICE_CODE)
        var request = requestFor()
        val signed = keys.sign(request, clock.nowMillis)

        server.refuseNext("/v1/enrol", 0x09)
        assertEquals(EnrolStep.WrongCode, join.takeSignedJoin(signed, request, "ABCD2345"))
        assertEquals("back before stage 2", Stage.JOINING, store.now().stage)

        server.refuseNext("/v1/enrol", 0x0a, 1, 2, 3, 4)
        assertEquals(EnrolStep.OtherAccount(KeyId(0x01020304)), join.takeSignedJoin(signed, request, "ABCD2345"))

        server.refuseNext("/v1/enrol", 0x04)
        server.refuseNext("/v1/enrol", 0x04)
        assertEquals(EnrolStep.Refused, join.takeSignedJoin(signed, request, "ABCD2345"))

        server.unreachable = true
        assertEquals(EnrolStep.Unreachable, join.enrolAgain(signed, "ABCD2345"))
        server.unreachable = false
        clock.advanceBy(SyncJoin.STATEMENT_LIFE_MILLIS + 1)
        assertEquals("Try again after 10 minutes goes back to step 6", EnrolStep.TooOld, join.enrolAgain(signed, "ABCD2345"))

        val alias = store.now().deviceAlias!!
        server.refuseNext("/v1/enrol", 0x03)
        assertEquals(EnrolStep.KeyRemoved, join.takeSignedJoin(signed, request, "ABCD2345"))
        assertNull(keys.sync.crypto.sync.deviceKey(alias))
        assertNull(store.now().deviceAlias)

        request = requestFor()
        server.refuseNext("/v1/enrol", 0x06)
        assertEquals(EnrolStep.Closed, join.takeSignedJoin(keys.sign(request, clock.nowMillis), request, "ABCD2345"))
        assertEquals(Stage.NOT_JOINED, store.now().stage)
        assertEquals("the join's keys go", NameKeyState.MISSING, keys.sync.crypto.sync.nameKeyState())
    }

    @Test
    fun aJoinWhoseEnrolWasSentAsksHeadsAtTheNextStart() {
        join.enterAddress("sync.example.workers.dev")
        join.chooseCode(CodeKind.DEVICE_CODE)
        val request = requestFor()
        server.unreachable = true
        assertEquals(EnrolStep.Unreachable, join.takeSignedJoin(keys.sign(request, clock.nowMillis), request, "ABCD2345"))
        assertEquals(Stage.ENROL_SENT, store.now().stage)

        server.unreachable = false
        server.revision = 4
        assertEquals(EnrolStep.Joined(showedSetupCode = false), join.checkSentEnrol())
        assertEquals(Stage.JOINED, store.now().stage)
        assertEquals(4, store.now().revision)

        store.update { it.copy(stage = Stage.ENROL_SENT) }
        server.refuseNext("/v1/heads", 0x02)
        assertEquals("the server did not take it", EnrolStep.NotTaken, join.checkSentEnrol())
        assertEquals(Stage.JOINING, store.now().stage)
    }

    @Test
    fun cancellingDropsTheJoinAndItsKeysButNotTheLinesToDeleteSetupCodes() {
        join.enterAddress("sync.example.workers.dev")
        join.setupCode()
        val request = requestFor()
        val alias = store.now().deviceAlias!!
        keys.sync.crypto.sync.storeNameKey(keys.sign(request, clock.nowMillis))
        assertTrue(join.cancel())
        assertEquals(SyncState(deleteSetupCode = listOf(server.address)), store.now())
        assertNull(keys.sync.crypto.sync.deviceKey(alias))
        assertEquals(NameKeyState.MISSING, keys.sync.crypto.sync.nameKeyState())
        assertEquals(1, scheduler.cancels)
    }

    @Test
    fun anotherServerDropsTheOldKeyAndSetupCode() {
        join.enterAddress("sync.example.workers.dev")
        join.setupCode()
        requestFor()
        val alias = store.now().deviceAlias!!
        val other = FakeServer(clock, "https://other.example.org")
        val otherJoin = SyncJoin(store, SyncServer(other, keys.sync.crypto.sync, clock), keys.sync.crypto.sync, scheduler, clock, "Pixel 9 Pro")
        otherJoin.enterAddress("other.example.org")
        assertNull(store.now().setupCode)
        assertNull(store.now().deviceAlias)
        assertNull(keys.sync.crypto.sync.deviceKey(alias))
        assertEquals("the line to delete the first code stays", listOf(server.address), store.now().deleteSetupCode)
    }

    @Test
    fun aJoinedPhoneDoesNotStartAJoinOverItsServer() {
        store.update { joinedState(keys, server, clock) }
        assertEquals(AddressStep.NotSaved, join.enterAddress("other.example.org"))
        assertEquals(Stage.JOINED, store.now().stage)
        assertEquals("no request", emptyList<String>(), server.paths())
    }

    @Test
    fun theFirstNameIsTheModelCutTo40OrAndroidDevice() {
        fun nameOf(model: String) = SyncJoin(store, SyncServer(server, keys.sync.crypto.sync, clock), keys.sync.crypto.sync, scheduler, clock, model).firstName()
        assertEquals("Pixel 9 Pro", nameOf(" Pixel 9 Pro "))
        assertEquals("a".repeat(40), nameOf("a".repeat(50)))
        assertEquals(SyncJoin.DEFAULT_NAME, nameOf(""))
        assertEquals(SyncJoin.DEFAULT_NAME, nameOf("one\nline"))
        assertNotNull(nameOf("Ŝ".repeat(45)))
    }

    @Test
    fun aKeystoreThatFailsForAMomentKeepsTheJoinsKey() {
        join.enterAddress("sync.example.workers.dev")
        join.chooseCode(CodeKind.DEVICE_CODE)
        val request = requestFor()
        server.unreachable = true
        join.takeSignedJoin(keys.sign(request, clock.nowMillis), request, "ABCD2345")
        server.unreachable = false
        val alias = store.now().deviceAlias!!
        keys.sync.keystoreFails = true
        assertEquals(EnrolStep.NotSaved, join.checkSentEnrol())
        keys.sync.keystoreFails = false
        assertEquals(alias, store.now().deviceAlias)
        assertEquals(Stage.ENROL_SENT, store.now().stage)
        assertNotNull(keys.sync.crypto.sync.deviceKey(alias))
    }
}
