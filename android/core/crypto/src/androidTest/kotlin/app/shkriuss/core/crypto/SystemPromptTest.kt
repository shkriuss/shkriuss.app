package app.shkriuss.core.crypto

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The two keys that need Android's system prompt for every use, the Lock
 * key and the Recovery guard, used through the real prompt ("The system
 * prompt" and "Where Android does the work" in crypto-design.md).
 *
 * The emulator has a PIN and no fingerprint, so Android asks for the PIN.
 * Each test goes through the same calls an app makes: a step is started,
 * the prompt gets its `CryptoObject`, and `finish()` runs only after
 * Android says the prompt succeeded.
 */
class SystemPromptTest {
    private val app = DeviceApp()
    private val recoveryKey = TestKeys.vectorRecoveryKey()
    private val recordId = "00112233-4455-4677-8899-aabbccddeeff"
    private val fileId = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"

    @Before
    fun clean() = app.reset()

    @After
    fun cleanUp() = app.reset()

    /** An app with a screen lock and its keys from the recovery key. */
    private fun appWithKeys(): ShkCrypto {
        ScreenLock.set()
        return app.open().also { assertEquals(KeySetupResult.STORED, it.setup.storeDerivedKeys(recoveryKey)) }
    }

    private fun keepRecoveryKey(crypto: ShkCrypto) {
        val keep = checkNotNull(crypto.setup.beginKeepRecoveryKey(recoveryKey))
        SystemPrompt.answer(keep.cryptoObject)
        keep.finish()
    }

    @Test
    fun theRecoveryKeyIsKeptAndShownAgain() {
        val crypto = appWithKeys()

        keepRecoveryKey(crypto)

        assertTrue(crypto.setup.keepsRecoveryKey())
        assertEquals(HardwareKeyKind.RECOVERY_GUARD, app.keyOf(KeysetName.RECOVERY)?.kind)
        // Kind 5: ten bytes that name the key, a 12-byte IV read from the
        // cipher after encrypting, the 113 bytes of this keyset, a 16-byte tag.
        assertEquals(10 + 12 + 113 + 16, app.fileOf(KeysetName.RECOVERY).length().toInt())

        val restarted = app.open()
        val show = restarted.setup.beginShowRecoveryKey()
        SystemPrompt.answer(show.cryptoObject)

        assertEquals(recoveryKey.words(), show.finish().words())
    }

    @Test
    fun aKeyThatNeedsThePromptStillWorksAfterTheScreenLockIsChanged() {
        val crypto = appWithKeys()
        keepRecoveryKey(crypto)

        ScreenLock.change()

        val show = app.open().setup.beginShowRecoveryKey()
        SystemPrompt.answer(show.cryptoObject)
        assertEquals(recoveryKey.words(), show.finish().words())
    }

    @Test
    fun onePromptServesOneUse() {
        val crypto = appWithKeys()
        keepRecoveryKey(crypto)

        // A second step needs its own prompt: the first prompt does not open it.
        val second = crypto.setup.beginShowRecoveryKey()

        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { second.finish() })
    }

    @Test
    fun withoutThePromptNothingIsStored() {
        val crypto = appWithKeys()
        val keep = checkNotNull(crypto.setup.beginKeepRecoveryKey(recoveryKey))

        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { keep.finish() })

        assertFalse(crypto.setup.keepsRecoveryKey())
        assertNull(app.keyOf(KeysetName.RECOVERY))
        assertEquals(emptySet<String>(), app.aliasesOf(HardwareKeyKind.RECOVERY_GUARD))
    }

    @Test
    fun aChangedKeysetFileIsRefusedAfterThePrompt() {
        val crypto = appWithKeys()
        keepRecoveryKey(crypto)
        val file = app.fileOf(KeysetName.RECOVERY)
        val bytes = file.readBytes()
        bytes[bytes.size - 1] = (bytes[bytes.size - 1].toInt() xor 1).toByte()
        file.writeBytes(bytes)

        val show = app.open().setup.beginShowRecoveryKey()
        SystemPrompt.answer(show.cryptoObject)

        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { show.finish() })
        // The Recovery guard is not gone, so the file is never written over.
        assertTrue(app.hardware.exists(checkNotNull(app.keyOf(KeysetName.RECOVERY))))
    }

    @Test
    fun associatedDataGivenBeforeThePromptIsRefused() {
        ScreenLock.set()
        val key = HardwareKeyRef(HardwareKeyKind.LOCK, 1)
        app.hardware.make(key)
        val associatedData = "associated data".toByteArray()
        val cipher = app.hardware.startCipher(key, null)
        val step = PromptCipher(cipher, encrypts = true)

        // The wrong order: the associated data goes in before the prompt.
        // Android may refuse it now or at the end. Either way nothing comes out.
        try {
            cipher.updateAAD(associatedData)
        } catch (_: Exception) {
            return
        }
        SystemPrompt.answer(step.cryptoObject)

        assertThrows(HardwareKeyNotUsable::class.java) { step.finish("a keyset".toByteArray(), ByteArray(0)) }
    }

    @Test
    fun theAppLockIsTurnedOnUnlockedAndTurnedOff() {
        val crypto = appWithKeys()
        val sealed = crypto.records.seal(recordId, "a record".toByteArray())
        val fileKey = crypto.files.newFileKey()
        val file = TestKeys.encryptFile(fileKey, fileId, "a file".toByteArray())
        val wrapped = crypto.files.wrap(fileId, fileKey)
        val home = checkNotNull(app.keyOf(KeysetName.FILE_KEY))
        assertTrue(crypto.appLock.canTurnOn())

        // Turn on: one prompt of the new Lock key.
        val turnOn = crypto.appLock.beginTurnOn()
        SystemPrompt.answer(turnOn.cryptoObject)
        turnOn.finish()

        assertEquals(AppLockState.ON, crypto.appLock.state())
        assertEquals(HardwareKeyKind.LOCK, app.keyOf(KeysetName.FILE_KEY)?.kind)
        // The key that wrapped file-key without a prompt is deleted. The other keysets moved to a new one.
        assertFalse(app.hardware.exists(home))
        assertEquals(setOf(checkNotNull(app.keyOf(KeysetName.BACKUP)).alias), app.aliasesOf(home.kind))

        // The app is started again: it is locked. Records work, files do not.
        val restarted = app.open()
        assertTrue(restarted.appLock.isLocked())
        assertEquals("a record", String(restarted.records.open(recordId, sealed)))
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { restarted.files.unwrap(fileId, wrapped) })

        // Unlock: one prompt, one decrypt operation.
        val unlock = restarted.appLock.beginUnlock()
        SystemPrompt.answer(unlock.cryptoObject)
        unlock.finish()

        assertFalse(restarted.appLock.isLocked())
        assertArrayEquals(
            "a file".toByteArray(),
            TestKeys.decryptFile(restarted.files.unwrap(fileId, wrapped), fileId, file),
        )

        // Turn off, while unlocked: no prompt, and the Lock key is deleted.
        restarted.appLock.turnOff()

        assertEquals(AppLockState.OFF, restarted.appLock.state())
        assertEquals(emptySet<String>(), app.aliasesOf(HardwareKeyKind.LOCK))
        app.open().files.unwrap(fileId, wrapped)
    }
}
