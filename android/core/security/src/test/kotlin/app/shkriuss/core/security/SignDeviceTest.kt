package app.shkriuss.core.security

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.activity.result.ActivityResult
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.DeviceJoinRequest
import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.RecoveryWords
import app.shkriuss.core.crypto.RecoveryWordsResult
import app.shkriuss.core.crypto.SignedJoin
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import java.io.File
import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The mode "Sign a device" of the handover (crypto-design.md, "The
 * handover format, version 2"): only the Sync app may ask in it, and only
 * in it; a keeper signs after the system prompt; an app that does not
 * keep the key signs with all 24 words of its own key; and the Sync app
 * reads the answer.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
class SignDeviceTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val certificate = byteArrayOf(1, 2, 3, 4)
    private val sync = AppName.of("sync")
    private val serverId = ByteArray(16) { it.toByte() }
    private val devicePublicKey by lazy {
        SoftwareKeysApp(File(temporary.newFolder(), "shk-keys"), sync).crypto.sync.makeDeviceKey(1).publicKey
    }
    private val join by lazy { DeviceJoinRequest.of(serverId, "https://sync.example.workers.dev", devicePublicKey)!! }
    private val suite = FakeSuiteApps(peers = mapOf("app.shkriuss.reminders" to AppName.of("reminders")), syncApp = "app.shkriuss.sync")

    private fun signed(app: String, vararg signers: ByteArray, multiple: Boolean = false) = SignedApp(app, signers.toList(), multiple)

    private fun extras(version: Int, mode: String?, request: DeviceJoinRequest? = join) = Bundle().apply {
        putInt(Handover.EXTRA_VERSION, version)
        mode?.let { putString(Handover.EXTRA_MODE, it) }
        request?.writeTo(this)
    }

    /** Water with its keys from a new recovery key, keeping it when [keeps]. */
    private fun water(keeps: Boolean): Pair<SoftwareKeysApp, RecoveryKey> {
        val app = SoftwareKeysApp(File(temporary.newFolder(), "shk-keys"), testAppName)
        val key = app.crypto.setup.createRecoveryKey()
        app.crypto.setup.storeDerivedKeys(key)
        if (keeps) app.crypto.setup.beginKeepRecoveryKey(key)!!.finish()
        return app to key
    }

    private fun signing(app: SoftwareKeysApp, request: DeviceJoinRequest = join) =
        HandoverViewModel(app.crypto, sync, HandoverMode.SIGN_DEVICE, inline, Random(7), inline, join = request)

    private fun enterWords(model: HandoverViewModel, words: List<String>) {
        model.onAllow()
        assertTrue(model.state.value is HandoverAllWords)
        words.forEach { model.onWord(it) }
        model.onCheckAll()
    }

    @Test
    fun onlyTheSyncAppOfTheSameBuildKindAndCertificatePassesAsSync() {
        val water = signed("app.shkriuss.water", certificate)
        assertTrue(SuitePeers.isSyncApp(water, signed("app.shkriuss.sync", certificate.copyOf())))
        assertTrue(SuitePeers.isSyncApp(signed("app.shkriuss.water.preview", certificate), signed("app.shkriuss.sync.preview", certificate)))
        listOf(
            "another certificate" to signed("app.shkriuss.sync", byteArrayOf(9)),
            "two signers" to signed("app.shkriuss.sync", certificate, byteArrayOf(9)),
            "multiple signers" to signed("app.shkriuss.sync", certificate, multiple = true),
            "a preview" to signed("app.shkriuss.sync.preview", certificate),
            "a longer ID" to signed("app.shkriuss.sync.debug", certificate),
            "a data app" to signed("app.shkriuss.reminders", certificate),
            "Catalog" to signed("app.shkriuss.catalog", certificate),
        ).forEach { (what, other) -> assertFalse(what, SuitePeers.isSyncApp(water, other)) }
        assertFalse("a real Sync for a preview", SuitePeers.isSyncApp(signed("app.shkriuss.water.preview", certificate), signed("app.shkriuss.sync", certificate)))
        assertFalse("not the app itself", SuitePeers.isSyncApp(signed("app.shkriuss.sync", certificate), signed("app.shkriuss.sync", certificate)))
        assertNull("Sync never gets keys", SuitePeers.peerName(water, signed("app.shkriuss.sync", certificate)))
    }

    @Test
    fun theSyncAppMayAskOnlyToSignAndNoOtherAppMay() {
        val valid = HandoverRequest.of("app.shkriuss.sync", extras(2, "SIGN_DEVICE"), suite) as HandoverRequest.Valid
        assertEquals(sync, valid.asker)
        assertEquals(HandoverMode.SIGN_DEVICE, valid.mode)
        assertEquals(join.address, valid.join!!.address)

        listOf(
            "Sync asking for keys" to HandoverRequest.of("app.shkriuss.sync", extras(1, "KEYS", null), suite),
            "Sync asking for keys in version 2" to HandoverRequest.of("app.shkriuss.sync", extras(2, "KEYS", null), suite),
            "Sync asking to check words" to HandoverRequest.of("app.shkriuss.sync", extras(1, "CHECK_WORDS", null), suite),
            "the mode in version 1" to HandoverRequest.of("app.shkriuss.sync", extras(1, "SIGN_DEVICE"), suite),
            "nothing to sign" to HandoverRequest.of("app.shkriuss.sync", extras(2, "SIGN_DEVICE", null), suite),
            "a data app asking to sign" to HandoverRequest.of("app.shkriuss.reminders", extras(2, "SIGN_DEVICE"), suite),
            "another app" to HandoverRequest.of("com.example.sync", extras(2, "SIGN_DEVICE"), suite),
            "an unknown mode" to HandoverRequest.of("app.shkriuss.sync", extras(2, "NEW_ACCOUNT_KEY"), suite),
            "no version" to HandoverRequest.of("app.shkriuss.sync", extras(0, "SIGN_DEVICE"), suite),
        ).forEach { (what, request) -> assertEquals(what, HandoverRequest.Refused, request) }

        val badAddress = extras(2, "SIGN_DEVICE").apply { putString("app.shkriuss.handover.SERVER_ADDRESS", "http://sync.example.com") }
        assertEquals(HandoverRequest.Refused, HandoverRequest.of("app.shkriuss.sync", badAddress, suite))
        assertEquals(HandoverRequest.Newer, HandoverRequest.of("app.shkriuss.sync", extras(3, "SIGN_DEVICE"), suite))
    }

    @Test
    fun aReaderOfVersion2StillReadsVersion1() {
        val keys = HandoverRequest.of("app.shkriuss.reminders", extras(1, "KEYS", null), suite) as HandoverRequest.Valid
        assertEquals(HandoverMode.KEYS, keys.mode)
        assertNull(keys.join)
        val inVersion2 = HandoverRequest.of("app.shkriuss.reminders", extras(2, "CHECK_WORDS", null), suite) as HandoverRequest.Valid
        assertEquals(HandoverMode.CHECK_WORDS, inVersion2.mode)
    }

    @Test
    fun aRequestIsWrittenInTheFirstVersionThatHasItsMode() {
        val keys = handoverRequest("app.shkriuss.water", "Screen", HandoverMode.KEYS, null)
        assertEquals(1, keys.getIntExtra(Handover.EXTRA_VERSION, 0))
        val sign = handoverRequest("app.shkriuss.water", "Screen", HandoverMode.SIGN_DEVICE, join)
        assertEquals(2, sign.getIntExtra(Handover.EXTRA_VERSION, 0))
        assertEquals("SIGN_DEVICE", sign.getStringExtra(Handover.EXTRA_MODE))
        assertEquals(join.address, DeviceJoinRequest.readFrom(sign.extras!!)!!.address)
        assertThrows(IllegalArgumentException::class.java) { handoverRequest("app.shkriuss.water", "Screen", HandoverMode.KEYS, join) }
        assertThrows(IllegalArgumentException::class.java) { handoverRequest("app.shkriuss.water", "Screen", HandoverMode.SIGN_DEVICE, null) }
    }

    @Test
    fun aKeeperSignsAfterThePromptAndTheSyncAppReadsIt() {
        val (water, key) = water(keeps = true)
        val model = signing(water)
        assertEquals(HandoverAsk(HandoverMode.SIGN_DEVICE, key.keyId.toString(), server = "sync.example.workers.dev"), model.state.value)
        model.onAllow()
        val prompt = (model.state.value as HandoverAsk).prompt!!
        model.onPromptResult(prompt, PromptOutcome.SUCCEEDED)
        assertEquals(HandoverReady, model.state.value)
        val signed = model.takeSigned()!!
        assertNull("taken once", model.takeGift())
        assertEquals(key.keyId, signed.keyId)
        assertTrue(signed.isFor(join))

        val valid = HandoverRequest.Valid(sync, "app.shkriuss.sync", HandoverMode.SIGN_DEVICE, join)
        val (code, data) = handoverResult("app.shkriuss.sync", valid, suite, HandoverGift.Signed(signed))
        assertEquals(Activity.RESULT_OK, code)
        val asking = FakeSuiteApps(peers = mapOf("app.shkriuss.water" to testAppName))
        val answer = KeeperAnswer.of("app.shkriuss.water", ActivityResult(code, data), asking, HandoverMode.SIGN_DEVICE)
        assertTrue((answer as KeeperAnswer.Signed).signed.isFor(join))
        assertTrue(SignDeviceAnswer.of(answer) is SignDeviceAnswer.Signed)
    }

    @Test
    fun theSignedJoinGoesOnlyToTheSyncAppThatAsked() {
        val (water, _) = water(keeps = true)
        val signed = water.crypto.setup.beginSignDevice(join).finish()
        val valid = HandoverRequest.Valid(sync, "app.shkriuss.sync", HandoverMode.SIGN_DEVICE, join)
        fun refused(caller: String?, against: SuiteApps = suite, gift: HandoverGift = HandoverGift.Signed(signed)) {
            val (code, data) = handoverResult(caller, valid, against, gift)
            assertEquals(Activity.RESULT_CANCELED, code)
            assertEquals(HandoverRefusal.REFUSED.name, data!!.getStringExtra(Handover.EXTRA_REFUSAL))
            assertNull(data.getByteArrayExtra("app.shkriuss.handover.STATEMENT"))
        }
        refused(null)
        refused("app.shkriuss.reminders")
        refused("app.shkriuss.sync", FakeSuiteApps(syncApp = null))
        refused("app.shkriuss.sync", gift = HandoverGift.Keys(water.crypto.setup.beginHandOver(AppName.of("reminders")).finish()))
    }

    @Test
    fun anAppThatDoesNotKeepTheKeySignsWithTheWordsOfItsOwnKeyOnly() {
        val (water, key) = water(keeps = false)
        val model = signing(water)
        assertEquals(
            HandoverAsk(HandoverMode.SIGN_DEVICE, key.keyId.toString(), server = "sync.example.workers.dev", withWords = true),
            model.state.value,
        )

        enterWords(model, water.crypto.setup.createRecoveryKey().words())
        val wrong = model.state.value as HandoverAllWords
        assertTrue("the words of another key", wrong.notThisApp)
        assertNull(model.takeGift())

        model.onEditWord(0)
        assertFalse("a change clears the note", (model.state.value as HandoverAllWords).notThisApp)
        val words = key.words()
        words.indices.forEach { index ->
            model.onEditWord(index)
            model.onWord(words[index])
        }
        model.onCheckAll()
        assertEquals(HandoverReady, model.state.value)
        val signed = model.takeSigned()!!
        assertEquals(key.keyId, signed.keyId)
        assertTrue(signed.isFor(join))
        assertFalse("the key is not kept", water.crypto.status().keepsRecoveryKey)
    }

    @Test
    fun wordsThatDoNotBelongTogetherAreNamedAsOnTheEnterScreen() {
        val (water, key) = water(keeps = false)
        val model = signing(water)
        val words = key.words().dropLast(1)
        // Any last word gives a valid checksum one time in 256, so the test picks one that does not.
        val last = RecoveryWords.list.first { RecoveryWords.parse((words + it).joinToString(" ")) == RecoveryWordsResult.DoNotBelongTogether }
        enterWords(model, words + last)
        assertTrue((model.state.value as HandoverAllWords).entry.doNotBelong)
    }

    @Test
    fun anAppWithNoKeysOfTheNamedRecoveryKeySaysSoAndClosesWithOtherKey() {
        val (water, _) = water(keeps = true)
        val model = signing(water, DeviceJoinRequest.of(serverId, join.address, devicePublicKey, KeyId(0x01020304))!!)
        assertEquals(HandoverOtherKey("01020304"), model.state.value)
        assertEquals(HandoverRefusal.OTHER_KEY, closingRefusal(model.state.value))
        val answer = KeeperAnswer.of(
            "app.shkriuss.water",
            ActivityResult(Activity.RESULT_CANCELED, refusalResult(HandoverRefusal.OTHER_KEY)),
            FakeSuiteApps(peers = mapOf("app.shkriuss.water" to testAppName)),
            HandoverMode.SIGN_DEVICE,
        )
        assertEquals(KeeperAnswer.OtherKey, answer)
        assertEquals(SignDeviceAnswer.OtherKey, SignDeviceAnswer.of(answer))
    }

    @Test
    fun anAppWithNoKeysSignsNothing() {
        val app = SoftwareKeysApp(File(temporary.newFolder(), "shk-keys"), testAppName)
        val model = signing(app)
        assertEquals(HandoverNoKeys, model.state.value)
        assertEquals(HandoverRefusal.NOT_KEEPER, closingRefusal(model.state.value))
    }

    @Test
    fun aKeeperWhoseKeptKeyWentBeforeAllowSaysSoAndClosesWithNotKeeper() {
        val (water, _) = water(keeps = true)
        val model = signing(water)
        // The screen lock is removed while the screen shows: the Recovery guard goes with it.
        water.screenLock = false
        model.onAllow()
        assertEquals(HandoverNotKept, model.state.value)
        assertEquals("Sync then offers the words", HandoverRefusal.NOT_KEEPER, closingRefusal(model.state.value))
    }

    @Test
    fun keysThatCannotBeReadNowAskToTryAgainAndGiveNoReason() {
        val (water, _) = water(keeps = false)
        water.keystoreFails = true
        val model = signing(water)
        assertEquals(HandoverFailed(damaged = false), model.state.value)
        assertNull(closingRefusal(model.state.value))
    }

    @Test
    fun aKeystoreThatFailsForAMomentAtAllowAsksToTryAgainAndGivesNoReason() {
        val (water, _) = water(keeps = true)
        val model = signing(water)
        assertTrue(model.state.value is HandoverAsk)
        water.keystoreFails = true
        model.onAllow()
        assertEquals(HandoverFailed(damaged = false), model.state.value)
        assertNull("Sync does not offer the words", closingRefusal(model.state.value))
    }

    @Test
    fun keysThatCannotBeReadAfterTheWordsAskToTryAgainAndSignNothing() {
        val (water, key) = water(keeps = false)
        val model = signing(water)
        model.onAllow()
        key.words().forEach { model.onWord(it) }
        water.keystoreFails = true
        model.onCheckAll()
        assertEquals(HandoverFailed(damaged = false), model.state.value)
        assertNull(model.takeGift())
        assertNull(closingRefusal(model.state.value))
    }

    @Test
    fun aStopDropsASignedJoinThatWasNotHandedOver() {
        val (water, key) = water(keeps = true)
        val model = signing(water)
        model.onAllow()
        model.onPromptResult((model.state.value as HandoverAsk).prompt!!, PromptOutcome.SUCCEEDED)
        assertEquals(HandoverReady, model.state.value)
        model.onStop(changingConfigurations = true)
        assertEquals("a turn of the phone keeps it", HandoverReady, model.state.value)
        model.onStop(changingConfigurations = false)
        assertNull(model.takeGift())
        assertEquals(HandoverAsk(HandoverMode.SIGN_DEVICE, key.keyId.toString(), server = "sync.example.workers.dev"), model.state.value)
    }

    @Test
    fun aStopWhileThePromptIsMadeMakesItsSignatureCountForNothing() {
        val (water, _) = water(keeps = true)
        val background = QueuedDispatcher()
        val model = HandoverViewModel(water.crypto, sync, HandoverMode.SIGN_DEVICE, background, Random(7), inline, join = join)
        background.runAll()
        model.onAllow()
        model.onStop(changingConfigurations = false)
        background.runAll()
        model.onPromptResult((model.state.value as HandoverAsk).prompt!!, PromptOutcome.SUCCEEDED)
        background.runAll()
        assertNull(model.takeGift())
        assertTrue((model.state.value as HandoverAsk).prompt == null)
    }

    @Test
    fun wordsBeingTypedStayWhenTheScreenStops() {
        val (water, key) = water(keeps = false)
        val model = signing(water)
        model.onAllow()
        model.onWord(key.words()[0])
        model.onStop(changingConfigurations = false)
        assertEquals(key.words()[0], (model.state.value as HandoverAllWords).entry.words[0])
    }

    @Test
    fun theAnswerOtherKeyCountsOnlyForSigning() {
        val asking = FakeSuiteApps(peers = mapOf("app.shkriuss.water" to testAppName))
        fun answer(mode: HandoverMode, code: Int, data: Intent?) = KeeperAnswer.of("app.shkriuss.water", ActivityResult(code, data), asking, mode)
        assertEquals(KeeperAnswer.Declined, answer(HandoverMode.KEYS, Activity.RESULT_CANCELED, refusalResult(HandoverRefusal.OTHER_KEY)))
        assertEquals(KeeperAnswer.Unreadable, answer(HandoverMode.SIGN_DEVICE, Activity.RESULT_OK, Intent().putExtra("x", 1)))
        assertEquals(KeeperAnswer.Update, answer(HandoverMode.SIGN_DEVICE, Activity.RESULT_OK, Intent().putExtra("app.shkriuss.handover.VERSION", 3)))
        assertEquals(SignDeviceAnswer.Refused, SignDeviceAnswer.of(KeeperAnswer.NotASuiteApp))
        assertEquals(SignDeviceAnswer.NotKeeper, SignDeviceAnswer.of(KeeperAnswer.NotKeeper))
        assertEquals(SignDeviceAnswer.Declined, SignDeviceAnswer.of(KeeperAnswer.Declined))
        assertEquals(SignDeviceAnswer.Update, SignDeviceAnswer.of(KeeperAnswer.Update))
        assertEquals(SignDeviceAnswer.Unreadable, SignDeviceAnswer.of(KeeperAnswer.Unreadable))
    }

    @Test
    fun theStatusSaysTheKeyIdOfAnAppThatDoesNotKeepTheKeyToo() {
        val id = KeyId(0x0a0b0c0d)
        assertEquals(false to "0a0b0c0d", KeeperStatus.of(KeeperStatus.bundleOf(keeps = false, keyId = id)))
        assertNull("not a keeper", KeeperStatus.keyIdOf(KeeperStatus.bundleOf(keeps = false, keyId = id)))
        assertEquals(true to "0a0b0c0d", KeeperStatus.of(KeeperStatus.bundleOf(keeps = true, keyId = id)))
        assertNull("no keys", KeeperStatus.of(KeeperStatus.bundleOf(keeps = true, keyId = null)))
        assertNull(KeeperStatus.of(KeeperStatus.bundleOf(keeps = true, keyId = id).apply { putString("app.shkriuss.keeper.KEEPS", "yes") }))
        // The answer of an older version: a key ID only for a keeper.
        val older = Bundle().apply {
            putInt("app.shkriuss.keeper.VERSION", 1)
            putBoolean("app.shkriuss.keeper.KEEPS", false)
        }
        assertNull(KeeperStatus.of(older))
    }

    @Test
    fun theStatusProviderAnswersTheSyncApp() {
        val host = RuntimeEnvironment.getApplication() as TestHostApp
        val key = host.keys.crypto.setup.createRecoveryKey()
        host.keys.crypto.setup.storeDerivedKeys(key)
        val answer = KeeperStatusProvider.statusFor("app.shkriuss.sync", suite, host)!!
        assertEquals(false to key.keyId.toString(), KeeperStatus.of(answer))
        assertNull(KeeperStatusProvider.statusFor("app.shkriuss.sync", FakeSuiteApps(), host))
    }

    @Test
    fun aSignedJoinIsNeverShown() {
        val (water, _) = water(keeps = true)
        val signed: SignedJoin = water.crypto.setup.beginSignDevice(join).finish()
        assertEquals("Signed", SignDeviceAnswer.Signed(signed).toString())
        assertNotNull(signed)
    }
}
