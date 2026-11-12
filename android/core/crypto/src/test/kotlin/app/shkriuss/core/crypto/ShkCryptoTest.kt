package app.shkriuss.core.crypto

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * The way into the module that an app uses, [ShkCrypto.create], with the
 * real [AndroidHardwareKeys]. Robolectric has no Android Keystore. So
 * these tests cannot make a key. They check the other half: where the
 * Keystore gives no answer, nothing is made, nothing is stored and nothing
 * is deleted. The Keystore itself is for the emulator tests.
 */
@RunWith(RobolectricTestRunner::class)
class ShkCryptoTest {
    private val context = RuntimeEnvironment.getApplication()
    private val recordId = "00112233-4455-4677-8899-aabbccddeeff"

    @Test
    fun aNewAppHasNoKeysAndStartsWithoutAKeystore() {
        val crypto = ShkCrypto.create(context, AppName.of("water"))
        crypto.start()

        val status = crypto.status()
        assertFalse(status.hasDerivedKeys)
        assertNull(status.keyId)
        assertFalse(status.keepsRecoveryKey)
        assertEquals(AppLockState.OFF, status.appLock)
        assertFalse(status.fileKeyMoveIsPending)
        assertEquals(emptyList<HardwareKeyStatus>(), status.hardwareKeys)
        assertFalse(crypto.appLock.canTurnOn())
        assertFalse(crypto.backups.mayMakeBackup())
    }

    @Test
    fun whereTheKeystoreGivesNoAnswerNothingIsMadeOrStored() {
        val crypto = ShkCrypto.create(context, AppName.of("water"))
        val key = crypto.setup.createRecoveryKey()

        // The Keystore cannot say whether an alias is free. So no key is made and nothing is written.
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.setup.storeDerivedKeys(key) })
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.files.wrap(recordId, crypto.files.newFileKey()) })
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.records.seal(recordId, ByteArray(1)) })

        val folder = File(context.noBackupFilesDir, "shk-keys")
        assertTrue("no keyset file was written", folder.list().isNullOrEmpty())
        assertFalse(crypto.status().hasDerivedKeys)
    }

    @Test
    fun theRealKeystoreClassSaysNotUsableWhenThereIsNoKeystore() {
        val hardware = AndroidHardwareKeys(context)
        val key = HardwareKeyRef(HardwareKeyKind.BACKGROUND, 1)

        assertEquals("a list that fails is empty", emptySet<String>(), hardware.aliases())
        val calls = mapOf<String, () -> Unit>(
            "exists" to { hardware.exists(key) },
            "security level" to { hardware.securityLevel(key) },
            "encrypt" to { hardware.encrypt(key, ByteArray(1), ByteArray(1)) },
            "decrypt" to { hardware.decrypt(key, ByteArray(40), ByteArray(1)) },
            "start a cipher" to { hardware.startCipher(HardwareKeyRef(HardwareKeyKind.LOCK, 1), null) },
            "delete" to { hardware.delete(key) },
        )
        calls.forEach { (what, call) ->
            try {
                call()
                fail("$what gave an answer without a Keystore")
            } catch (_: HardwareKeyNotUsable) {
                // Never "gone": a Keystore that fails is not proof that a key is lost.
            }
        }
        try {
            hardware.make(key)
            fail("made a key without a Keystore")
        } catch (_: CannotMakeHardwareKeyException) {
            // The app shows the error and makes nothing.
        }
    }

    @Test
    fun anUnlockedKeyIsAllowedFromAndroid15() {
        assertFalse(AndroidHardwareKeys(context, androidVersion = 33).unlockedKeyAllowed)
        assertFalse(AndroidHardwareKeys(context, androidVersion = 34).unlockedKeyAllowed)
        assertTrue(AndroidHardwareKeys(context, androidVersion = 35).unlockedKeyAllowed)
        assertTrue(AndroidHardwareKeys(context, androidVersion = 37).unlockedKeyAllowed)
    }
}
