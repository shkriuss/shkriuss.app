package app.shkriuss.feature.water.data

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
 * One drink: an amount of water with its day and time (table `intake` in
 * docs/apps/water/spec.md). The day and the time are the phone's clock as
 * the user saw it, not a moment in UTC, so a trip to another time zone
 * leaves the history as it was.
 */
@Entity(
    tableName = IntakeEntity.TABLE,
    primaryKeys = ["id"],
    indices = [Index("changeNumber", unique = true), Index("day")],
)
data class IntakeEntity(
    @Embedded override val record: RecordFields,
    override val changeNumber: Long,
    /** The amount, in whole millilitres, 1 to 3,000. */
    val amountMl: Int,
    /** The day of the drink, in days since 1970-01-01 (`LocalDate.toEpochDay`). */
    val day: Int,
    /** The time of the drink, in minutes after midnight, 0 to 1439. */
    val minuteOfDay: Int,
) : Record<IntakeEntity> {
    override fun withRecord(record: RecordFields, changeNumber: Long): IntakeEntity =
        copy(record = record, changeNumber = changeNumber)

    /** The table's name, which is also the type name in a backup. */
    companion object {
        /** The table name. */
        const val TABLE: String = "intake"
    }
}

/** The total of one day, for History. */
data class DayTotal(
    /** The day, as [IntakeEntity.day]. */
    val day: Int,
    /** The sum of the day's drinks that are not deleted, in millilitres. */
    val totalMl: Int,
)

/** Reads of the drinks. Only `RecordWriter` writes them (docs/architecture/data.md). */
@Dao
interface IntakeDao : RecordDao<IntakeEntity> {
    @Query("SELECT * FROM intake WHERE id = :id")
    override suspend fun find(id: String): IntakeEntity?

    @Query("SELECT * FROM intake WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<IntakeEntity>

    /** The drinks of [day] that are not deleted, newest first (spec, table `intake`). */
    @Query(
        "SELECT * FROM intake WHERE deletedAt IS NULL AND day = :day " +
            "ORDER BY minuteOfDay DESC, createdAt DESC, id DESC",
    )
    fun observeDay(day: Int): Flow<List<IntakeEntity>>

    /** The total of every day with a drink that is not deleted. */
    @Query("SELECT day, SUM(amountMl) AS totalMl FROM intake WHERE deletedAt IS NULL GROUP BY day")
    fun observeTotals(): Flow<List<DayTotal>>

    /** The total of [day], in millilitres. 0 for a day with no drink. */
    @Query("SELECT COALESCE(SUM(amountMl), 0) FROM intake WHERE deletedAt IS NULL AND day = :day")
    suspend fun totalOf(day: Int): Int

    /** The latest time among the drinks of [day] that are not deleted, or null if there is none. */
    @Query("SELECT MAX(minuteOfDay) FROM intake WHERE deletedAt IS NULL AND day = :day")
    suspend fun latestMinuteOf(day: Int): Int?

    /** Every stored drink, deleted ones included, for a backup. */
    @Query("SELECT * FROM intake ORDER BY changeNumber")
    suspend fun all(): List<IntakeEntity>
}
