package app.shkriuss.core.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * A phone that is updated from Android 14 to Android 15 ("Android 13 and
 * 14" in crypto-design.md). On 13 and 14 there is no Unlocked key, and the
 * Background key wraps `backup`, `file-key` and `file-key-old` in its
 * place. At the next start on Android 15 the app makes an Unlocked key and
 * moves them under it.
 */
class Android15MoveTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val recoveryKey = TestKeys.vectorRecoveryKey()
    private val recordId = "00112233-4455-4677-8899-aabbccddeeff"
    private val fileId = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"
    private val background = HardwareKeyRef(HardwareKeyKind.BACKGROUND, 1)
    private val unlocked = HardwareKeyRef(HardwareKeyKind.UNLOCKED, 1)

    /** An app on Android 14 with files from before its recovery key, so that `file-key-old` exists too. */
    private class Before(val app: TestApp, val record: ByteArray, val file: ByteArray, val wrapped: ByteArray)

    private fun onAndroid14(): Before {
        val app = TestApp(temporary.newFolder(), SoftwareHardwareKeys(unlockedKeyAllowed = false))
        val first = app.open()
        val key = first.files.newFileKey()
        val file = TestKeys.encryptFile(key, fileId, "a file".toByteArray())
        val wrapped = first.files.wrap(fileId, key)
        assertEquals(KeySetupResult.STORED, first.setup.storeDerivedKeys(recoveryKey))
        val record = app.open().records.seal(recordId, "a record".toByteArray())
        KeysetName.entries.filter { it != KeysetName.RECOVERY }.forEach { assertEquals(background, app.keyOf(it)) }
        assertEquals(setOf("shk.background.1"), app.hardware.existing())
        return Before(app, record, file, wrapped)
    }

    private fun assertEverythingOpens(before: Before) {
        val crypto = before.app.open()
        assertEquals("a record", String(crypto.records.open(recordId, before.record)))
        val key = crypto.files.unwrap(fileId, before.wrapped)
        assertArrayEquals("a file".toByteArray(), TestKeys.decryptFile(key, fileId, before.file))
        assertNotNull(crypto.backups.keyId())
    }

    @Test
    fun atTheNextStartOnAndroid15TheKeysetsMoveUnderAnUnlockedKey() {
        val before = onAndroid14()
        val app = before.app
        app.hardware.unlockedKeyAllowed = true

        app.open()

        assertEquals("record stays under the Background key", background, app.keyOf(KeysetName.RECORD))
        assertEquals(unlocked, app.keyOf(KeysetName.BACKUP))
        assertEquals(unlocked, app.keyOf(KeysetName.FILE_KEY))
        assertEquals(unlocked, app.keyOf(KeysetName.FILE_KEY_OLD))
        assertEquals(setOf("shk.background.1", "shk.unlocked.1"), app.hardware.existing())
        assertEverythingOpens(before)

        // A later start has nothing left to do.
        app.open()
        assertEquals(emptyList<String>(), app.store.changes)
        assertEquals(listOf(background, unlocked), app.hardware.made)
    }

    @Test
    fun onAPhoneThatIsLockedAtThatStartTheMoveWaits() {
        val before = onAndroid14()
        val app = before.app
        app.hardware.unlockedKeyAllowed = true
        app.hardware.phoneLocked = true

        app.open()
        assertEquals("nothing was moved", emptyList<String>(), app.store.changes)
        KeysetName.entries.filter { it != KeysetName.RECOVERY }.forEach { assertEquals(background, app.keyOf(it)) }
        // Sync goes on while the phone is locked.
        assertEquals("a record", String(app.open().records.open(recordId, before.record)))

        app.hardware.phoneLocked = false
        app.open()
        assertEquals(HardwareKeyKind.UNLOCKED, app.keyOf(KeysetName.BACKUP)?.kind)
        assertEquals(HardwareKeyKind.UNLOCKED, app.keyOf(KeysetName.FILE_KEY)?.kind)
        assertEquals("one Unlocked key is left", 1, app.hardware.existing().count { it.startsWith("shk.unlocked.") })
        assertEverythingOpens(before)
    }

    @Test
    fun aStopInTheMiddleOfTheMoveIsFinishedAtTheNextStart() {
        (1..3).forEach { stopBefore ->
            val before = onAndroid14()
            val app = before.app
            app.hardware.unlockedKeyAllowed = true
            val crypto = app.open(start = false)
            app.store.stopBeforeChange = stopBefore
            try {
                crypto.start()
            } catch (_: Stopped) {
                // The app was killed in the middle of the move.
            }
            assertEverythingOpens(before)

            app.open()
            listOf(KeysetName.BACKUP, KeysetName.FILE_KEY, KeysetName.FILE_KEY_OLD).forEach {
                assertEquals("stop $stopBefore", HardwareKeyKind.UNLOCKED, app.keyOf(it)?.kind)
            }
            app.open()
            assertEquals("stop $stopBefore", setOf("shk.background.1", "shk.unlocked.1"), app.hardware.existing())
            assertEverythingOpens(before)
        }
    }

    @Test
    fun onAndroid13And14NothingMoves() {
        val before = onAndroid14()
        before.app.open()
        assertEquals(emptyList<String>(), before.app.store.changes)
        assertEquals(setOf("shk.background.1"), before.app.hardware.existing())
    }
}
