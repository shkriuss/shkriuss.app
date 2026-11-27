package app.shkriuss.core.crypto

import android.content.pm.PackageManager
import app.shkriuss.core.testing.TestDevice
import com.google.crypto.tink.subtle.EcdsaVerifyJce
import com.google.crypto.tink.subtle.EllipticCurves
import com.google.crypto.tink.subtle.Enums
import java.security.GeneralSecurityException
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.Test

/**
 * [AndroidHardwareKeys] on the real Android Keystore, on an emulator with
 * no screen lock: making, asking for, listing, using and deleting a key
 * that needs no prompt, and which failure is which ("Rules for making,
 * replacing and losing a hardware key" in crypto-design.md). Also the
 * Sync app's device key, which signs ("The device key").
 */
class HardwareKeysTest {
    private val app = DeviceApp()
    private val hardware = app.hardware
    private val background = HardwareKeyRef(HardwareKeyKind.BACKGROUND, 1)
    private val plaintext = "a keyset".toByteArray()
    private val associatedData = "associated data".toByteArray()

    @Before
    fun clean() = app.reset()

    @After
    fun cleanUp() = app.reset()

    @Test
    fun aKeyExistsFromWhenItIsMadeUntilItIsDeleted() {
        assertFalse(hardware.exists(background))
        assertFalse(background.alias in hardware.aliases())

        hardware.make(background)
        assertTrue(hardware.exists(background))
        assertTrue(background.alias in hardware.aliases())

        hardware.delete(background)
        assertFalse(hardware.exists(background))
        assertFalse(background.alias in hardware.aliases())
    }

    @Test
    fun deletingAKeyThatDoesNotExistIsNotAnError() {
        hardware.delete(background)
        assertFalse(hardware.exists(background))
    }

    @Test
    fun theBackgroundKeyWrapsAndOpensWithTheLayoutOfKind5() {
        hardware.make(background)

        val blob = hardware.encrypt(background, plaintext, associatedData)

        // A 12-byte IV, the ciphertext, a 16-byte tag.
        assertEquals(12 + plaintext.size + 16, blob.size)
        assertArrayEquals(plaintext, hardware.decrypt(background, blob, associatedData))
    }

    @Test
    fun theKeystorePicksANewIvForEveryEncryption() {
        hardware.make(background)

        val first = hardware.encrypt(background, plaintext, associatedData)
        val second = hardware.encrypt(background, plaintext, associatedData)

        assertFalse(first.copyOf(12).contentEquals(second.copyOf(12)))
    }

    @Test
    fun aChangedBlobIsRefused() {
        hardware.make(background)
        val blob = hardware.encrypt(background, plaintext, associatedData)

        listOf(0, 12, blob.size - 1).forEach { position ->
            val changed = blob.copyOf().also { it[position] = (it[position].toInt() xor 1).toByte() }
            assertThrows("byte $position", HardwareBlobRefused::class.java) {
                hardware.decrypt(background, changed, associatedData)
            }
        }
        assertThrows(HardwareBlobRefused::class.java) {
            hardware.decrypt(background, blob, "other associated data".toByteArray())
        }
        // The key is still there and still opens the blob.
        assertArrayEquals(plaintext, hardware.decrypt(background, blob, associatedData))
    }

    @Test
    fun aBlobOfAnotherKeyIsRefused() {
        val other = HardwareKeyRef(HardwareKeyKind.BACKGROUND, 2)
        hardware.make(background)
        hardware.make(other)
        val blob = hardware.encrypt(background, plaintext, associatedData)

        assertThrows(HardwareBlobRefused::class.java) { hardware.decrypt(other, blob, associatedData) }
    }

    @Test
    fun aKeyThatDoesNotExistIsGone() {
        val lock = HardwareKeyRef(HardwareKeyKind.LOCK, 1)

        assertThrows(HardwareKeyGone::class.java) { hardware.encrypt(background, plaintext, associatedData) }
        assertThrows(HardwareKeyGone::class.java) { hardware.decrypt(background, ByteArray(40), associatedData) }
        assertThrows(HardwareKeyGone::class.java) { hardware.securityLevel(background) }
        assertThrows(HardwareKeyGone::class.java) { hardware.startCipher(lock, null) }
        assertThrows(HardwareKeyGone::class.java) { hardware.startCipher(lock, ByteArray(12)) }
    }

