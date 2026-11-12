package app.shkriuss.core.crypto

import android.os.Build
import app.shkriuss.core.testing.TestDevice
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The table "When things change" in crypto-design.md, for the screen
 * lock: it is set, changed, removed and set again, and after each step
 * every hardware key is there or gone as the table says.
 *
 * The keys that need no prompt are also used after each step. Using a key
 * that needs the prompt is in [SystemPromptTest].
 */
class ScreenLockChangesTest {
    private val app = DeviceApp()
    private val hardware = app.hardware
    private val plaintext = "a keyset".toByteArray()
    private val associatedData = "associated data".toByteArray()

    private val background = HardwareKeyRef(HardwareKeyKind.BACKGROUND, 1)
    private val unlocked = HardwareKeyRef(HardwareKeyKind.UNLOCKED, 1)
    private val lock = HardwareKeyRef(HardwareKeyKind.LOCK, 1)
    private val recoveryGuard = HardwareKeyRef(HardwareKeyKind.RECOVERY_GUARD, 1)

    /** The keys that need no prompt. An Unlocked key exists from Android 15 only. */
    private val withoutPrompt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
        listOf(background, unlocked)
    } else {
        listOf(background)
    }
    private val withPrompt = listOf(lock, recoveryGuard)

    @Before
    fun clean() = app.reset()

    @After
    fun cleanUp() = app.reset()

    @Test
    fun eachKeyIsThereOrGoneAsTheTableSays() {
        // No screen lock yet. The keys that need no prompt are made.
        withoutPrompt.forEach { hardware.make(it) }
        val blobs = withoutPrompt.associateWith { hardware.encrypt(it, plaintext, associatedData) }

        // The screen lock is set. The keys that need the prompt can now be made.
        ScreenLock.set()
        assertTrue(hardware.hasScreenLock())
        withPrompt.forEach { hardware.make(it) }
        assertAllAreThere(withoutPrompt + withPrompt)
        assertAllOpen(blobs)

        // The screen lock is changed: every key stays.
        ScreenLock.change()
        assertAllAreThere(withoutPrompt + withPrompt)
        assertAllOpen(blobs)
        withPrompt.forEach { hardware.startCipher(it, null) }

        // The screen lock is removed: the keys that need the prompt are deleted, the others stay.
        ScreenLock.remove()
        assertFalse(hardware.hasScreenLock())
        withPrompt.forEach { key ->
            assertTrue("${key.alias} is still there", TestDevice.waitUntil(WAIT_MILLIS) { !hardware.exists(key) })
            assertFalse(key.alias in hardware.aliases())
            assertThrows(HardwareKeyGone::class.java) { hardware.startCipher(key, null) }
        }
        assertAllAreThere(withoutPrompt)
        assertAllOpen(blobs)

        // The screen lock is set again: the deleted keys do not come back, and new ones can be made.
        ScreenLock.set()
        withPrompt.forEach { assertFalse(hardware.exists(it)) }
        assertAllAreThere(withoutPrompt)
        assertAllOpen(blobs)
        val newKeys = withPrompt.map { HardwareKeyRef(it.kind, 2) }
        newKeys.forEach { hardware.make(it) }
        assertAllAreThere(newKeys)
    }

    private fun assertAllAreThere(keys: List<HardwareKeyRef>) {
        keys.forEach { assertTrue("${it.alias} is gone", hardware.exists(it)) }
        assertEquals(keys.map { it.alias }.toSet(), hardware.aliases().intersect(keys.map { it.alias }.toSet()))
    }

    private fun assertAllOpen(blobs: Map<HardwareKeyRef, ByteArray>) {
        blobs.forEach { (key, blob) -> assertArrayEquals(key.alias, plaintext, hardware.decrypt(key, blob, associatedData)) }
    }

    private companion object {
        const val WAIT_MILLIS = 10_000L
    }
}
