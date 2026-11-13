package app.shkriuss.core.crypto

import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Every answer of "Reading a blob" in crypto-design.md (item 4 of "What
 * the tests must cover"). A reader answers with one of the six, and
 * nothing more detailed.
 */
@RunWith(RobolectricTestRunner::class)
class BlobAnswersTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val recoveryKey = TestKeys.vectorRecoveryKey()
    private val recordId = "00112233-4455-4677-8899-aabbccddeeff"

    private fun appWithKeys(): TestApp = TestApp(temporary.newFolder()).also {
        assertEquals(KeySetupResult.STORED, it.open().setup.storeDerivedKeys(recoveryKey))
    }

    private fun refusal(block: () -> Unit): BlobException {
        try {
            block()
        } catch (refused: BlobException) {
            return refused
        }
        throw AssertionError("the blob was not refused")
    }

    @Test
    fun notOneOfOurs() {
        val crypto = appWithKeys().open()
        val refused = refusal { crypto.records.open(recordId, "PNG and then some bytes that are long enough".toByteArray()) }
        assertEquals(BlobAnswer.NOT_ONE_OF_OURS, refused.answer)
        assertEquals("Not one of ours", refused.message)
    }

    @Test
    fun madeByANewerVersionOfTheApp() {
        val crypto = appWithKeys().open()
        val blob = crypto.records.seal(recordId, ByteArray(8)).also { it[3] = 2 }
        val refused = refusal { crypto.records.open(recordId, blob) }
        assertEquals(BlobAnswer.MADE_BY_A_NEWER_VERSION, refused.answer)
        assertEquals("Made by a newer version of the app", refused.message)
    }

    @Test
    fun wrongKind() {
        val crypto = appWithKeys().open()
        val wrapped = crypto.files.wrap(recordId, crypto.files.newFileKey())
        val refused = refusal { crypto.records.open(recordId, wrapped) }
        assertEquals(BlobAnswer.WRONG_KIND, refused.answer)
        assertEquals("Wrong kind", refused.message)
    }

    @Test
    fun needsAnotherRecoveryKeyAndNamesTheKeyId() {
        val sealed = appWithKeys().open().records.seal(recordId, ByteArray(8))
        val other = TestApp(temporary.newFolder())
        other.open().setup.storeDerivedKeys(RecoveryKey.ofBytes(ByteArray(32) { 0x21 }))

        val refused = refusal { other.open().records.open(recordId, sealed) }
        assertEquals(BlobAnswer.NEEDS_ANOTHER_RECOVERY_KEY, refused.answer)
        assertEquals(recoveryKey.keyId, refused.keyId)
        assertEquals("Needs another recovery key: b19d376f", refused.message)

        val wrapped = appWithKeys().open().let { it.files.wrap(recordId, it.files.newFileKey()) }
        assertEquals(recoveryKey.keyId, refusal { other.open().files.unwrap(recordId, wrapped) }.keyId)
    }

    @Test
    fun needsKeysThisAppDoesNotHaveNow() {
        // An app with no keys from a recovery key.
        val empty = TestApp(temporary.newFolder()).open()
        val refused = refusal { empty.records.seal(recordId, ByteArray(8)) }
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, refused.answer)
        assertEquals("Needs keys this app does not have now", refused.message)
        assertNull(refused.keyId)
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, refusal { empty.backups.keyId() }.answer)
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, refusal { empty.files.unwrap(recordId, ByteArray(60)) }.answer)

        // The hardware key is gone.
        val lost = appWithKeys()
        val sealed = lost.open().records.seal(recordId, ByteArray(8))
        lost.hardware.lose(lost.keyOf(KeysetName.RECORD)!!)
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, refusal { lost.open().records.open(recordId, sealed) }.answer)

        // The app is locked.
        val locked = appWithKeys()
        val wrapped = locked.open().let { it.files.wrap(recordId, it.files.newFileKey()) }
        locked.open().appLock.beginTurnOn(WordsProof()).finish()
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, refusal { locked.open().files.unwrap(recordId, wrapped) }.answer)
    }

    @Test
    fun damagedOrChanged() {
        val crypto = appWithKeys().open()
        val blob = crypto.records.seal(recordId, ByteArray(8)).also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() }
        val refused = refusal { crypto.records.open(recordId, blob) }
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, refused.answer)
        assertEquals("Damaged or changed", refused.message)
        assertNull(refused.keyId)
    }

    @Test
    fun anAnswerCarriesNoCauseAndNothingElse() {
        val crypto = appWithKeys().open()
        val blob = crypto.records.seal(recordId, ByteArray(8)).also { it[20] = (it[20] + 1).toByte() }
        val refused = refusal { crypto.records.open(recordId, blob) }
        assertNull("no cause says what exactly failed", refused.cause)
        assertEquals(0, refused.suppressed.size)
        assertEquals("app.shkriuss.core.crypto.BlobException: Damaged or changed", refused.toString())
    }

    @Test
    fun thereAreExactlySixAnswers() {
        assertEquals(
            listOf(
                "Not one of ours",
                "Made by a newer version of the app",
                "Wrong kind",
                "Needs another recovery key",
                "Needs keys this app does not have now",
                "Damaged or changed",
            ),
            BlobAnswer.entries.map { it.text },
        )
    }

    @Test
    fun aRecordOrFileIdThatIsNotAUuidIsAMistakeOfTheCallerNotADamagedBlob() {
        val crypto = appWithKeys().open()
        listOf("", "not-a-uuid", "00112233445546778899aabbccddeeff", "00112233-4455-4677-8899-aabbccddeefg", "0-0-0-0-0")
            .forEach { wrong ->
                try {
                    crypto.records.seal(wrong, ByteArray(1))
                    fail("took the ID '$wrong'")
                } catch (_: IllegalArgumentException) {
                    // Only the 36-character form.
                }
            }
        // Hex digits in either case name the same record.
        val sealed = crypto.records.seal("00112233-4455-4677-8899-AABBCCDDEEFF", ByteArray(3))
        assertEquals(3, crypto.records.open("00112233-4455-4677-8899-aabbccddeeff", sealed).size)
    }

    @Test
    fun aFailedReadOfTheStorageStaysAFailedRead() {
        // Tink reports every failure while it reads as a damaged stream. A disk
        // that fails is not a damaged file, so the storage's own error comes through.
        val key = FileKey(KeysetCodec.newRandom(KeysetType.STREAMING))
        val blob = TestKeys.encryptFile(key, recordId, TestKeys.pattern(100_000))
        val failure = IOException("the disk failed")
        val failing = object : InputStream() {
            private val whole = ByteArrayInputStream(blob)
            private var left = 50_000

            override fun read(): Int = throw UnsupportedOperationException()

            override fun read(target: ByteArray, offset: Int, length: Int): Int {
                if (left <= 0) throw failure
                return whole.read(target, offset, minOf(length, left)).also { left -= it }
            }
        }
        try {
            key.decryptingStream(recordId, failing).readBytes()
            fail("read past a failed disk")
        } catch (thrown: IOException) {
            assertSame(failure, thrown)
        }
        assertTrue(TestKeys.decryptFile(key, recordId, blob).contentEquals(TestKeys.pattern(100_000)))
    }
}
