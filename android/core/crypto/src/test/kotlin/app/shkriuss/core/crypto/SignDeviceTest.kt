package app.shkriuss.core.crypto

import android.os.Bundle
import app.shkriuss.core.crypto.fixtures.SoftwareHardwareKeys
import org.junit.Assert.assertArrayEquals
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

/**
 * The mode "Sign a device" of the handover format, version 2
 * (crypto-design.md): a keeper signs a join statement after one prompt,
 * an app that does not keep the key signs with all 24 words of its own
 * key, and the Sync app reads and checks what comes back.
 */
@RunWith(RobolectricTestRunner::class)
class SignDeviceTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val key = TestKeys.vectorRecoveryKey()
    private val otherKey = RecoveryKey.ofBytes(ByteArray(32) { 0x77 })
    private val serverId = ByteArray(16) { (15 - it).toByte() }
    private val address = "https://sync.example.workers.dev"
    private val device = TestKeys.syncApp().sync.makeDeviceKey(1)
    private val request = DeviceJoinRequest.of(serverId, address, device.publicKey)!!

    /** Water, with its keys from [own], keeping it when [keeps]. */
    private fun water(own: RecoveryKey = key, keeps: Boolean = true): TestApp {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(own))
        if (keeps) crypto.setup.beginKeepRecoveryKey(own)!!.finish()
        return app
    }

    private fun throughABundle(signed: SignedJoin): SignedJoin = SignedJoin.readFrom(Bundle().also { signed.writeTo(it) })

    @Test
    fun aKeeperSignsTheJoinWithTheTimeOfTheMomentItSigns() {
        var now = 1_000L
        val step = water().open().setup.beginSignDevice(request) { now }
        now = 2_000L
        val signed = throughABundle(step.finish())
        assertEquals(2_000L, signed.time)
        assertEquals(key.keyId, signed.keyId)
        assertTrue(signed.isFor(request))
        assertTrue(AccountKey.verifies(signed.accountPublicKey, signed.statement, signed.signature))
        assertArrayEquals(AccountKey.sign(key, ByteArray(0)).first, signed.accountPublicKey)
        assertTrue(KeysetCodec.sameKeys(signed.nameKey, RecoveryKeyDeriver.nameKey(key)))
    }

    @Test
    fun aKeeperThatDoesNotKeepTheKeyNowStartsNoPrompt() {
        val water = water(keeps = false)
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { water.open().setup.beginSignDevice(request) })
    }

    @Test
    fun aKeeperSignsWithTheOlderKeyTheRequestNames() {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        // A keeper of two recovery keys, the newer one current, as after a new recovery key.
        val recovery = RecoveryKeyDeriver.recoveryKeyset(listOf(key, otherKey), otherKey)
        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerived(recovery))
        app.vault.locked {
            val guard = app.vault.newKey(HardwareKeyKind.RECOVERY_GUARD)
            app.vault.storeWithPrompt(KeysetName.RECOVERY, recovery, guard, PromptCipher(app.vault.startCipher(guard, null), true))
        }
        assertTrue(app.open().setup.hasKeysOf(key.keyId))

        val older = DeviceJoinRequest.of(serverId, address, device.publicKey, key.keyId)!!
        assertEquals(key.keyId, app.open().setup.beginSignDevice(older).finish().keyId)
        assertEquals(otherKey.keyId, app.open().setup.beginSignDevice(request).finish().keyId)
        val unknown = DeviceJoinRequest.of(serverId, address, device.publicKey, KeyId(0x01020304))!!
        assertFalse(app.open().setup.hasKeysOf(unknown.keyId!!))
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { app.open().setup.beginSignDevice(unknown).finish() })
    }

    @Test
    fun anAppThatIsNotAKeeperSignsWithTheWordsOfItsOwnKey() {
        val water = water(keeps = false)
        val signed = water.open().setup.signDeviceWithWords(key, request) { 5_000L }
        assertNotNull(signed)
        assertEquals(5_000L, signed!!.time)
        assertEquals(key.keyId, signed.keyId)
        assertTrue(throughABundle(signed).isFor(request))
        assertTrue("nothing is stored", water.store.changes.isEmpty())
        assertFalse("the key is not kept", water.open().setup.keepsRecoveryKey())
    }

    @Test
    fun theWordsOfAnotherRecoveryKeyAreRefused() {
        val water = water(keeps = false)
        assertNull(water.open().setup.signDeviceWithWords(otherKey, request))
        val asksForOther = DeviceJoinRequest.of(serverId, address, device.publicKey, otherKey.keyId)!!
        assertNull("only the app's own keys", water.open().setup.signDeviceWithWords(otherKey, asksForOther))
        val asksForOwnButOther = DeviceJoinRequest.of(serverId, address, device.publicKey, KeyId(0x01020304))!!
        assertNull(water.open().setup.signDeviceWithWords(key, asksForOwnButOther))
    }

    @Test
    fun anAppWithNoKeysSignsNothing() {
        val app = TestApp(temporary.newFolder())
        assertNull(app.open().setup.signDeviceWithWords(key, request))
        assertFalse(app.open().setup.hasKeysOf(key.keyId))
    }

    @Test
    fun theSyncAppSignsNoJoin() {
        val sync = TestApp(temporary.newFolder(), SoftwareHardwareKeys(), RecoveryKeyDeriver.SYNC).open()
        assertThrows(IllegalStateException::class.java) { sync.setup.signDeviceWithWords(key, request) }
    }

    @Test
    fun aSignedJoinIsReadOnlyWhenEveryPartFits() {
        val signed = water().open().setup.beginSignDevice(request).finish()
        fun with(change: (Bundle) -> Unit): BlobAnswer? {
            val bundle = Bundle().also { signed.writeTo(it) }
            change(bundle)
            return TestKeys.answerOf { SignedJoin.readFrom(bundle) }
        }
        val prefix = "app.shkriuss.handover."
        assertNull(with {})
        assertEquals(BlobAnswer.MADE_BY_A_NEWER_VERSION, with { it.putInt(prefix + "VERSION", 3) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, with { it.putInt(prefix + "VERSION", 1) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, with { it.putString(prefix + "VERSION", "2") })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, with { it.remove(prefix + "STATEMENT") })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, with { it.putByteArray(prefix + "STATEMENT", signed.statement.also { s -> s[30] = (s[30] + 1).toByte() }) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, with { it.putByteArray(prefix + "SIGNATURE", signed.signature.also { s -> s[0] = (s[0] + 1).toByte() }) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, with { it.putByteArray(prefix + "ACCOUNT_PUBLIC_KEY", ByteArray(32)) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, with { it.putByteArray(prefix + "NAME_KEY", KeysetCodec.serialize(RecoveryKeyDeriver.nameKey(otherKey))) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, with { it.putByteArray(prefix + "NAME_KEY", KeysetCodec.serialize(TestKeys.derived(key).backup)) })
        val newAccountKeyType = signed.statement.also { it[8] = 2 }
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, with { it.putByteArray(prefix + "STATEMENT", newAccountKeyType) })
    }

    @Test
    fun aSignedJoinForAnotherRequestIsNotForThisOne() {
        val signed = water().open().setup.beginSignDevice(request).finish()
        val otherServer = DeviceJoinRequest.of(ByteArray(16), address, device.publicKey)!!
        val otherAddress = DeviceJoinRequest.of(serverId, "https://sync2.example.workers.dev", device.publicKey)!!
        val otherDevice = DeviceJoinRequest.of(serverId, address, TestKeys.syncApp().sync.makeDeviceKey(1).publicKey)!!
        val otherKeyId = DeviceJoinRequest.of(serverId, address, device.publicKey, otherKey.keyId)!!
        listOf(otherServer, otherAddress, otherDevice, otherKeyId).forEach { assertFalse(signed.isFor(it)) }
        assertTrue(signed.isFor(DeviceJoinRequest.of(serverId, address, device.publicKey, key.keyId)!!))
    }

    @Test
    fun aRequestTravelsInExtrasAndIsCheckedWhenRead() {
        val extras = Bundle().also { request.writeTo(it) }
        assertTrue(DeviceJoinRequest.readFrom(extras)!!.sameAs(request))
        val withKey = DeviceJoinRequest.of(serverId, address, device.publicKey, key.keyId)!!
        assertEquals(key.keyId, DeviceJoinRequest.readFrom(Bundle().also { withKey.writeTo(it) })!!.keyId)

        val prefix = "app.shkriuss.handover."
        fun with(change: (Bundle) -> Unit) = DeviceJoinRequest.readFrom(Bundle().also { request.writeTo(it); change(it) })
        assertNull(with { it.remove(prefix + "SERVER_ID") })
        assertNull(with { it.putByteArray(prefix + "SERVER_ID", ByteArray(15)) })
        assertNull(with { it.putString(prefix + "SERVER_ADDRESS", "https://sync.example.workers.dev/") })
        assertNull(with { it.putInt(prefix + "SERVER_ADDRESS", 1) })
        assertNull(with { it.putByteArray(prefix + "DEVICE_PUBLIC_KEY", device.publicKey.also { k -> k[64] = (k[64] + 1).toByte() }) })
        assertNull(with { it.putString(prefix + "KEY_ID", "b19d376f") })
    }

    @Test
    fun theAddressOfAStatementHasOneForm() {
        listOf(
            "https://sync.example.workers.dev",
            "https://a.b",
            "https://xn--80ak6aa92e.com",
            "https://sync.example.com:8443",
            "https://localhost:1",
            "https://my-sync.example.com",
        ).forEach { assertTrue(it, SyncAddress.isValid(it)) }
        listOf(
            "http://sync.example.com",
            "https://",
            "https://Sync.example.com",
            "https://sync.example.com/",
            "https://sync.example.com/v1",
            "https://sync.example.com?x",
            "https://user@sync.example.com",
            "https://sync.example.com:443",
            "https://sync.example.com:0",
            "https://sync.example.com:65536",
            "https://sync.example.com:08443",
            "https://sync.example.com:",
            "https://192.168.1.2",
            "https://[::1]",
            "https://-sync.example.com",
            "https://sync-.example.com",
            "https://sync..example.com",
            "https://sync.example.com.",
            "https://sync_x.example.com",
            "https://sync.exämple.com",
            " https://sync.example.com",
            "https://" + "a".repeat(64) + ".com",
            "https://" + List(64) { "abc" }.joinToString("."),
        ).forEach { assertFalse(it, SyncAddress.isValid(it)) }
    }

    @Test
    fun aRequestHoldsOnlyValuesAStatementCanHold() {
        assertNull(DeviceJoinRequest.of(ByteArray(17), address, device.publicKey))
        assertNull(DeviceJoinRequest.of(serverId, "https://sync.example.com/", device.publicKey))
        assertNull(DeviceJoinRequest.of(serverId, address, device.publicKey.copyOf(64)))
        assertNull(DeviceJoinRequest.of(serverId, address, byteArrayOf(4) + ByteArray(64)))
        assertNull(DeviceJoinRequest.of(serverId, address, byteArrayOf(2) + device.publicKey.copyOfRange(1, 65)))
        assertEquals("sync.example.workers.dev", request.host)
        assertEquals("sync.example.com:8443", DeviceJoinRequest.of(serverId, "https://sync.example.com:8443", device.publicKey)!!.host)
    }

    @Test
    fun noPartShowsTheNameKey() {
        val signed = water().open().setup.beginSignDevice(request).finish()
        assertEquals("SignedJoin", signed.toString())
        assertEquals("DeviceJoinRequest(sync.example.workers.dev)", request.toString())
    }
}
