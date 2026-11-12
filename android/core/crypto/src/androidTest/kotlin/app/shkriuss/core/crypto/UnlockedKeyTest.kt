package app.shkriuss.core.crypto

import android.os.Build
import app.shkriuss.core.testing.TestDevice
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test

/**
 * The Unlocked key ("Android 13 and 14" in crypto-design.md). From
 * Android 15 it exists, wraps `backup` and `file-key`, and is refused
 * while the phone is locked. On Android 13 and 14 the app makes none, and
 * the Background key wraps those keysets.
 */
class UnlockedKeyTest {
    private val app = DeviceApp()
    private val hardware = app.hardware
    private val background = HardwareKeyRef(HardwareKeyKind.BACKGROUND, 1)
    private val unlocked = HardwareKeyRef(HardwareKeyKind.UNLOCKED, 1)
    private val plaintext = "a keyset".toByteArray()
    private val associatedData = "associated data".toByteArray()
    private val recoveryKey = TestKeys.vectorRecoveryKey()
    private val recordId = "00112233-4455-4677-8899-aabbccddeeff"
    private val fileId = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"
    private val fromAndroid15 = Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM

    @Before
    fun clean() = app.reset()

    @After
    fun cleanUp() = app.reset()

    @Test
    fun anUnlockedKeyIsAllowedFromAndroid15() {
        assertEquals(fromAndroid15, hardware.unlockedKeyAllowed)
    }

    @Test
    fun onAndroid13And14TheAppMakesNoUnlockedKey() {
        assumeTrue("Android 13 and 14 only", !fromAndroid15)
        val crypto = app.open()

        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(recoveryKey))
        crypto.files.wrap(fileId, crypto.files.newFileKey())

        assertEquals(emptySet<String>(), app.aliasesOf(HardwareKeyKind.UNLOCKED))
        assertEquals(HardwareKeyKind.BACKGROUND, app.keyOf(KeysetName.RECORD)?.kind)
        assertEquals(HardwareKeyKind.BACKGROUND, app.keyOf(KeysetName.BACKUP)?.kind)
        assertEquals(HardwareKeyKind.BACKGROUND, app.keyOf(KeysetName.FILE_KEY)?.kind)
    }

    @Test
    fun fromAndroid15TheUnlockedKeyWrapsBackupAndFileKey() {
        assumeTrue("Android 15 and later only", fromAndroid15)
        val crypto = app.open()

        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(recoveryKey))

        assertEquals(HardwareKeyKind.BACKGROUND, app.keyOf(KeysetName.RECORD)?.kind)
        assertEquals(HardwareKeyKind.UNLOCKED, app.keyOf(KeysetName.BACKUP)?.kind)
        assertEquals(HardwareKeyKind.UNLOCKED, app.keyOf(KeysetName.FILE_KEY)?.kind)
    }

    @Test
    fun withoutAScreenLockTheUnlockedKeyIsMadeAndUsed() {
        assumeTrue("Android 15 and later only", fromAndroid15)

        hardware.make(unlocked)
        val blob = hardware.encrypt(unlocked, plaintext, associatedData)

        assertArrayEquals(plaintext, hardware.decrypt(unlocked, blob, associatedData))
    }

    @Test
    fun whileThePhoneIsLockedTheUnlockedKeyIsRefusedAndTheBackgroundKeyWorks() {
        assumeTrue("Android 15 and later only", fromAndroid15)
        ScreenLock.set()
        hardware.make(unlocked)
        hardware.make(background)
        val underUnlocked = hardware.encrypt(unlocked, plaintext, associatedData)
        val underBackground = hardware.encrypt(background, plaintext, associatedData)

        ScreenLock.lockPhone()

        // The Keystore learns of the lock a moment after the screen does.
        assertTrue("The Unlocked key still works on a locked phone", TestDevice.waitUntil(WAIT_MILLIS) { !opens(underUnlocked) })
        assertThrows(HardwareKeyNotUsable::class.java) { hardware.decrypt(unlocked, underUnlocked, associatedData) }
        assertThrows(HardwareKeyNotUsable::class.java) { hardware.encrypt(unlocked, plaintext, associatedData) }
        // Not usable now, but not gone.
        assertTrue(hardware.exists(unlocked))
        assertArrayEquals(plaintext, hardware.decrypt(background, underBackground, associatedData))

        ScreenLock.unlockPhone()

        assertTrue("The Unlocked key does not work again", TestDevice.waitUntil(WAIT_MILLIS) { opens(underUnlocked) })
    }

    @Test
    fun whileThePhoneIsLockedRecordsWorkAndBackupAndFilesWait() {
        assumeTrue("Android 15 and later only", fromAndroid15)
        ScreenLock.set()
        val crypto = app.open()
        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(recoveryKey))
        val sealed = crypto.records.seal(recordId, "a record".toByteArray())
        val wrapped = crypto.files.wrap(fileId, crypto.files.newFileKey())

        ScreenLock.lockPhone()
        assertTrue(TestDevice.waitUntil(WAIT_MILLIS) { TestKeys.answerOf { app.open().backups.keyId() } != null })
        val whileLocked = app.open()

        assertEquals("a record", String(whileLocked.records.open(recordId, sealed)))
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { whileLocked.backups.keyId() })
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { whileLocked.files.unwrap(fileId, wrapped) })

        ScreenLock.unlockPhone()

        assertTrue(TestDevice.waitUntil(WAIT_MILLIS) { TestKeys.answerOf { whileLocked.backups.keyId() } == null })
        assertEquals(recoveryKey.keyId, whileLocked.backups.keyId())
        whileLocked.files.unwrap(fileId, wrapped)
    }

    @Test
    fun afterAnUpdateToAndroid15TheKeysetsMoveUnderAnUnlockedKey() {
        assumeTrue("Android 15 and later only", fromAndroid15)
        val before = app.openAsOn(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
        assertEquals(KeySetupResult.STORED, before.setup.storeDerivedKeys(recoveryKey))
        val sealed = before.records.seal(recordId, "a record".toByteArray())
        val wrapped = before.files.wrap(fileId, before.files.newFileKey())
        assertEquals(HardwareKeyKind.BACKGROUND, app.keyOf(KeysetName.BACKUP)?.kind)
        assertEquals(HardwareKeyKind.BACKGROUND, app.keyOf(KeysetName.FILE_KEY)?.kind)
        assertEquals(emptySet<String>(), app.aliasesOf(HardwareKeyKind.UNLOCKED))

        val after = app.open()

        assertEquals(HardwareKeyKind.BACKGROUND, app.keyOf(KeysetName.RECORD)?.kind)
        assertEquals(HardwareKeyKind.UNLOCKED, app.keyOf(KeysetName.BACKUP)?.kind)
        assertEquals(HardwareKeyKind.UNLOCKED, app.keyOf(KeysetName.FILE_KEY)?.kind)
        assertEquals("a record", String(after.records.open(recordId, sealed)))
        assertEquals(recoveryKey.keyId, after.backups.keyId())
        after.files.unwrap(fileId, wrapped)
    }

    private fun opens(blob: ByteArray): Boolean = try {
        hardware.decrypt(unlocked, blob, associatedData)
        true
    } catch (_: HardwareKeyFailure) {
        false
    }

    private companion object {
        const val WAIT_MILLIS = 15_000L
    }
}
