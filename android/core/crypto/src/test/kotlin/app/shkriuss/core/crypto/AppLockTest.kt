package app.shkriuss.core.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The optional app lock, as far as keys go ("The app lock" in
 * crypto-design.md), with the software stand-in for the hardware keys.
 * Calling `finish()` stands for a prompt that succeeded, `cancel()` for
 * one that was cancelled.
 */
@RunWith(RobolectricTestRunner::class)
class AppLockTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val recoveryKey = TestKeys.vectorRecoveryKey()
    private val recordId = "00112233-4455-4677-8899-aabbccddeeff"
    private val fileId = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"
    private val lockKey = HardwareKeyRef(HardwareKeyKind.LOCK, 1)

    /** An app with keys from a recovery key, one record and one file. */
    private class Fixture(val app: TestApp, val record: ByteArray, val file: ByteArray, val wrapped: ByteArray)

    private fun appWithKeys(hardware: SoftwareHardwareKeys = SoftwareHardwareKeys()): Fixture {
        val app = TestApp(temporary.newFolder(), hardware)
        val crypto = app.open()
        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(recoveryKey))
        val key = crypto.files.newFileKey()
        return Fixture(
            app,
            record = crypto.records.seal(recordId, "a record".toByteArray()),
            file = TestKeys.encryptFile(key, fileId, "a file".toByteArray()),
            wrapped = crypto.files.wrap(fileId, key),
        )
    }

    private fun assertRecordsWork(crypto: ShkCrypto, fixture: Fixture) {
        assertEquals("a record", String(crypto.records.open(recordId, fixture.record)))
        assertNotNull(crypto.records.seal(recordId, ByteArray(1)))
    }

    private fun assertFilesOpen(crypto: ShkCrypto, fixture: Fixture) {
        val key = crypto.files.unwrap(fileId, fixture.wrapped)
        assertArrayEquals("a file".toByteArray(), TestKeys.decryptFile(key, fileId, fixture.file))
    }

    private fun assertFilesAreClosed(crypto: ShkCrypto, fixture: Fixture) {
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.files.unwrap(fileId, fixture.wrapped) })
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.files.wrap(fileId, crypto.files.newFileKey()) })
    }

    @Test
    fun theAppLockCanBeTurnedOnOnlyWithAScreenLockAndKeysFromARecoveryKey() {
        assertTrue(appWithKeys().app.open().appLock.canTurnOn())

        val noScreenLock = appWithKeys(SoftwareHardwareKeys().apply { screenLock = false })
        assertFalse(noScreenLock.app.open().appLock.canTurnOn())

        val noRecoveryKey = TestApp(temporary.newFolder())
        noRecoveryKey.open().files.wrap(fileId, noRecoveryKey.open().files.newFileKey())
        assertFalse(noRecoveryKey.open().appLock.canTurnOn())
        try {
            noRecoveryKey.open().appLock.beginTurnOn()
            fail("turned the app lock on over a random file-key keyset")
        } catch (_: IllegalStateException) {
            // A random keyset could never come back after the Lock key is lost.
        }
    }

    @Test
    fun turningItOnWrapsFileKeyWithALockKeyAndReplacesTheOldKey() {
        val fixture = appWithKeys()
        val app = fixture.app
        val crypto = app.open()
        assertEquals(AppLockState.OFF, crypto.appLock.state())
        assertEquals(HardwareKeyRef(HardwareKeyKind.UNLOCKED, 1), app.keyOf(KeysetName.FILE_KEY))

        val step = crypto.appLock.beginTurnOn()
        // Before the prompt: the other keysets already sit under a new key, the app lock is still off.
        assertEquals(HardwareKeyRef(HardwareKeyKind.UNLOCKED, 2), app.keyOf(KeysetName.BACKUP))
        assertEquals(HardwareKeyRef(HardwareKeyKind.UNLOCKED, 1), app.keyOf(KeysetName.FILE_KEY))
        assertEquals(AppLockState.OFF, crypto.appLock.state())
        step.finish()

        assertEquals(AppLockState.ON, crypto.appLock.state())
        assertTrue(crypto.appLock.isUnlocked())
        assertEquals(lockKey, app.keyOf(KeysetName.FILE_KEY))
        assertEquals(listOf("backup", "file-key"), app.store.changes)
        assertEquals(
            "the old no-prompt key is deleted last",
            setOf("shk.background.1", "shk.unlocked.2", "shk.lock.1"),
            app.hardware.existing(),
        )
        assertEquals(listOf(HardwareKeyRef(HardwareKeyKind.UNLOCKED, 1)), app.hardware.deleted)
        assertFilesOpen(crypto, fixture)
        assertRecordsWork(crypto, fixture)
        assertEquals(AppLockState.ON, app.open().status().appLock)
    }

    @Test
    fun onAndroid13And14TheBackgroundKeyIsReplaced() {
        val fixture = appWithKeys(SoftwareHardwareKeys(unlockedKeyAllowed = false))
        val app = fixture.app
        val crypto = app.open()

        crypto.appLock.beginTurnOn().finish()

        assertEquals(listOf("record", "backup", "file-key"), app.store.changes)
        assertEquals(HardwareKeyRef(HardwareKeyKind.BACKGROUND, 2), app.keyOf(KeysetName.RECORD))
        assertEquals(HardwareKeyRef(HardwareKeyKind.BACKGROUND, 2), app.keyOf(KeysetName.BACKUP))
        assertEquals(lockKey, app.keyOf(KeysetName.FILE_KEY))
        assertEquals(setOf("shk.background.2", "shk.lock.1"), app.hardware.existing())
        assertRecordsWork(app.open(), fixture)
        assertNotNull(app.open().backups.keyId())
    }

    @Test
    fun whileLockedFilesNeedThePromptAndRecordsAndBackupsGoOn() {
        val fixture = appWithKeys()
        val app = fixture.app
        app.open().appLock.beginTurnOn().finish()

        // The app started again is locked.
        val locked = app.open()
        assertEquals(AppLockState.ON, locked.appLock.state())
        assertFalse(locked.appLock.isUnlocked())
        assertFilesAreClosed(locked, fixture)
        assertRecordsWork(locked, fixture)
        assertNotNull(locked.backups.keyId())
        assertFalse(locked.appLock.canTurnOn())

        // One prompt, one operation, one unlock.
        locked.appLock.beginUnlock().finish()
        assertTrue(locked.appLock.isUnlocked())
        assertFilesOpen(locked, fixture)

        locked.appLock.lock()
        assertFalse(locked.appLock.isUnlocked())
        assertFilesAreClosed(locked, fixture)
        locked.appLock.beginUnlock().cancel()
        assertFilesAreClosed(locked, fixture)

        // When the screen turns off, the file keys are dropped too.
        locked.appLock.beginUnlock().finish()
        locked.onScreenOff()
        assertFilesAreClosed(locked, fixture)
        assertRecordsWork(locked, fixture)
    }

    @Test
    fun ifThePromptIsCancelledTheAppLockStaysOffAndNothingIsLost() {
        val fixture = appWithKeys()
        val app = fixture.app
        val crypto = app.open()

        crypto.appLock.beginTurnOn().cancel()

        assertEquals(AppLockState.OFF, crypto.appLock.state())
        assertFalse("the unused Lock key is deleted", lockKey.alias in app.hardware.existing())
        assertEquals(setOf("shk.background.1", "shk.unlocked.1", "shk.unlocked.2"), app.hardware.existing())
        assertFilesOpen(app.open(), fixture)
        assertRecordsWork(app.open(), fixture)
        assertNotNull(app.open().backups.keyId())

        // The next try moves nothing again: the other keysets are already off the old key.
        val again = app.open()
        again.appLock.beginTurnOn().finish()
        assertEquals(listOf("file-key"), app.store.changes)
        assertEquals(setOf("shk.background.1", "shk.unlocked.2", "shk.lock.1"), app.hardware.existing())
        assertFilesOpen(again, fixture)
    }

    @Test
    fun aStopAtAnyPointLeavesTheAppLockClearlyOnOrClearlyOffAndNoKeyBehind() {
        listOf(false, true).forEach { unlockedKeyAllowed ->
            val changes = if (unlockedKeyAllowed) 2 else 3
            (1..changes).forEach { stopBefore ->
                val fixture = appWithKeys(SoftwareHardwareKeys(unlockedKeyAllowed))
                val app = fixture.app
                val crypto = app.open()
                app.store.stopBeforeChange = stopBefore
                try {
                    crypto.appLock.beginTurnOn().finish()
                    fail("did not stop")
                } catch (_: Stopped) {
                    // The app was killed while the app lock was turned on.
                }

                val later = app.open()
                assertEquals("stop $stopBefore", AppLockState.OFF, later.appLock.state())
                assertFilesOpen(later, fixture)
                assertRecordsWork(later, fixture)
                assertNotNull(later.backups.keyId())
                // Every key that is left is named by a file. Rule 8 deleted the others at start.
                val named = KeysetName.entries.mapNotNull { app.keyOf(it)?.alias }.toSet()
                assertEquals("stop $stopBefore", named, app.hardware.existing())

                later.appLock.beginTurnOn().finish()
                assertEquals(AppLockState.ON, app.open().appLock.state())
                assertRecordsWork(app.open(), fixture)
            }
        }
    }

    @Test
    fun aStopRightAfterFileKeyIsUnderTheLockKeyLeavesTheOldKeyForTheNextStart() {
        // The old no-prompt key is deleted last. If the app stops before that, no file
        // names the old key any more, and the next start deletes it.
        val fixture = appWithKeys()
        val app = fixture.app
        val failing = object : HardwareKeys by app.hardware {
            override fun delete(key: HardwareKeyRef) = throw HardwareKeyNotUsable()
        }
        val vault = KeyVault(TestKeys.water, KeysetFiles(app.folder), failing)
        AppLock(vault).beginTurnOn().finish()
        assertTrue("shk.unlocked.1" in app.hardware.existing())

        val later = app.open()
        assertEquals(AppLockState.ON, later.appLock.state())
        assertEquals(setOf("shk.background.1", "shk.unlocked.2", "shk.lock.1"), app.hardware.existing())
    }

    @Test
    fun turningItOffPutsFileKeyBackUnderAKeyWithoutPromptAndDeletesTheLockKey() {
        val fixture = appWithKeys()
        val app = fixture.app
        app.open().appLock.beginTurnOn().finish()

        val locked = app.open()
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { locked.appLock.turnOff() })
        assertEquals(AppLockState.ON, locked.appLock.state())

        locked.appLock.beginUnlock().finish()
        locked.appLock.turnOff()

        assertEquals(AppLockState.OFF, locked.appLock.state())
        assertEquals(HardwareKeyRef(HardwareKeyKind.UNLOCKED, 2), app.keyOf(KeysetName.FILE_KEY))
        assertFalse(lockKey.alias in app.hardware.existing())
        assertFilesOpen(app.open(), fixture)
        assertTrue(app.open().appLock.canTurnOn())

        // A new Lock key each time the app lock is turned on.
        app.open().appLock.beginTurnOn().finish()
        assertEquals(AppLockState.ON, app.open().appLock.state())
        assertEquals(3, app.hardware.made.count { it.kind == HardwareKeyKind.UNLOCKED })
    }

    @Test
    fun screenLockRemovedWhileLockedTheAppLockIsResetAndTheWordsOpenTheFiles() {
        val fixture = appWithKeys()
        val app = fixture.app
        app.open().appLock.beginTurnOn().finish()

        app.hardware.removeScreenLock()
        val reset = app.open()
        assertEquals(AppLockState.RESET, reset.appLock.state())
        assertEquals(AppLockState.RESET, reset.status().appLock)
        assertFilesAreClosed(reset, fixture)
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { reset.appLock.beginUnlock() })
        // Records, sync and reminders go on.
        assertRecordsWork(reset, fixture)

        // To open the files: enter the 24 words in the app. It derives its keys again.
        assertEquals(KeySetupResult.STORED, reset.setup.storeDerivedKeys(recoveryKey))
        assertEquals(listOf("file-key"), app.store.changes)
        val restored = app.open()
        assertEquals(AppLockState.OFF, restored.appLock.state())
        assertFilesOpen(restored, fixture)
        assertFalse("no screen lock yet", restored.appLock.canTurnOn())

        app.hardware.screenLock = true
        assertTrue(app.open().appLock.canTurnOn())
    }

    @Test
    fun screenLockRemovedWhileUnlockedTheFilesStayOpenAndNoWordsAreNeeded() {
        val fixture = appWithKeys()
        val app = fixture.app
        val crypto = app.open()
        crypto.appLock.beginTurnOn().finish()
        assertTrue(crypto.appLock.isUnlocked())

        app.hardware.removeScreenLock()

        // The app finds the Lock key gone while the keyset is still in memory, and stores it at once.
        assertEquals(AppLockState.OFF, crypto.appLock.state())
        assertEquals(HardwareKeyKind.UNLOCKED, app.keyOf(KeysetName.FILE_KEY)?.kind)
        assertFilesOpen(crypto, fixture)
        assertFilesOpen(app.open(), fixture)
    }

    @Test
    fun theFileKeyKeysetOpensOnlyWithItsOwnLockKey() {
        val fixture = appWithKeys()
        val app = fixture.app
        app.open().appLock.beginTurnOn().finish()
        // Another key under the same alias: the blob is refused, and nothing is opened.
        app.hardware.put(lockKey, ByteArray(32) { 1 })

        val locked = app.open()
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { locked.appLock.beginUnlock().finish() })
        assertFalse(locked.appLock.isUnlocked())
    }

    @Test
    fun afterAnUpdateToAndroid15OnlyBackupMovesWhileTheAppLockIsOn() {
        val fixture = appWithKeys(SoftwareHardwareKeys(unlockedKeyAllowed = false))
        val app = fixture.app
        app.open().appLock.beginTurnOn().finish()

        app.hardware.unlockedKeyAllowed = true
        app.open()

        assertEquals(listOf("backup"), app.store.changes)
        assertEquals(HardwareKeyKind.UNLOCKED, app.keyOf(KeysetName.BACKUP)?.kind)
        assertEquals(HardwareKeyKind.BACKGROUND, app.keyOf(KeysetName.RECORD)?.kind)
        assertEquals(lockKey, app.keyOf(KeysetName.FILE_KEY))
        assertEquals(AppLockState.ON, app.open().appLock.state())
    }

    @Test
    fun theOrderOfCallsForAKeyThatNeedsThePrompt() {
        // The cipher is started before the prompt and gets its associated data only after it.
        val hardware = SoftwareHardwareKeys()
        val key = HardwareKeyRef(HardwareKeyKind.LOCK, 1)
        hardware.make(key)
        val associatedData = AssociatedData.forKeyset(key, KeysetName.FILE_KEY)

        val encrypting = PromptCipher(hardware.startCipher(key, null), encrypts = true)
        assertNotNull(encrypting.cryptoObject.cipher)
        val wrapped = encrypting.finish("a keyset".toByteArray(), associatedData)
        assertEquals("a 12-byte IV, the ciphertext, a 16-byte tag", 12 + 8 + 16, wrapped.size)

        val iv = wrapped.copyOf(12)
        val decrypting = PromptCipher(hardware.startCipher(key, iv), encrypts = false)
        assertEquals("a keyset", String(decrypting.finish(wrapped.copyOfRange(12, wrapped.size), associatedData)))

        // Other associated data, as for a keyset file that was renamed.
        val renamed = PromptCipher(hardware.startCipher(key, iv), encrypts = false)
        try {
            renamed.finish(wrapped.copyOfRange(12, wrapped.size), AssociatedData.forKeyset(key, KeysetName.FILE_KEY_OLD))
            fail("opened under another keyset name")
        } catch (_: HardwareBlobRefused) {
            // Refused.
        }
    }
}
