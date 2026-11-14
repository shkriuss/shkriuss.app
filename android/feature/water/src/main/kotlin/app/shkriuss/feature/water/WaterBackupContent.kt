package app.shkriuss.feature.water

import androidx.room3.withReadTransaction
import androidx.room3.withWriteTransaction
import app.shkriuss.core.backup.BackupContent
import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.backup.BackupSink
import app.shkriuss.core.backup.CheckedBackup
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.data.Record
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.feature.water.data.GoalEntity
import app.shkriuss.feature.water.data.IntakeEntity
import app.shkriuss.feature.water.data.SettingsEntity
import app.shkriuss.feature.water.data.WaterDatabase
import java.nio.ByteBuffer

/**
 * Water's records in a backup and out of one (docs/apps/water/spec.md,
 * "Backup contents"). Data version 1: three record types, no files.
 *
 * Writing lists every record of the three tables, deleted ones too, each
 * once, as one snapshot. Reading takes them in one write transaction
 * through `RecordWriter.takeFromBackup`, and stops with
 * [UnreadableBackupException] at the first thing this version cannot
 * read. Then the transaction rolls back and nothing changes.
 *
 * Step 2.5 builds the screens that use it, with `Backups` of
 * `core/backup`, and calls `notify.sync()` after a restore.
 */
class WaterBackupContent(private val database: WaterDatabase, clock: Clock, ids: IdSource) : BackupContent {
    // takeFromBackup keeps the record fields it is given; the clock and the ID source are never used for it.
    private val drinks = RecordWriter(database, database.intake(), clock, ids)
    private val goals = RecordWriter(database, database.goals(), clock, ids)
    private val settings = RecordWriter(database, database.settings(), clock, ids)

    override val dataVersion: Int = DATA_VERSION

    override suspend fun list(into: BackupSink) {
        // One snapshot: every row is read in one read transaction, and only then given to the backup.
        val records = database.withReadTransaction {
            database.intake().all().map(WaterBackupCodec::encode) +
                database.goals().all().map(WaterBackupCodec::encode) +
                database.settings().all().map(WaterBackupCodec::encode)
        }
        records.forEach { into.record(it) }
        // Water stores no files, so it leaves none out. filesLeftOut(0) adds nothing to the count.
        into.filesLeftOut(0)
    }

    override suspend fun restore(from: CheckedBackup) {
        if (from.dataVersion != DATA_VERSION) throw UnreadableBackupException("data version ${from.dataVersion}")
        if (from.fileCount != 0L) throw UnreadableBackupException("the backup holds files")
        database.withWriteTransaction {
            from.forEachRecord { record ->
                when (val decoded = WaterBackupCodec.decode(record)) {
                    is IntakeEntity -> drinks.takeFromBackup(decoded)
                    is GoalEntity -> goals.takeFromBackup(decoded)
                    is SettingsEntity -> settings.takeFromBackup(decoded)
                    else -> error("decode gives only the three record types")
                }
            }
            from.forEachFile { throw UnreadableBackupException("the backup holds files") }
        }
    }

    /** Water's data version. */
    companion object {
        /** The data version Water writes and reads. */
        const val DATA_VERSION: Int = 1
    }
}

/**
 * Thrown by [WaterBackupContent.restore] when a backup holds something this
 * version of Water cannot read: another record type, a content of another
 * length, a value outside its limits, or a file. It is the third failure of
 * docs/architecture/backup-format.md, "The answers". The message names
 * what was wrong, never what a record holds.
 */
class UnreadableBackupException(reason: String) : Exception("Water cannot read this backup: $reason")

/**
 * The content of each record type, as docs/apps/water/spec.md fixes it.
 * The four record fields travel in the container. Every number is
 * big-endian, an int32 is a signed 32-bit number, and a flag or a unit is
 * one byte.
 */
object WaterBackupCodec {
    /** Length of the content of `intake`: amount, day, minute. */
    const val INTAKE_LENGTH: Int = 12

    /** Length of the content of `goal`: amount, first day. */
    const val GOAL_LENGTH: Int = 8

    /** Length of the content of `settings`. */
    const val SETTINGS_LENGTH: Int = 26

