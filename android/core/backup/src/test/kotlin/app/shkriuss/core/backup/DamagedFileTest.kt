package app.shkriuss.core.backup

import app.shkriuss.core.crypto.KeyId
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * A file that is cut short, and a file with one changed byte, are never
 * restored (items 2 and 3 of "What the tests must cover" in
 * backup-format.md, and its table "What a changed or cut file does").
 *
 * For every file here, [Device.answerOf] also makes sure that a check
 * gives the same answer as a restore, that the app's code is not called,
 * that the app is as it was, and that nothing is left in staging.
 */
class DamagedFileTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private lateinit var device: Device

    /** A backup with two records and one file, in one segment. */
    private lateinit var small: ByteArray

    @Before
    fun writeABackup() {
        device = Device(temporary)
        device.giveKeys()
        device.app.add(record(1), record(2, type = "file"))
        device.app.putFile(2, pattern(300))
        small = device.backup()
        // The same device restores it below, so the app starts with what the backup holds.
    }

    @Test
    fun aFileCutAtAnyLengthIsRefused() {
        for (length in 0 until small.size) {
            val expected = if (length < MAGIC_LENGTH) BackupAnswer.NotABackup else BackupAnswer.Damaged
            assertEquals("cut to $length of ${small.size} bytes", expected, device.answerOf(small.copyOf(length)))
        }
    }

    @Test
    fun aLongFileCutInTheHeaderBetweenSegmentsAndNearItsEndIsRefused() {
        device.app.add(record(3, type = "file"))
        device.app.putFile(3, pattern(2_500_000))
        val long = device.backup()
        val endOfTheFirstSegment = HEADER_LENGTH + BLOB_HEADER_LENGTH + SEGMENT

        assertEquals(BackupAnswer.Damaged, device.answerOf(long.copyOf(10)))
        assertEquals("no segment says it is the last", BackupAnswer.Damaged, device.answerOf(long.copyOf(endOfTheFirstSegment)))
        assertEquals(BackupAnswer.Damaged, device.answerOf(long.copyOf(endOfTheFirstSegment + SEGMENT)))
        assertEquals("cut by the last tag and one byte", BackupAnswer.Damaged, device.answerOf(long.copyOf(long.size - 17)))
        assertEquals(BackupAnswer.Damaged, device.answerOf(long.copyOf(long.size - 1)))
    }

    @Test
    fun oneChangedByteAnywhereIsRefusedWithTheAnswerOfItsPartOfTheFile() {
        for (index in small.indices) {
            val changed = small.copyOf().also { it[index] = (it[index].toInt() xor 0x01).toByte() }
            assertEquals("byte $index changed", expectedAnswer(index, changed), device.answerOf(changed))
        }
    }

    /** What backup-format.md says for a file whose byte [index] has its lowest bit turned. */
    private fun expectedAnswer(index: Int, changed: ByteArray): BackupAnswer = when (index) {
        in 0 until MAGIC_LENGTH -> BackupAnswer.NotABackup
        // 01 becomes 00, which no version is.
        VERSION_AT -> BackupAnswer.Damaged
        in KEY_ID_AT until NAME_LENGTH_AT -> BackupAnswer.OtherRecoveryKey(keyIdOf(changed))
        // The name is one letter shorter: "wate".
        NAME_LENGTH_AT -> BackupAnswer.OtherApp("wate")
        // "water" with one letter changed: "vater", "w`ter", "wauer", "watdr", "wates".
        NAME_AT + 1 -> BackupAnswer.Damaged
        in NAME_AT until HEADER_LENGTH -> BackupAnswer.OtherApp(String(changed, NAME_AT, 5, Charsets.US_ASCII))
        else -> BackupAnswer.Damaged
    }

    private fun keyIdOf(file: ByteArray): KeyId =
        KeyId((KEY_ID_AT until NAME_LENGTH_AT).fold(0) { number, at -> (number shl 8) or (file[at].toInt() and 0xff) })

    @Test
    fun aHigherVersionByteIsANewerVersionAndNotDamage() {
        val changed = small.copyOf().also { it[VERSION_AT] = 2 }

        assertEquals(BackupAnswer.NewerVersion, device.answerOf(changed))
    }

    @Test
    fun bytesAddedAtTheEndAreRefused() {
        assertEquals(BackupAnswer.Damaged, device.answerOf(small + 0))
        assertEquals(BackupAnswer.Damaged, device.answerOf(small + small))
    }

    @Test
    fun theHeaderOfOneBackupOnTheStreamOfAnotherIsRefused() {
        val other = Device(temporary)
        other.giveKeys()
        val fromOther = other.backup()
        // Both headers are 17 bytes and name the app water. Only the key ID differs.
        val mixed = small.copyOfRange(0, HEADER_LENGTH) + fromOther.copyOfRange(HEADER_LENGTH, fromOther.size)

        assertEquals(BackupAnswer.Damaged, device.answerOf(mixed))
    }

    @Test
    fun theWholeFileIsStillGoodAfterAllOfThis() {
        // The file itself was never changed: every test above worked on a copy.
        assertEquals(RestoreResult.Restored(BackupSummary(1, device.clock.nowMillis, records = 2, files = 1)), device.restore(small))
    }

    private companion object {
        const val MAGIC_LENGTH = 6
        const val VERSION_AT = 6
        const val KEY_ID_AT = 7
        const val NAME_LENGTH_AT = 11
        const val NAME_AT = 12

        /** The backup header of the app `water`. */
        const val HEADER_LENGTH = 17
        const val BLOB_HEADER_LENGTH = 5
        const val SEGMENT = 1_048_576
    }
}
