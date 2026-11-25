package app.shkriuss.feature.reminders

import androidx.room3.withReadTransaction
import androidx.room3.withWriteTransaction
import app.shkriuss.core.backup.BackupContent
import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.backup.BackupSink
import app.shkriuss.core.backup.CheckedBackup
import app.shkriuss.core.data.BackupTake
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.core.data.timesAreWithinLimits
import app.shkriuss.feature.reminders.data.ReminderEntity
import app.shkriuss.feature.reminders.data.RemindersDatabase
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/**
 * Reminders' records in a backup and out of one
 * (docs/apps/reminders/spec.md, "Backup contents"). Data version 1: one
 * record type, `reminder`, and no files.
 *
 * Writing lists every reminder, deleted ones too, each once, as one
 * snapshot. Reading takes them in one write transaction through
 * `RecordWriter.takeFromBackup`, and stops with
 * [UnreadableBackupException] at the first thing this version cannot
 * read. Then the transaction rolls back and nothing changes.
 *
 * The phone-only entries are no part of it. After a restore, each
 * reminder it took counts from that moment (spec, "Backup contents",
 * point 3): once the transaction is written, [afterRestore] gets every
 * reminder it took, as it wrote it, and `RemindersRepository.afterRestore`
 * does the rest without a read of the database. A reminder the phone has
 * with the same `updatedAt`, or a later one, is not taken, so it stays as
 * it is.
 */
class RemindersBackupContent(
    private val database: RemindersDatabase,
    clock: Clock,
    ids: IdSource,
    private val afterRestore: suspend (taken: List<ReminderEntity>) -> Unit = {},
) : BackupContent {
    // takeFromBackup keeps the record fields it is given; the clock and the ID source are never used for it.
    private val reminders = RecordWriter(database, database.reminders(), clock, ids)

    override val dataVersion: Int = DATA_VERSION

    override suspend fun list(into: BackupSink) {
        // One snapshot: every row is read in one read transaction, and only then given to the backup.
        val records = database.withReadTransaction { database.reminders().all().map(RemindersBackupCodec::encode) }
        records.forEach { into.record(it) }
        // Reminders stores no files, so it leaves none out. filesLeftOut(0) adds nothing to the count.
        into.filesLeftOut(0)
    }

    override suspend fun restore(from: CheckedBackup) {
        if (from.dataVersion != DATA_VERSION) throw UnreadableBackupException("data version ${from.dataVersion}")
        if (from.fileCount != 0L) throw UnreadableBackupException("the backup holds files")
        val taken = mutableListOf<ReminderEntity>()
        val seen = mutableSetOf<String>()
        database.withWriteTransaction {
            from.forEachRecord { record ->
                // Reminders writes each reminder once. Of two with one ID only one would stay, though the question counted both.
                if (!seen.add(record.fields.id)) throw UnreadableBackupException("a record ID is there twice")
                val reminder = RemindersBackupCodec.decode(record)
                if (reminders.takeFromBackup(reminder) == BackupTake.TAKEN) taken += reminder
            }
            from.forEachFile { throw UnreadableBackupException("the backup holds files") }
        }
        afterRestore(taken)
    }

    /** Reminders' data version. */
    companion object {
        /** The data version Reminders writes and reads. */
        const val DATA_VERSION: Int = 1
    }
}

/**
 * Thrown by [RemindersBackupContent.restore] when a backup holds something
 * this version of Reminders cannot read: another record type, a content
 * of another length, a title that is not UTF-8 or breaks its limits, a
 * value or a record time outside its limits, a record ID that is there
 * twice, or a file. It is the third
 * failure of docs/architecture/backup-format.md, "The answers". The
 * message names what was wrong, never what a record holds.
 */
class UnreadableBackupException(reason: String) : Exception("Reminders cannot read this backup: $reason")

