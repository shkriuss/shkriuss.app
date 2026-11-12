package app.shkriuss.core.crypto

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * What an app can still do after the screen lock is removed ("When things
 * change" in crypto-design.md, points 3 and 4, and "No phone setting
 * destroys files"). Android deletes the Lock key and the Recovery guard.
 * Everything else goes on, and the recovery words bring back what the
 * Lock key held.
 */
class ScreenLockRemovedTest {
    private val app = DeviceApp()
    private val recoveryKey = TestKeys.vectorRecoveryKey()
    private val recordId = "00112233-4455-4677-8899-aabbccddeeff"
    private val fileId = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"

    @Before
    fun clean() = app.reset()

    @After
    fun cleanUp() = app.reset()

    /** An app with a screen lock, its keys from the recovery key, one record and one file. */
    private class Fixture(val crypto: ShkCrypto, val sealed: ByteArray, val wrapped: ByteArray)

    private fun appWithKeys(): Fixture {
        ScreenLock.set()
        val crypto = app.open()
        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(recoveryKey))
        return Fixture(
            crypto,
            sealed = crypto.records.seal(recordId, "a record".toByteArray()),
            wrapped = crypto.files.wrap(fileId, crypto.files.newFileKey()),
        )
    }

    private fun keepRecoveryKey(crypto: ShkCrypto) {
        val keep = checkNotNull(crypto.setup.beginKeepRecoveryKey(recoveryKey))
        SystemPrompt.answer(keep.cryptoObject)
        keep.finish()
    }

    private fun turnAppLockOn(crypto: ShkCrypto) {
        val turnOn = crypto.appLock.beginTurnOn()
        SystemPrompt.answer(turnOn.cryptoObject)
        turnOn.finish()
        assertEquals(AppLockState.ON, crypto.appLock.state())
    }

    private fun assertRecordsWork(crypto: ShkCrypto, fixture: Fixture) {
        assertEquals("a record", String(crypto.records.open(recordId, fixture.sealed)))
        assertEquals(recoveryKey.keyId, crypto.backups.keyId())
    }

    @Test
    fun withTheAppLockOffOnlyTheKeptRecoveryKeyIsLost() {
        val fixture = appWithKeys()
        keepRecoveryKey(fixture.crypto)

        ScreenLock.remove()
        val restarted = app.open()

        // Files, records and backup go on.
        assertRecordsWork(restarted, fixture)
        restarted.files.unwrap(fileId, fixture.wrapped)
        // No app keeps the recovery key any more.
        assertFalse(restarted.setup.keepsRecoveryKey())
        assertFalse(restarted.status().hasScreenLock)
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { restarted.setup.beginShowRecoveryKey() })
        assertNull(restarted.setup.beginKeepRecoveryKey(recoveryKey))

        // To keep it again: set a screen lock and give the words once.
        ScreenLock.set()
        keepRecoveryKey(restarted)

        assertTrue(restarted.setup.keepsRecoveryKey())
        val show = restarted.setup.beginShowRecoveryKey()
        SystemPrompt.answer(show.cryptoObject)
        assertEquals(recoveryKey.words(), show.finish().words())
    }

    @Test
    fun withTheAppLockOnTheRecoveryWordsOpenTheFilesAgain() {
        val fixture = appWithKeys()
        turnAppLockOn(fixture.crypto)

        ScreenLock.remove()
        val restarted = app.open()

        // The app lock was reset. The files are closed. Records and backup go on.
        assertEquals(AppLockState.RESET, restarted.appLock.state())
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { restarted.files.unwrap(fileId, fixture.wrapped) })
        assertRecordsWork(restarted, fixture)

        // The words derive the file-key keyset again.
        assertEquals(KeySetupResult.STORED, restarted.setup.storeDerivedKeys(recoveryKey))

        assertEquals(AppLockState.OFF, restarted.appLock.state())
        restarted.files.unwrap(fileId, fixture.wrapped)
        assertRecordsWork(restarted, fixture)
    }

    @Test
    fun anAppThatIsUnlockedKeepsItsFilesWithoutTheWords() {
        val fixture = appWithKeys()
        turnAppLockOn(fixture.crypto)

        // The app stays unlocked, with the file-key keyset in memory.
        ScreenLock.remove()

        assertEquals(AppLockState.OFF, fixture.crypto.appLock.state())
        fixture.crypto.files.unwrap(fileId, fixture.wrapped)
        assertFalse(checkNotNull(app.keyOf(KeysetName.FILE_KEY)).kind.needsPrompt)
        app.open().files.unwrap(fileId, fixture.wrapped)
    }
}
