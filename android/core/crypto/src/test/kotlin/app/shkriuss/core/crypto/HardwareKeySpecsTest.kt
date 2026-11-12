package app.shkriuss.core.crypto

import android.security.keystore.KeyProperties
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The settings of the four kinds of hardware key, against the settings
 * table under "Hardware keys" in crypto-design.md. Whether Android then
 * behaves as the table says is for the emulator tests.
 */
@RunWith(RobolectricTestRunner::class)
class HardwareKeySpecsTest {
    private fun spec(kind: HardwareKeyKind, strongBox: Boolean = false) =
        HardwareKeySpecs.spec(HardwareKeyRef(kind, 3), strongBox)

    @Test
    fun everyKindIsAnAes256GcmKeyForEncryptAndDecrypt() {
        HardwareKeyKind.entries.forEach { kind ->
            val spec = spec(kind)
            assertEquals("shk.${kind.aliasPart}.3", spec.keystoreAlias)
            assertEquals(256, spec.keySize)
            assertEquals(KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT, spec.purposes)
            assertArrayEquals(arrayOf(KeyProperties.BLOCK_MODE_GCM), spec.blockModes)
            assertArrayEquals(arrayOf(KeyProperties.ENCRYPTION_PADDING_NONE), spec.encryptionPaddings)
            // The Keystore always picks the IV.
            assertTrue(spec.isRandomizedEncryptionRequired)
        }
    }

    @Test
    fun strongBoxIsAskedForOnlyWhereThePhoneHasIt() {
        HardwareKeyKind.entries.forEach { kind ->
            assertTrue(spec(kind, strongBox = true).isStrongBoxBacked)
            assertFalse(spec(kind, strongBox = false).isStrongBoxBacked)
        }
    }

    @Test
    fun onlyTheUnlockedKeyNeedsAnUnlockedPhone() {
        HardwareKeyKind.entries.forEach { kind ->
            assertEquals(kind.name, kind == HardwareKeyKind.UNLOCKED, spec(kind).isUnlockedDeviceRequired)
        }
    }

    @Test
    fun theLockKeyAndTheRecoveryGuardNeedThePromptForEveryUse() {
        listOf(HardwareKeyKind.LOCK, HardwareKeyKind.RECOVERY_GUARD).forEach { kind ->
            val spec = spec(kind)
            assertTrue(spec.isUserAuthenticationRequired)
            assertEquals("timeout 0: one operation per prompt", 0, spec.userAuthenticationValidityDurationSeconds)
            assertEquals(
                KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL,
                spec.userAuthenticationType,
            )
            assertFalse(spec.isInvalidatedByBiometricEnrollment)
            assertTrue(kind.needsPrompt)
        }
    }

    @Test
    fun theBackgroundKeyAndTheUnlockedKeyNeedNoPrompt() {
        listOf(HardwareKeyKind.BACKGROUND, HardwareKeyKind.UNLOCKED).forEach { kind ->
            assertFalse(spec(kind).isUserAuthenticationRequired)
            assertFalse(kind.needsPrompt)
        }
    }

    @Test
    fun theKindBytesOfAWrappedKeyset() {
        assertEquals(listOf(1, 2, 3, 4), HardwareKeyKind.entries.map { it.number })
        assertEquals(
            "53484b01050300000102",
            WrappedKeyset.prefix(HardwareKeyRef(HardwareKeyKind.LOCK, 258)).toHex(),
        )
    }
}
