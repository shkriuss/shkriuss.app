package app.shkriuss.core.crypto

import app.shkriuss.core.crypto.fixtures.SoftwareHardwareKeys
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * The checks of the recovery words before the app lock is turned on
 * ("The app lock" in crypto-design.md, rule 2): four words of the kept key
 * in a keeper app, all 24 words in an app that does not keep the key.
 */
@RunWith(RobolectricTestRunner::class)
class WordsProofTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val key = TestKeys.vectorRecoveryKey()
    private val words = key.words()
    private val otherKey = RecoveryKey.ofBytes(ByteArray(32) { 0x77 })

    private fun appWithKeys(hardware: SoftwareHardwareKeys = SoftwareHardwareKeys()): TestApp {
        val app = TestApp(temporary.newFolder(), hardware)
        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(key))
        return app
    }

    private fun keeper(): TestApp = appWithKeys().also { app -> app.open().setup.beginKeepRecoveryKey(key)!!.finish() }

    private fun fourOf(source: List<String>, vararg positions: Int): Map<Int, String> =
        positions.associateWith { source[it - 1] }

    @Test
    fun fourWordsOfTheKeptKeyGiveAProof() {
        val app = keeper()
        val crypto = app.open()
        val kept = crypto.setup.beginShowRecoveryKey().finish()

        assertNotNull(crypto.setup.checkFourWords(kept, fourOf(words, 2, 9, 15, 24)))
        val typed = mapOf(2 to " ${words[1].uppercase()} ", 9 to words[8], 15 to words[14], 24 to words[23])
        assertNotNull("case and spaces do not matter", crypto.setup.checkFourWords(kept, typed))

        crypto.appLock.beginTurnOn(crypto.setup.checkFourWords(kept, fourOf(words, 2, 9, 15, 24))!!).finish()
        assertEquals(AppLockState.ON, crypto.appLock.state())
    }

    @Test
    fun oneWrongWordGivesNoProof() {
        val crypto = keeper().open()
        val kept = crypto.setup.beginShowRecoveryKey().finish()
        val answers = fourOf(words, 1, 5, 12, 20) + (12 to words[11 + 1])

        assertNull(crypto.setup.checkFourWords(kept, answers))
        assertNull(crypto.setup.checkFourWords(kept, fourOf(words, 1, 5, 12, 20) + (20 to "")))
    }

    @Test
    fun exactlyFourPositionsFrom1To24AreChecked() {
        val crypto = keeper().open()
        val kept = crypto.setup.beginShowRecoveryKey().finish()
        listOf(
            fourOf(words, 1, 2, 3),
            fourOf(words, 1, 2, 3, 4, 5),
            mapOf(0 to "x") + fourOf(words, 1, 2, 3),
            mapOf(25 to "x") + fourOf(words, 1, 2, 3),
        ).forEach { answers ->
            try {
                crypto.setup.checkFourWords(kept, answers)
                fail("checked ${answers.keys}")
            } catch (_: IllegalArgumentException) {
                // A mistake of the screen that calls, not an answer about the words.
            }
        }
    }

    @Test
    fun allWordsOfThisAppsRecoveryKeyGiveAProofInAnAppThatDoesNotKeepIt() {
        val crypto = appWithKeys().open()
        assertFalse(crypto.setup.keepsRecoveryKey())

        val proof = crypto.setup.checkAllWords(key)
        assertNotNull(proof)
        crypto.appLock.beginTurnOn(proof!!).finish()

        assertEquals(AppLockState.ON, crypto.appLock.state())
        assertFalse("the check never keeps the key", crypto.setup.keepsRecoveryKey())
    }

    @Test
    fun anotherRecoveryKeyGivesNoProof() {
        val crypto = keeper().open()
        assertNull(crypto.setup.checkAllWords(otherKey))
        assertNull(
            "four right words of another key are no proof",
            crypto.setup.checkFourWords(otherKey, fourOf(otherKey.words(), 3, 4, 10, 18)),
        )
    }

    @Test
    fun anAppWithNoRecoveryKeyHasNothingToProve() {
        val crypto = TestApp(temporary.newFolder()).open()
        crypto.files.wrap("0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff", crypto.files.newFileKey())

        assertNull(crypto.setup.checkAllWords(key))
    }

    @Test
    fun theChecksStoreNothingAndKeepTheKeysInMemory() {
        val app = keeper()
        val crypto = app.open()
        crypto.appLock.beginTurnOn(crypto.setup.checkAllWords(key)!!).finish()
        val fileKey = app.vault.fileKeyInMemory()
        assertNotNull(fileKey)
        val before = app.snapshot()
        val kept = crypto.setup.beginShowRecoveryKey().finish()

        crypto.setup.checkAllWords(key)
        crypto.setup.checkAllWords(otherKey)
        crypto.setup.checkFourWords(kept, fourOf(words, 1, 2, 3, 4))

        assertEquals(before, app.snapshot())
        assertSame("the app stays unlocked", fileKey, app.vault.fileKeyInMemory())
        assertFalse(crypto.appLock.isLocked())
    }

    @Test
    fun aRecordKeysetThatCannotBeJudgedStopsTheCheck() {
        val hardware = SoftwareHardwareKeys()
        val app = appWithKeys(hardware)
        val crypto = app.open()

        hardware.keystoreFails = true
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.setup.checkAllWords(key) })
        hardware.keystoreFails = false

        val record = File(app.folder, "record")
        record.writeBytes(record.readBytes().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { app.open().setup.checkAllWords(key) })
    }
}
