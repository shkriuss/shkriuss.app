package app.shkriuss.core.crypto

import app.shkriuss.core.crypto.fixtures.SoftwareHardwareKeys
import com.google.crypto.tink.subtle.EcdsaVerifyJce
import com.google.crypto.tink.subtle.EllipticCurves
import com.google.crypto.tink.subtle.Enums
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.security.GeneralSecurityException

/**
 * The keys of the Sync app (crypto-design.md, "Sync keys"): the device key
 * and its numbers, signed requests, the name key, sealed names and setup
 * codes, on the software stand-in for the Keystore.
 */
class SyncKeysTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val hardware = SoftwareHardwareKeys()
    private val app by lazy { TestApp(temporary.newFolder(), hardware, RecoveryKeyDeriver.SYNC) }
    private val recoveryKey = TestKeys.vectorRecoveryKey()
    private val serverId = ByteArray(16) { (15 - it).toByte() }

    private fun sync(): SyncKeys = app.open().sync

    private fun signedJoin(key: RecoveryKey = recoveryKey): SignedJoin {
        val device = sync().makeDeviceKey(99)
        val request = DeviceJoinRequest.of(serverId, "https://sync.example.workers.dev", device.publicKey)!!
        return SignedJoin.sign(key, request, TIME)
    }

    private fun verifies(publicKey: ByteArray, signature: ByteArray, data: ByteArray): Boolean = try {
        val key = EllipticCurves.getEcPublicKey(
            EllipticCurves.CurveType.NIST_P256,
            EllipticCurves.PointFormatType.UNCOMPRESSED,
            publicKey,
        )
        EcdsaVerifyJce(key, Enums.HashType.SHA256, EllipticCurves.EcdsaEncoding.IEEE_P1363).verify(signature, data)
        true
    } catch (_: GeneralSecurityException) {
        false
    }

    @Test
    fun aNewDeviceKeyGetsTheNumberAboveEveryListedOne() {
        assertEquals(1, sync().newDeviceKeyNumber())
        sync().makeDeviceKey(1)
        sync().makeDeviceKey(4)
        assertEquals(5, sync().newDeviceKeyNumber())
    }

    @Test
    fun aNumberWhoseKeyExistsIsNeverGivenAlsoWhenTheListLeavesItOut() {
        sync().makeDeviceKey(1)
        hardware.leftOutOfList += DeviceKeyRef(1).alias
        assertEquals(2, sync().newDeviceKeyNumber())
    }

    @Test
    fun noNumberWhenTheKeystoreCannotSay() {
        hardware.keystoreFails = true
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { sync().newDeviceKeyNumber() })
    }

    @Test
    fun makingTheDeviceKeyTwiceGivesTheSameKey() {
        val first = sync().makeDeviceKey(3)
        val again = sync().makeDeviceKey(3)
        assertEquals(listOf(3), hardware.madeDeviceKeys)
        assertArrayEquals(first.publicKey, again.publicKey)
        assertEquals(first.deviceId, again.deviceId)
        assertEquals(65, first.publicKey.size)
        assertEquals(4.toByte(), first.publicKey[0])
        assertEquals(DeviceId.ofPublicKey(first.publicKey), first.deviceId)
    }

    @Test
    fun aDeviceKeyThatCannotBeMadeChangesNothing() {
        hardware.cannotMake = true
        assertThrows(CannotMakeHardwareKeyException::class.java) { sync().makeDeviceKey(1) }
        assertNull(sync().deviceKey(1))
    }

    @Test
    fun aDeviceKeyIsReadBackAndIsGoneOnceDeleted() {
        val made = sync().makeDeviceKey(2)
        assertArrayEquals(made.publicKey, sync().deviceKey(2)!!.publicKey)
        sync().deleteDeviceKey(2)
        assertNull(sync().deviceKey(2))
        sync().deleteDeviceKey(2)
        assertEquals(listOf(2), hardware.deletedDeviceKeys)
    }

    @Test
    fun aDeviceKeyThatAndroidInvalidatedIsGone() {
        sync().makeDeviceKey(2)
        hardware.invalidated += DeviceKeyRef(2).alias
        assertNull(sync().deviceKey(2))
    }

    @Test
    fun aKeystoreThatFailsForAMomentLosesNothing() {
        sync().makeDeviceKey(2)
        hardware.keystoreFails = true
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { sync().deviceKey(2) })
        hardware.keystoreFails = false
        assertTrue(sync().deviceKey(2) != null)
    }

    @Test
    fun aSignedRequestIsTheProtocolsBytesSignedByTheDeviceKey() {
        val key = sync().makeDeviceKey(1)
        val body = "a body".toByteArray()
        val signature = sync().signRequest(key, serverId, TIME, RequestMethod.POST, "/v1/send?x=1", body)
        assertEquals(64, signature.size)
        val bytes = SignedRequest.bytes(serverId, key.deviceId, TIME, RequestMethod.POST, "/v1/send?x=1", body)
        assertTrue(verifies(key.publicKey, signature, bytes))
        assertFalse("another body", verifies(key.publicKey, signature, SignedRequest.bytes(serverId, key.deviceId, TIME, RequestMethod.POST, "/v1/send?x=1", ByteArray(0))))
    }

    @Test
    fun signingWithAKeyThatIsGoneSaysSo() {
        val key = sync().makeDeviceKey(1)
        hardware.loseDeviceKey(1)
        assertThrows(DeviceKeyGoneException::class.java) {
            sync().signRequest(key, serverId, TIME, RequestMethod.GET, "/v1/heads", ByteArray(0))
        }
    }

    @Test
    fun aKeyMadeLaterUnderTheSameNumberDoesNotSignForTheOldOne() {
        val old = sync().makeDeviceKey(1)
        sync().deleteDeviceKey(1)
        sync().makeDeviceKey(1)
        assertThrows(DeviceKeyGoneException::class.java) {
            sync().signRequest(old, serverId, TIME, RequestMethod.GET, "/v1/heads", ByteArray(0))
        }
    }

    @Test
    fun theSignedBytesRefuseValuesTheLayoutCannotHold() {
        val id = DeviceId.ofPublicKey(sync().makeDeviceKey(1).publicKey)
        assertThrows(IllegalArgumentException::class.java) { SignedRequest.bytes(ByteArray(15), id, TIME, RequestMethod.GET, "/v1/heads", ByteArray(0)) }
        assertThrows(IllegalArgumentException::class.java) { SignedRequest.bytes(serverId, id, -1, RequestMethod.GET, "/v1/heads", ByteArray(0)) }
        assertThrows(IllegalArgumentException::class.java) { SignedRequest.bytes(serverId, id, TIME, RequestMethod.GET, "v1/heads", ByteArray(0)) }
        assertThrows(IllegalArgumentException::class.java) { SignedRequest.bytes(serverId, id, TIME, RequestMethod.GET, "/v1/héads", ByteArray(0)) }
        assertThrows(IllegalArgumentException::class.java) { SignedRequest.bytes(serverId, id, TIME, RequestMethod.GET, "/v1/a b", ByteArray(0)) }
    }

    @Test
    fun atStartOnlyTheDeviceKeyTheStateNamesIsKept() {
        sync().makeDeviceKey(1)
        sync().makeDeviceKey(2)
        sync().makeDeviceKey(3)
        sync().deleteOtherDeviceKeys(keep = 2)
        assertEquals(setOf(DeviceKeyRef(2).alias), hardware.existing())
        sync().deleteOtherDeviceKeys(keep = null)
        assertTrue(hardware.existing().isEmpty())
    }

    @Test
    fun aListThatFailsDeletesNoDeviceKey() {
        sync().makeDeviceKey(1)
        hardware.listFails = true
        sync().deleteOtherDeviceKeys(keep = null)
        assertEquals(setOf(DeviceKeyRef(1).alias), hardware.existing())
    }

    @Test
    fun theCleanupAtStartLeavesDeviceKeysAlone() {
        sync().makeDeviceKey(1)
        app.open(start = true)
        assertEquals(setOf(DeviceKeyRef(1).alias), hardware.existing())
    }

    @Test
    fun theNameKeyIsStoredUnderTheBackgroundKeyAsRecord() {
        assertEquals(NameKeyState.MISSING, sync().nameKeyState())
        sync().storeNameKey(signedJoin())
        assertEquals(NameKeyState.STORED, sync().nameKeyState())
        assertEquals(HardwareKeyKind.BACKGROUND, app.keyOf(KeysetName.RECORD)!!.kind)
        val stored = (app.vault.look(KeysetName.RECORD) as Stored.Open).keyset
        assertTrue(KeysetCodec.sameKeys(stored, RecoveryKeyDeriver.nameKey(recoveryKey)))
    }

    @Test
    fun aNewNameKeyReplacesTheOldOne() {
        sync().storeNameKey(signedJoin())
        val other = RecoveryKey.ofBytes(ByteArray(32) { 0x55 })
        sync().storeNameKey(signedJoin(other))
        val stored = (app.vault.look(KeysetName.RECORD) as Stored.Open).keyset
        assertEquals(other.keyId, KeysetCodec.primaryId(stored))
    }

    @Test
    fun aDamagedNameKeyIsLostAndIsSetAsideWhenReplacedOrDeleted() {
        sync().storeNameKey(signedJoin())
        val file = java.io.File(app.folder, KeysetName.RECORD.text)
        file.writeBytes(file.readBytes().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() })
        assertEquals(NameKeyState.LOST, sync().nameKeyState())
        sync().storeNameKey(signedJoin())
        assertEquals(NameKeyState.STORED, sync().nameKeyState())
        assertTrue(java.io.File(app.setAsideFolder, "${KeysetName.RECORD.text}-1").exists())
    }

    @Test
    fun aNameKeyWhoseHardwareKeyIsGoneIsLost() {
        sync().storeNameKey(signedJoin())
        hardware.lose(app.keyOf(KeysetName.RECORD)!!)
        assertEquals(NameKeyState.LOST, sync().nameKeyState())
    }

    @Test
    fun deletingTheNameKeyDeletesItsBackgroundKeyToo() {
        sync().storeNameKey(signedJoin())
        val background = app.keyOf(KeysetName.RECORD)!!
        sync().deleteNameKey()
        assertEquals(NameKeyState.MISSING, sync().nameKeyState())
        assertTrue(background in hardware.deleted)
        sync().deleteNameKey()
    }

    @Test
    fun aNameIsSealedUnderItsDeviceIdAndOpensOnlyThere() {
        sync().storeNameKey(signedJoin())
        val one = sync().makeDeviceKey(1).deviceId
        val two = sync().makeDeviceKey(2).deviceId
        val sealed = sync().sealName(one, "Pixel 9 Pro")
        assertEquals("Pixel 9 Pro", sync().openName(one, sealed))
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { sync().openName(two, sealed) })
        assertNotEquals(sealed.toHex(), sync().sealName(one, "Pixel 9 Pro").toHex())
    }

    @Test
    fun aNameOfAnotherRecoveryKeyDoesNotOpen() {
        sync().storeNameKey(signedJoin())
        val id = sync().makeDeviceKey(1).deviceId
        val sealed = sync().sealName(id, "Tablet")
        sync().storeNameKey(signedJoin(RecoveryKey.ofBytes(ByteArray(32) { 0x55 })))
        assertEquals(BlobAnswer.NEEDS_ANOTHER_RECOVERY_KEY, TestKeys.answerOf { sync().openName(id, sealed) })
    }

    @Test
    fun noNameIsSealedWithoutANameKey() {
        val id = sync().makeDeviceKey(1).deviceId
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { sync().sealName(id, "Tablet") })
    }

    @Test
    fun aSealedNameThatHoldsNoValidNameIsRefused() {
        sync().storeNameKey(signedJoin())
        val id = sync().makeDeviceKey(1).deviceId
        val vault = app.vault
        val associatedData = AssociatedData.forId(BlobKind.SEALED_RECORD, id.toRecordId())
        listOf(byteArrayOf(), byteArrayOf(2) + "Tablet".toByteArray(), byteArrayOf(1), byteArrayOf(1, 0xff.toByte()), byteArrayOf(1) + " Tablet".toByteArray())
            .forEach { plaintext ->
                val blob = SealedBlobs.seal(BlobKind.SEALED_RECORD, vault.recordKeyset(), associatedData, plaintext)
                assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { app.open().sync.openName(id, blob) })
            }
    }

    @Test
    fun theRulesOfADevicesName() {
        assertTrue(DeviceNames.isValid("Pixel 9 Pro"))
        assertTrue(DeviceNames.isValid("a".repeat(40)))
        assertTrue(DeviceNames.isValid("ტაბლეტი"))
        assertTrue(DeviceNames.isValid("📱".repeat(40)))
        assertFalse(DeviceNames.isValid(""))
        assertFalse(DeviceNames.isValid("a".repeat(41)))
        assertFalse(DeviceNames.isValid(" Pixel"))
        assertFalse(DeviceNames.isValid("Pixel "))
        assertFalse(DeviceNames.isValid("Pixel "))
        assertFalse(DeviceNames.isValid("Pixel\n9"))
        assertFalse(DeviceNames.isValid("Pixel\t9"))
        assertFalse(DeviceNames.isValid("Pixel 9"))
        assertFalse("a lone surrogate", DeviceNames.isValid("Pixel\uD83D"))
        assertThrows(IllegalArgumentException::class.java) { sync().sealName(sync().makeDeviceKey(1).deviceId, " ") }
    }

    @Test
    fun aSetupCodeIs26CharactersOfTheCodeAlphabet() {
        val codes = (1..200).map { sync().newSetupCode() }
        codes.forEach { code ->
            assertEquals(26, code.length)
            assertTrue(code.all { it in SyncKeys.CODE_ALPHABET })
        }
        assertEquals(200, codes.toSet().size)
        assertEquals("every letter and digit comes up", SyncKeys.CODE_ALPHABET.toSet(), codes.joinToString("").toSet())
        assertEquals(32, SyncKeys.CODE_ALPHABET.length)
        assertFalse(SyncKeys.CODE_ALPHABET.any { it == 'I' || it == 'O' || it == '0' || it == '1' })
    }

    @Test
    fun noDataAppHasTheseKeys() {
        val water = TestApp(temporary.newFolder(), SoftwareHardwareKeys(), TestKeys.water).open().sync
        assertThrows(IllegalStateException::class.java) { water.newDeviceKeyNumber() }
        assertThrows(IllegalStateException::class.java) { water.storeNameKey(signedJoin()) }
        assertThrows(IllegalStateException::class.java) { water.newSetupCode() }
    }

    @Test
    fun aDerSignatureBecomesRAndS() {
        val r = ByteArray(32) { (it + 1).toByte() }
        val s = ByteArray(32) { (0x80 + it).toByte() }
        // s has its high bit set, so DER writes a 0 before it.
        val der = byteArrayOf(0x30, 69, 0x02, 32) + r + byteArrayOf(0x02, 33, 0) + s
        assertArrayEquals(r + s, P256.derToRaw(der))
        val shortR = byteArrayOf(0x30, 38, 0x02, 1, 7, 0x02, 33, 0) + s
        assertArrayEquals(ByteArray(31) + byteArrayOf(7) + s, P256.derToRaw(shortR))
    }

    @Test
    fun aMalformedDerSignatureIsRefused() {
        val r = ByteArray(32) { 1 }
        val good = byteArrayOf(0x30, 68, 0x02, 32) + r + byteArrayOf(0x02, 32) + r
        P256.derToRaw(good)
        listOf(
            good.copyOf(good.size - 1),
            good + byteArrayOf(0),
            byteArrayOf(0x31) + good.copyOfRange(1, good.size),
            byteArrayOf(0x30, 68, 0x03) + good.copyOfRange(3, good.size),
            byteArrayOf(0x30, 69, 0x02, 33, 0) + r + byteArrayOf(0x02, 32) + r,
            byteArrayOf(0x30, 68, 0x02, 32, 0x80.toByte()) + r.copyOf(31) + byteArrayOf(0x02, 32) + r,
            byteArrayOf(0x30, 6, 0x02, 1, 0, 0x02, 1, 1),
            byteArrayOf(0x30, 70, 0x02, 34, 0, 0) + r + byteArrayOf(0x02, 32) + r,
        ).forEach { bad -> assertThrows(IllegalArgumentException::class.java) { P256.derToRaw(bad) } }
    }

    @Test
    fun aDeviceIdIsReadFromItsHexOnlyInItsOwnForm() {
        val id = sync().makeDeviceKey(1).deviceId
        assertEquals(id, DeviceId.ofHex(id.toHex()))
        assertNull(DeviceId.ofHex(id.toHex().uppercase()))
        assertNull(DeviceId.ofHex(id.toHex().dropLast(1)))
        assertEquals(id, DeviceId.ofBytes(id.toBytes()))
        assertNull(DeviceId.ofBytes(ByteArray(15)))
        assertEquals(36, id.toRecordId().length)
    }

    private companion object {
        const val TIME = 1_767_225_600_000L
    }
}
