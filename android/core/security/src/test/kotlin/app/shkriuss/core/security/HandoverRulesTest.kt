package app.shkriuss.core.security

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.activity.result.ActivityResult
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.KeyId
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The checks of the handover between apps that need no screen (ADR 0041):
 * who may take part, how a keeper reads a request, how an asking app reads
 * the answer, and what the status provider says to whom.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
class HandoverRulesTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val suiteKey = byteArrayOf(1, 2, 3, 4)
    private val otherKey = byteArrayOf(9, 9, 9)
    private val water = SignedApp("app.shkriuss.water", listOf(suiteKey), multipleSigners = false)
    private val reminders = AppName.of("reminders")

    private fun app(name: String, vararg signers: ByteArray, multiple: Boolean = false) = SignedApp(name, signers.toList(), multiple)

    @Test
    fun anotherDataAppSignedWithExactlyTheSameCertificateTakesPart() {
        assertEquals(reminders, SuitePeers.peerName(water, app("app.shkriuss.reminders", suiteKey.copyOf())))
        val preview = app("app.shkriuss.water.preview", suiteKey)
        assertEquals(reminders, SuitePeers.peerName(preview, app("app.shkriuss.reminders.preview", suiteKey)))
    }

    @Test
    fun everyOtherAppIsRefused() {
        listOf(
            "the keeper itself" to app("app.shkriuss.water", suiteKey),
            "another certificate" to app("app.shkriuss.reminders", otherKey),
            "two signers" to app("app.shkriuss.reminders", suiteKey, otherKey),
            "a signer and multiple signers" to app("app.shkriuss.reminders", suiteKey, multiple = true),
            "no signer" to app("app.shkriuss.reminders"),
            "a preview asking a real app" to app("app.shkriuss.reminders.preview", suiteKey),
            "the same app as a preview" to app("app.shkriuss.water.preview", suiteKey),
            "Sync" to app("app.shkriuss.sync", suiteKey),
            "Catalog" to app("app.shkriuss.catalog", suiteKey),
            "another package" to app("com.example.reminders", suiteKey),
            "a longer ID" to app("app.shkriuss.reminders.debug", suiteKey),
            "upper case" to app("app.shkriuss.Reminders", suiteKey),
            "an empty name" to app("app.shkriuss.", suiteKey),
        ).forEach { (what, other) -> assertNull(what, SuitePeers.peerName(water, other)) }

        val preview = app("app.shkriuss.water.preview", suiteKey)
        assertNull("a real app asking a preview", SuitePeers.peerName(preview, app("app.shkriuss.reminders", suiteKey)))
        assertNull("a keeper with two signers", SuitePeers.peerName(app("app.shkriuss.water", suiteKey, otherKey), app("app.shkriuss.reminders", suiteKey)))
    }

    private fun request(caller: String?, extras: Bundle?, suite: SuiteApps = FakeSuiteApps(peers = mapOf("app.shkriuss.reminders" to reminders))) =
        HandoverRequest.of(caller, extras, suite)

    private fun extras(version: Int? = Handover.VERSION, mode: String? = HandoverMode.KEYS.name) = Bundle().apply {
        if (version != null) putInt(Handover.EXTRA_VERSION, version)
        if (mode != null) putString(Handover.EXTRA_MODE, mode)
    }

    @Test
    fun theKeeperTakesTheAskingAppOnlyFromAndroid() {
        val valid = request("app.shkriuss.reminders", extras()) as HandoverRequest.Valid
        assertEquals(reminders, valid.asker)
        assertEquals("app.shkriuss.reminders", valid.askerPackage)
        assertEquals(HandoverMode.KEYS, valid.mode)
        val check = request("app.shkriuss.reminders", extras(mode = HandoverMode.CHECK_WORDS.name)) as HandoverRequest.Valid
        assertEquals(HandoverMode.CHECK_WORDS, check.mode)

        // An app name in the extras changes nothing: none is read from there.
        val named = extras().apply { putString("app.shkriuss.handover.APP", "water") }
        assertEquals(reminders, (request("app.shkriuss.reminders", named) as HandoverRequest.Valid).asker)
    }

    @Test
    fun aRequestThatIsNotOneOfOursIsRefused() {
        assertEquals("started without a result", HandoverRequest.Refused, request(null, extras()))
        assertEquals("not a peer", HandoverRequest.Refused, request("app.shkriuss.notes", extras()))
        assertEquals("no extras", HandoverRequest.Refused, request("app.shkriuss.reminders", null))
        assertEquals("no version", HandoverRequest.Refused, request("app.shkriuss.reminders", extras(version = null)))
        assertEquals("version 0", HandoverRequest.Refused, request("app.shkriuss.reminders", extras(version = 0)))
        assertEquals("no mode", HandoverRequest.Refused, request("app.shkriuss.reminders", extras(mode = null)))
        assertEquals("another mode", HandoverRequest.Refused, request("app.shkriuss.reminders", extras(mode = "RECOVERY_KEY")))
        val wrongType = Bundle().apply { putString(Handover.EXTRA_VERSION, "1") }
        assertEquals("a version of another type", HandoverRequest.Refused, request("app.shkriuss.reminders", wrongType))
        assertEquals("a newer version", HandoverRequest.Newer, request("app.shkriuss.reminders", extras(version = 2)))
    }

    private fun keeperKeys(): Pair<Intent, KeyId> {
        val keeper = softwareApp(File(temporary.newFolder(), "shk-keys"))
        val key = keeper.crypto.setup.createRecoveryKey()
        keeper.crypto.setup.storeDerivedKeys(key)
        keeper.crypto.setup.beginKeepRecoveryKey(key)!!.finish()
        return keysResult(keeper.crypto.setup.beginHandOver(reminders).finish()) to key.keyId
    }

    @Test
    fun theAskingAppReadsTheKeysAndChecksTheKeeperAgain() {
        val (data, keyId) = keeperKeys()
        val suite = FakeSuiteApps(peers = mapOf("app.shkriuss.water" to AppName.of("water")))
        val answer = KeeperAnswer.of("app.shkriuss.water", ActivityResult(Activity.RESULT_OK, data), suite)
        assertEquals(keyId, (answer as KeeperAnswer.Keys).keys.keyId)

        suite.peers = emptyMap()
        assertEquals(
            "a keeper that no longer passes the checks",
            KeeperAnswer.NotASuiteApp,
            KeeperAnswer.of("app.shkriuss.water", ActivityResult(Activity.RESULT_OK, data), suite),
        )
    }

    @Test
    fun theAskingAppReadsEveryOtherAnswerAsWhatItIs() {
        val suite = FakeSuiteApps(peers = mapOf("app.shkriuss.water" to AppName.of("water")))
        fun answer(code: Int, data: Intent?) = KeeperAnswer.of("app.shkriuss.water", ActivityResult(code, data), suite)

        assertEquals(KeeperAnswer.Declined, answer(Activity.RESULT_CANCELED, null))
        assertEquals(KeeperAnswer.Declined, answer(Activity.RESULT_CANCELED, refusalResult(null)))
        assertEquals(KeeperAnswer.NotKeeper, answer(Activity.RESULT_CANCELED, refusalResult(HandoverRefusal.NOT_KEEPER)))
        assertEquals(KeeperAnswer.Update, answer(Activity.RESULT_CANCELED, refusalResult(HandoverRefusal.UPDATE)))
        assertEquals("the keeper refused this app", KeeperAnswer.NotASuiteApp, answer(Activity.RESULT_CANCELED, refusalResult(HandoverRefusal.REFUSED)))
        assertEquals("keys missing", KeeperAnswer.Unreadable, answer(Activity.RESULT_OK, null))
        assertEquals("keys of no format", KeeperAnswer.Unreadable, answer(Activity.RESULT_OK, Intent().putExtra("x", 1)))
        val newer = Intent().putExtra("app.shkriuss.handover.VERSION", 2)
        assertEquals(KeeperAnswer.Update, answer(Activity.RESULT_OK, newer))
    }

    @Test
    fun closingTheKeepersScreenSaysNotKeeperWhenTheKeptCopyIsGoneOrDamaged() {
        // ADR 0041, point 16: then the asking app offers the 24 words.
        assertEquals(HandoverRefusal.NOT_KEEPER, closingRefusal(HandoverNotKept))
        assertEquals(HandoverRefusal.NOT_KEEPER, closingRefusal(HandoverFailed(damaged = true)))
        assertNull("the keys could not be read now: nothing changes", closingRefusal(HandoverFailed(damaged = false)))
        assertNull(closingRefusal(HandoverWorking))
    }

    @Test
    fun theStatusProviderAnswersOnlyAppsOfTheSuite() {
        val host = RuntimeEnvironment.getApplication() as TestHostApp
        val keeper = host.keys.crypto
        val key = keeper.setup.createRecoveryKey()
        keeper.setup.storeDerivedKeys(key)
        val suite = FakeSuiteApps(peers = mapOf("app.shkriuss.reminders" to reminders))

        assertNull("no caller", KeeperStatusProvider.statusFor(null, suite, host))
        assertNull("not a peer", KeeperStatusProvider.statusFor("com.example.other", suite, host))
        assertNull("no host", KeeperStatusProvider.statusFor("app.shkriuss.reminders", suite, null))
        assertNull("set up, not kept", KeeperStatus.keyIdOf(KeeperStatusProvider.statusFor("app.shkriuss.reminders", suite, host)!!))

        keeper.setup.beginKeepRecoveryKey(key)!!.finish()
        assertEquals(key.keyId.toString(), KeeperStatus.keyIdOf(KeeperStatusProvider.statusFor("app.shkriuss.reminders", suite, host)!!))

        host.keys.screenLock = false
        assertNull("the guard went with the screen lock", KeeperStatus.keyIdOf(KeeperStatusProvider.statusFor("app.shkriuss.reminders", suite, host)!!))
    }

    @Test
    fun aStatusAnswerIsReadOnlyInItsOwnForm() {
        val id = KeyId(0x0a0b0c0d)
        assertEquals("0a0b0c0d", KeeperStatus.keyIdOf(KeeperStatus.bundleOf(id)))
        assertNull(KeeperStatus.keyIdOf(KeeperStatus.bundleOf(null)))
        assertNull(KeeperStatus.keyIdOf(Bundle()))
        assertNull("a newer version", KeeperStatus.keyIdOf(KeeperStatus.bundleOf(id).apply { putInt("app.shkriuss.keeper.VERSION", 2) }))
        assertNull("no key ID", KeeperStatus.keyIdOf(KeeperStatus.bundleOf(id).apply { remove("app.shkriuss.keeper.KEY_ID") }))
        assertNull("a key ID of another type", KeeperStatus.keyIdOf(KeeperStatus.bundleOf(id).apply { putString("app.shkriuss.keeper.KEY_ID", "0a0b0c0d") }))
        assertNull("a key ID of another number type", KeeperStatus.keyIdOf(KeeperStatus.bundleOf(id).apply { putLong("app.shkriuss.keeper.KEY_ID", 1L) }))
        // A key ID is four bytes of PRF output, so 0 is one of them.
        assertEquals("00000000", KeeperStatus.keyIdOf(KeeperStatus.bundleOf(KeyId(0))))
        assertTrue(Handover.statusAuthority("app.shkriuss.water") == "app.shkriuss.water.keeper")
    }
}