/**
 * The content of a `reminder` record, as docs/apps/reminders/spec.md fixes
 * it: 12 + n bytes, big-endian. The four record fields travel in the
 * container.
 *
 * | Offset | Size | Content |
 * |---|---|---|
 * | 0 | 1 | `repeat`, 0 to 4 |
 * | 1 | 1 | `weekdays`, 0, or 1 to 127 for every week |
 * | 2 | 4 | `day`, int32 |
 * | 6 | 4 | `minuteOfDay`, int32 |
 * | 10 | 2 | n, the title's length in bytes, unsigned, 1 to 800 |
 * | 12 | n | The title, in UTF-8 |
 */
object RemindersBackupCodec {
    /** The length of the content before the title. */
    const val FIXED_LENGTH: Int = 12

    /** A reminder as a backup record. */
    fun encode(row: ReminderEntity): BackupRecord {
        val title = row.title.toByteArray(Charsets.UTF_8)
        return BackupRecord(
            ReminderEntity.TABLE,
            row.record,
            ByteBuffer.allocate(FIXED_LENGTH + title.size)
                .put(row.repeat.toByte())
                .put(row.weekdays.toByte())
                .putInt(row.day)
                .putInt(row.minuteOfDay)
                .putShort(title.size.toShort())
                .put(title)
                .array(),
        )
    }

    /**
     * The row a backup record holds, with the record fields of the backup
     * and change number 0, which `takeFromBackup` replaces. Throws
     * [UnreadableBackupException] for another type, another length, a
     * title or a value outside its limits, days for a repeat other than
     * every week, or a `createdAt`, `updatedAt` or `deletedAt` that no
     * record can hold.
     */
    fun decode(record: BackupRecord): ReminderEntity {
        if (record.type != ReminderEntity.TABLE) throw UnreadableBackupException("a record of the type ${record.type}")
        val content = ByteBuffer.wrap(record.content)
        if (record.content.size < FIXED_LENGTH) throw lengthProblem(record.content.size)
        val repeat = content.get().toInt() and BYTE_MASK
        val weekdays = content.get().toInt() and BYTE_MASK
        val day = content.int
        val minute = content.int
        val titleLength = content.short.toInt() and SHORT_MASK
        if (record.content.size != FIXED_LENGTH + titleLength) throw lengthProblem(record.content.size)
        val title = utf8(record.content.copyOfRange(FIXED_LENGTH, record.content.size))
        val knownRepeat = Repeat.ofCode(repeat)
        within(knownRepeat != null, "repeat")
        within(day in ReminderLimits.DAYS, "day")
        within(minute in 0..ReminderLimits.LAST_MINUTE, "minuteOfDay")
        within(knownRepeat != null && ScheduleRules.weekdaysAllowed(knownRepeat, weekdays), "weekdays")
        within(titleLength in 1..ReminderLimits.MOST_TITLE_BYTES && title != null && TitleRules.isStored(title), "title")
        within(record.fields.timesAreWithinLimits, "createdAt, updatedAt or deletedAt")
        return ReminderEntity(
            record.fields,
            NO_CHANGE_NUMBER,
            title = checkNotNull(title),
            day = day,
            minuteOfDay = minute,
            repeat = repeat,
            weekdays = weekdays,
        )
    }

    /** [bytes] as UTF-8, or null if they are not UTF-8. */
    private fun utf8(bytes: ByteArray): String? = try {
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
    } catch (_: CharacterCodingException) {
        null
    }

    private fun lengthProblem(size: Int) = UnreadableBackupException("a reminder record of $size bytes, not 12 and its title")

    private fun within(ok: Boolean, column: String) {
        if (!ok) throw UnreadableBackupException("a reminder record whose $column is outside its limits")
    }

    private const val BYTE_MASK = 0xff
    private const val SHORT_MASK = 0xffff

    /** `takeFromBackup` ignores the change number that comes with a record. */
    private const val NO_CHANGE_NUMBER = 0L
}
