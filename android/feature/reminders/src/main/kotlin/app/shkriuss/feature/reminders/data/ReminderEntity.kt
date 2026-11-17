package app.shkriuss.feature.reminders.data

import androidx.room3.Dao
import androidx.room3.Embedded
import androidx.room3.Entity
import androidx.room3.Index
import androidx.room3.Query
import app.shkriuss.core.data.Record
import app.shkriuss.core.data.RecordDao
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.data.RecordSql
import kotlinx.coroutines.flow.Flow

/**
 * One reminder: a title, and when it shows (table `reminder` in
 * docs/apps/reminders/spec.md). The date and the time are the phone's
 * clock as the user set them, not a moment in UTC, so a reminder follows
 * a new time zone and summer time by itself. A deleted reminder keeps its
 * title, as every record keeps its content.
 */
@Entity(
    tableName = ReminderEntity.TABLE,
    primaryKeys = ["id"],
    indices = [Index("changeNumber", unique = true)],
)
data class ReminderEntity(
    @Embedded override val record: RecordFields,
    override val changeNumber: Long,
    /** The title: 1 to 200 code points, one line, no space at either end. */
    val title: String,
    /**
     * Once: the date. A repeat: the date it starts from. Days since
     * 1970-01-01 (`LocalDate.toEpochDay`), 0 to 2,932,896.
     */
    val day: Int,
    /** The time, in minutes after midnight, 0 to 1439. */
    val minuteOfDay: Int,
    /** 0 once, 1 every day, 2 every week, 3 every month, 4 every year (`Repeat.code`). */
    val repeat: Int,
    /** Every week: a bit per day, Monday 1 to Sunday 64, 1 to 127. Any other repeat: 0. */
    val weekdays: Int,
) : Record<ReminderEntity> {
    override fun withRecord(record: RecordFields, changeNumber: Long): ReminderEntity =
        copy(record = record, changeNumber = changeNumber)

    /** The table's name, which is also the type name in a backup. */
    companion object {
        /** The table name. */
        const val TABLE: String = "reminder"
    }
}

/** Reads of the reminders. Only `RecordWriter` writes them (docs/architecture/data.md). */
@Dao
interface ReminderDao : RecordDao<ReminderEntity> {
    @Query("SELECT * FROM reminder WHERE id = :id")
    override suspend fun find(id: String): ReminderEntity?

    @Query("SELECT * FROM reminder WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<ReminderEntity>

    /** The reminders that are not deleted. The screens put them in their order. */
    @Query("SELECT * FROM reminder WHERE deletedAt IS NULL")
    fun observeLive(): Flow<List<ReminderEntity>>

    /** The reminders that are not deleted, once. */
    @Query("SELECT * FROM reminder WHERE deletedAt IS NULL")
    suspend fun live(): List<ReminderEntity>

    /** How many reminders are not deleted, for the limit of 500. */
    @Query("SELECT COUNT(*) FROM reminder WHERE deletedAt IS NULL")
    suspend fun liveCount(): Int

    /** Every stored reminder, deleted ones included, for a backup. */
    @Query("SELECT * FROM reminder ORDER BY changeNumber")
    suspend fun all(): List<ReminderEntity>
}