    /** A drink as a backup record. */
    fun encode(row: IntakeEntity): BackupRecord = BackupRecord(
        IntakeEntity.TABLE,
        row.record,
        ByteBuffer.allocate(INTAKE_LENGTH).putInt(row.amountMl).putInt(row.day).putInt(row.minuteOfDay).array(),
    )

    /** A goal as a backup record. */
    fun encode(row: GoalEntity): BackupRecord = BackupRecord(
        GoalEntity.TABLE,
        row.record,
        ByteBuffer.allocate(GOAL_LENGTH).putInt(row.amountMl).putInt(row.fromDay).array(),
    )

    /** A settings record as a backup record. */
    fun encode(row: SettingsEntity): BackupRecord = BackupRecord(
        SettingsEntity.TABLE,
        row.record,
        ByteBuffer.allocate(SETTINGS_LENGTH)
            .put(row.unit.toByte())
            .putInt(row.cup1Ml)
            .putInt(row.cup2Ml)
            .putInt(row.cup3Ml)
            .put(if (row.remindersOn) 1 else 0)
            .putInt(row.intervalMinutes)
            .putInt(row.fromMinute)
            .putInt(row.untilMinute)
            .array(),
    )

    /**
     * The row a backup record holds, with the record fields of the backup
     * and change number 0, which `takeFromBackup` replaces. Throws
     * [UnreadableBackupException] for another type, another length or a
     * value outside its limits.
     */
    fun decode(record: BackupRecord): Record<*> = when (record.type) {
        IntakeEntity.TABLE -> decodeIntake(record.fields, contentOf(record, INTAKE_LENGTH))
        GoalEntity.TABLE -> decodeGoal(record.fields, contentOf(record, GOAL_LENGTH))
        SettingsEntity.TABLE -> decodeSettings(record.fields, contentOf(record, SETTINGS_LENGTH))
        else -> throw UnreadableBackupException("a record of the type ${record.type}")
    }

    private fun contentOf(record: BackupRecord, length: Int): ByteBuffer {
        if (record.content.size != length) {
            throw UnreadableBackupException("a ${record.type} record of ${record.content.size} bytes, not $length")
        }
        return ByteBuffer.wrap(record.content)
    }

    private fun decodeIntake(fields: RecordFields, content: ByteBuffer): IntakeEntity {
        val amount = content.int
        val day = content.int
        val minute = content.int
        within(amount in Amounts.DRINK_ML, "intake", "amountMl")
        within(minute in 0..SettingsRules.LAST_MINUTE, "intake", "minuteOfDay")
        return IntakeEntity(fields, NO_CHANGE_NUMBER, amountMl = amount, day = day, minuteOfDay = minute)
    }

    private fun decodeGoal(fields: RecordFields, content: ByteBuffer): GoalEntity {
        val amount = content.int
        val fromDay = content.int
        within(amount in Amounts.GOAL_ML, "goal", "amountMl")
        return GoalEntity(fields, NO_CHANGE_NUMBER, amountMl = amount, fromDay = fromDay)
    }

    private fun decodeSettings(fields: RecordFields, content: ByteBuffer): SettingsEntity {
        val unit = content.get().toInt()
        val cups = List(3) { content.int }
        val reminders = content.get().toInt()
        val interval = content.int
        val from = content.int
        val until = content.int
        within(WaterUnit.ofCode(unit) != null, "settings", "unit")
        cups.forEachIndexed { index, cup -> within(cup in Amounts.DRINK_ML, "settings", "cup${index + 1}Ml") }
        within(reminders == 0 || reminders == 1, "settings", "remindersOn")
        within(interval in SettingsRules.INTERVALS, "settings", "intervalMinutes")
        within(from in 0..SettingsRules.LATEST_FROM, "settings", "fromMinute")
        within(SettingsRules.hoursAllowed(from, until), "settings", "untilMinute")
        return SettingsEntity(
            fields, NO_CHANGE_NUMBER,
            unit = unit, cup1Ml = cups[0], cup2Ml = cups[1], cup3Ml = cups[2],
            remindersOn = reminders == 1, intervalMinutes = interval, fromMinute = from, untilMinute = until,
        )
    }

    private fun within(ok: Boolean, type: String, column: String) {
        if (!ok) throw UnreadableBackupException("a $type record whose $column is outside its limits")
    }

    /** `takeFromBackup` ignores the change number that comes with a record. */
    private const val NO_CHANGE_NUMBER = 0L
}