    @Test
    fun aKeyThatNeedsThePromptCannotBeMadeWithoutAScreenLock() {
        assertFalse(hardware.hasScreenLock())

        listOf(HardwareKeyKind.LOCK, HardwareKeyKind.RECOVERY_GUARD).forEach { kind ->
            val key = HardwareKeyRef(kind, 1)
            assertThrows(CannotMakeHardwareKeyException::class.java) { hardware.make(key) }
            assertFalse(hardware.exists(key))
        }
    }

    @Test
    fun theSecurityLevelOfAKeyIsRead() {
        assumeFalse(
            "this emulator says it has StrongBox",
            TestDevice.context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE),
        )
        hardware.make(background)

        val level = hardware.securityLevel(background)

        TestDevice.note("Security level of a key on this emulator: $level")
        assertNotEquals(SecurityLevel.STRONGBOX, level)
    }

    @Test
    fun aNewKeyGetsTheNextNumber() {
        val vault = KeyVault(TestKeys.water, KeysetFiles(app.folder), hardware)

        val first = vault.locked { vault.newKey(HardwareKeyKind.BACKGROUND) }
        val second = vault.locked { vault.newKey(HardwareKeyKind.BACKGROUND) }

        assertEquals(HardwareKeyRef(HardwareKeyKind.BACKGROUND, 1), first)
        assertEquals(HardwareKeyRef(HardwareKeyKind.BACKGROUND, 2), second)
        assertEquals(setOf(first.alias, second.alias), app.aliasesOf(HardwareKeyKind.BACKGROUND))
    }

    @Test
    fun atStartAKeyThatNoKeysetFileNamesIsDeleted() {
        val crypto = app.open()
        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(TestKeys.vectorRecoveryKey()))
        val named = checkNotNull(app.keyOf(KeysetName.RECORD))
        val stray = HardwareKeyRef(HardwareKeyKind.BACKGROUND, named.number + 5)
        hardware.make(stray)

        val restarted = app.open()

        assertFalse(hardware.exists(stray))
        assertTrue(hardware.exists(named))
        assertEquals(TestKeys.vectorRecoveryKey().keyId, restarted.status().keyId)
    }

    @Test
    fun theDeviceKeySignsAndItsSignatureFitsItsPublicKey() {
        val device = DeviceKeyRef(1)
        assertFalse(hardware.exists(device))

        hardware.make(device)
        assertTrue(hardware.exists(device))
        assertTrue(device.alias in hardware.aliases())
        val publicKey = hardware.publicKey(device)
        assertEquals(65, publicKey.size)
        assertTrue(P256.isPublicKey(publicKey))

        val data = "the bytes of a request".toByteArray()
        val signature = P256.derToRaw(hardware.sign(device, data))
        val verifier = EcdsaVerifyJce(
            EllipticCurves.getEcPublicKey(EllipticCurves.CurveType.NIST_P256, EllipticCurves.PointFormatType.UNCOMPRESSED, publicKey),
            Enums.HashType.SHA256,
            EllipticCurves.EcdsaEncoding.IEEE_P1363,
        )
        verifier.verify(signature, data)
        assertThrows(GeneralSecurityException::class.java) { verifier.verify(signature, "other bytes".toByteArray()) }

        hardware.delete(device)
        assertFalse(hardware.exists(device))
    }

    @Test
    fun aDeviceKeyThatDoesNotExistIsGone() {
        val device = DeviceKeyRef(1)
        assertThrows(HardwareKeyGone::class.java) { hardware.publicKey(device) }
        assertThrows(HardwareKeyGone::class.java) { hardware.sign(device, ByteArray(1)) }
        hardware.delete(device)
    }

    @Test
    fun theCleanupAtStartLeavesTheDeviceKeyToTheSyncApp() {
        hardware.make(DeviceKeyRef(1))
        hardware.make(DeviceKeyRef(2))

        val sync = ShkCrypto.create(TestDevice.context, RecoveryKeyDeriver.SYNC).also { it.start() }
        assertTrue(hardware.exists(DeviceKeyRef(1)))
        assertEquals(3, sync.sync.newDeviceKeyNumber())

        sync.sync.deleteOtherDeviceKeys(keep = 2)
        assertFalse(hardware.exists(DeviceKeyRef(1)))
        assertTrue(hardware.exists(DeviceKeyRef(2)))
    }
}
