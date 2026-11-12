package app.shkriuss.core.backup

import app.shkriuss.core.testing.TestIdSource
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Every rule of "What a reader refuses in the body" in backup-format.md
 * (item 7 of "What the tests must cover").
 *
 * Each body here is written by hand and then encrypted with the app's
 * real keys. So the stream is whole and its tags are right, and only the
 * rule of the body can refuse the file.
 */
class BodyRulesTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private lateinit var device: Device

    @Before
    fun aDeviceWithKeys() {
        device = Device(temporary)
        device.giveKeys()
    }

    /** A body, built entry by entry, also in ways the real writer never would. */
    private class Body {
        private val bytes = ByteArrayOutputStream()
        private val out = DataOutputStream(bytes)

        fun manifest(dataVersion: Int = 1) = apply {
            out.writeByte(1)
            out.writeInt(dataVersion)
            out.writeLong(0)
        }

        fun aRecord(number: Long = 1) = apply { RecordEntry.write(out, record(number)) }

        /** A Record entry with any type name, deleted byte and content length, true or not. */
        fun rawRecord(name: ByteArray, nameLength: Int = name.size, deleted: Int = 0, contentLength: Int = 0) = apply {
            out.writeByte(2)
            out.writeByte(nameLength)
            out.write(name)
            out.write(BackupIds.toBytes(TestIdSource.idNumber(1)))
            out.writeLong(0)
            out.writeLong(0)
            out.writeByte(deleted)
            out.writeInt(contentLength)
        }

        fun file(content: ByteArray, lengthGiven: Long = content.size.toLong()) = apply {
            out.writeByte(3)
            out.write(BackupIds.toBytes(TestIdSource.idNumber(1)))
            out.writeLong(lengthGiven)
            out.write(content)
        }

        fun end(records: Long, files: Long) = apply {
            out.writeByte(4)
            out.writeLong(records)
            out.writeLong(files)
        }

        fun byte(value: Int) = apply { out.writeByte(value) }

        fun bytes(): ByteArray = bytes.toByteArray()
    }

    private fun answerOf(body: Body): BackupAnswer = device.answerOf(device.fileWithBody(body.bytes()))

    private fun assertDamaged(why: String, body: Body) = assertEquals(why, BackupAnswer.Damaged, answerOf(body))

    @Test
    fun aBodyWrittenByHandInTheRightFormIsGood() {
        val body = Body().manifest().aRecord(1).aRecord(2).file(pattern(100)).end(records = 2, files = 1)

        val summary = BackupSummary(dataVersion = 1, madeAt = 0, records = 2, files = 1)
        assertEquals(CheckResult.Good(summary), device.check(device.fileWithBody(body.bytes())))
    }

    @Test
    fun theManifestIsFirstAndThereIsOnlyOne() {
        assertDamaged("an empty body", Body())
        assertDamaged("a body that starts with a record", Body().aRecord().end(1, 0))
        assertDamaged("a body that starts with End", Body().end(0, 0))
        assertDamaged("a second Manifest", Body().manifest().manifest().end(0, 0))
        assertDamaged("a Manifest after a record", Body().manifest().aRecord().manifest().end(1, 0))
    }

    @Test
    fun aTagThatIsNotKnownIsNeverGuessedAt() {
        assertDamaged("tag 05", Body().manifest().byte(5).end(0, 0))
        assertDamaged("tag 00", Body().manifest().byte(0).end(0, 0))
        assertDamaged("tag ff", Body().manifest().byte(0xff).end(0, 0))
    }

    @Test
    fun everyRecordComesBeforeTheFirstFile() {
        assertDamaged("a record after a file", Body().manifest().file(pattern(10)).aRecord().end(1, 1))
    }

    @Test
    fun aBodyWithoutEndIsNotAWholeBackup() {
        assertDamaged("only a Manifest", Body().manifest())
        assertDamaged("records and no End", Body().manifest().aRecord(1).aRecord(2))
        assertDamaged("a file and no End", Body().manifest().file(pattern(10)))
    }

    @Test
    fun theCountsInEndMustBeTheEntriesThatWereRead() {
        assertDamaged("one record too many", Body().manifest().aRecord().end(records = 2, files = 0))
        assertDamaged("one record too few", Body().manifest().aRecord(1).aRecord(2).end(records = 1, files = 0))
        assertDamaged("one file too many", Body().manifest().file(pattern(10)).end(records = 0, files = 2))
        assertDamaged("the two counts the other way round", Body().manifest().aRecord().end(records = 0, files = 1))
    }

    @Test
    fun nothingComesAfterEnd() {
        assertDamaged("one byte after End", Body().manifest().end(0, 0).byte(0))
        assertDamaged("a record after End", Body().manifest().end(0, 0).aRecord())
        assertDamaged("End twice", Body().manifest().end(0, 0).end(0, 0))
    }

    @Test
    fun aBodyThatEndsInsideAnEntryIsDamaged() {
        val whole = Body().manifest().aRecord(1).file(pattern(100)).end(1, 1).bytes()

        for (length in 0 until whole.size) {
            val file = device.fileWithBody(whole.copyOf(length))
            assertEquals("the body cut to $length of ${whole.size} bytes", BackupAnswer.Damaged, device.answerOf(file))
        }
    }

    @Test
    fun aDataVersionBelowOneIsRefused() {
        assertDamaged("data version 0", Body().manifest(dataVersion = 0).end(0, 0))
        assertDamaged("a data version above the largest", Body().manifest(dataVersion = Int.MIN_VALUE).end(0, 0))
    }

    @Test
    fun aTypeNameOutsideTheRulesIsRefused() {
        val letters = "a".repeat(65).toByteArray()
        assertDamaged("no type name", Body().manifest().rawRecord(ByteArray(0)).end(1, 0))
        assertDamaged("a type name of 65 letters", Body().manifest().rawRecord(letters).end(1, 0))
        assertDamaged("an upper-case letter", Body().manifest().rawRecord("Note".toByteArray()).end(1, 0))
        assertDamaged("a hyphen", Body().manifest().rawRecord("my-note".toByteArray()).end(1, 0))
        assertDamaged("a byte that is no ASCII letter", Body().manifest().rawRecord(byteArrayOf(0xC3.toByte(), 0xA9.toByte())).end(1, 0))
    }

    @Test
    fun aDeletedByteOtherThanZeroOrOneIsRefused() {
        assertDamaged("deleted byte 02", Body().manifest().rawRecord("note".toByteArray(), deleted = 2).end(1, 0))
    }

    @Test
    fun aLengthOutsideTheLimitsIsRefused() {
        val tooLong = BackupFormat.LARGEST_CONTENT + 1
        assertDamaged("content above 16 MiB", Body().manifest().rawRecord("note".toByteArray(), contentLength = tooLong).end(1, 0))
        assertDamaged("a content length below 0", Body().manifest().rawRecord("note".toByteArray(), contentLength = -1).end(1, 0))
        assertDamaged("a file length below 0", Body().manifest().file(ByteArray(0), lengthGiven = -1).end(0, 1))
        assertDamaged("a file shorter than its length", Body().manifest().file(pattern(5), lengthGiven = 500).end(0, 1))
    }

    @Test
    fun theLargestContentGoesThrough() {
        val largest = BackupRecord("note", record(1).fields, ByteArray(BackupFormat.LARGEST_CONTENT) { it.toByte() })
        device.app.add(largest)

        val file = device.backup()

        val summary = BackupSummary(dataVersion = 1, madeAt = device.clock.nowMillis, records = 1, files = 0)
        assertEquals(CheckResult.Good(summary), device.check(file))
    }
}
