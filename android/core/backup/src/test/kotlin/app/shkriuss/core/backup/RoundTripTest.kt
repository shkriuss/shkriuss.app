package app.shkriuss.core.backup

import app.shkriuss.core.testing.TestClock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * A backup written on one device is restored on another that has the same
 * recovery key, and the second app then holds what the first one held
 * (item 1 of "What the tests must cover" in backup-format.md).
 */
class RoundTripTest {
    @get:Rule
    val temporary = TemporaryFolder()

    /** Two devices of one user: both have their keys from the same recovery key. */
    private fun twoDevices(): Pair<Device, Device> {
        val first = Device(temporary)
        val second = Device(temporary)
        second.giveKeys(first.giveKeys())
        return first to second
    }

    @Test
    fun anAppWithNothingGoesThroughABackup() {
        val (first, second) = twoDevices()

        val (result, file) = first.write()

        assertEquals(ExportResult.Written(records = 0, files = 0, filesLeftOut = 0), result)
        assertEquals("the smallest backup of backup-format.md", 108, file.size)
        val summary = BackupSummary(dataVersion = 1, madeAt = TestClock.START_MILLIS, records = 0, files = 0)
        assertEquals(RestoreResult.Restored(summary), second.restore(file))
        assertEquals(1, second.app.restores)
        assertEquals(emptyMap<String, String>(), second.app.snapshot())
    }

    @Test
    fun recordsGoThroughWithTheirFieldsAndTheirContent() {
        val (first, second) = twoDevices()
        first.app.add(
            record(1, content = "Milk"),
            record(2, content = "", type = "tag"),
            record(3, content = "Gone", updatedAt = TestClock.START_MILLIS + 9_000, deletedAt = TestClock.START_MILLIS + 9_000),
            record(4, type = "a".repeat(64)),
            BackupRecord("bytes_0", record(5).fields, ByteArray(256) { it.toByte() }),
        )

        val (result, file) = first.write()

        assertEquals(ExportResult.Written(records = 5, files = 0, filesLeftOut = 0), result)
        assertTrue(second.restore(file) is RestoreResult.Restored)
        assertEquals(first.app.snapshot(), second.app.snapshot())
        assertEquals(5, second.app.records.size)
    }

    @Test
    fun filesGoThroughByteForByte() {
        val (first, second) = twoDevices()
        val contents = mapOf(1L to ByteArray(0), 2L to pattern(1_000), 3L to pattern(2_500_000))
        contents.forEach { (number, bytes) ->
            first.app.add(record(number, content = "file record $number", type = "file"))
            first.app.putFile(number, bytes)
        }

        val (result, file) = first.write()

        assertEquals(ExportResult.Written(records = 3, files = 3, filesLeftOut = 0), result)
        val body = MANIFEST + first.app.records.values.sumOf { RECORD + it.type.length + it.content.size } +
            contents.values.sumOf { FILE + it.size } + END
        assertEquals("the file has the length backup-format.md gives", expectedFileSize(body.toLong()), file.size.toLong())
        assertTrue("the backup has more than two segments", file.size > 2 * SEGMENT)

        assertTrue(second.restore(file) is RestoreResult.Restored)
        assertEquals(first.app.snapshot(), second.app.snapshot())
        assertEquals(3, second.app.fileIds().size)
        assertEquals("nothing is left in staging", emptyList<String>(), second.stagingFolder.list().orEmpty().toList())
    }

    @Test
    fun restoringTheSameBackupTwiceChangesNothing() {
        val (first, second) = twoDevices()
        first.app.add(record(1), record(2, type = "file"))
        first.app.putFile(2, pattern(5_000))
        val file = first.backup()

        second.restore(file)
        val afterTheFirst = second.app.snapshot()
        second.restore(file)

        assertEquals(afterTheFirst, second.app.snapshot())
        assertEquals(first.app.snapshot(), second.app.snapshot())
        assertEquals(2, second.app.restores)
    }

    @Test
    fun theCheckSaysWhatABackupHoldsAndChangesNothing() {
        val (first, second) = twoDevices()
        first.app.add(record(1), record(2, type = "file"))
        first.app.putFile(2, pattern(5_000))
        first.clock.advanceBy(60_000)
        val file = first.backup()

        val checked = second.check(file)

        val summary = BackupSummary(dataVersion = 1, madeAt = TestClock.START_MILLIS + 60_000, records = 2, files = 1)
        assertEquals(CheckResult.Good(summary), checked)
        assertEquals("the check never calls the app", 0, second.app.restores)
        assertEquals(emptyMap<String, String>(), second.app.snapshot())
        assertEquals(emptyList<String>(), second.stagingFolder.list().orEmpty().toList())
    }

    @Test
    fun aBackupStartsWithItsPublicHeaderAndThenTheStream() {
        val first = Device(temporary)
        first.giveKeys()

        val file = first.backup()

        val keyId = first.keys.crypto.backups.keyId()
        assertEquals("53484b42414b01${keyId}057761746572", file.copyOfRange(0, 17).toHex())
        assertEquals("the stream of blob kind 3 follows", "53484b010328", file.copyOfRange(17, 23).toHex())
    }

    private companion object {
        const val MANIFEST = 13
        const val RECORD = 39
        const val FILE = 25
        const val END = 17
        const val SEGMENT = 1_048_576

        /** The length of a backup of `water` whose body is [body] bytes long ("Sizes" in backup-format.md). */
        fun expectedFileSize(body: Long): Long {
            val segments = if (body <= 1_048_520) 1 else 1 + (body - 1_048_520 + 1_048_560 - 1) / 1_048_560
            return 17 + 5 + 40 + body + 16 * segments
        }
    }
}
