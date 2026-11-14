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
 * One change of the daily goal, with the first day it counts for (table
 * `goal` in docs/apps/water/spec.md). A change counts from the day it was
 * made, so past days keep the goal they had ([GoalRules]).
 */
@Entity(
    tableName = GoalEntity.TABLE,
    primaryKeys = ["id"],
    indices = [Index("changeNumber", unique = true)],
)
data class GoalEntity(
    @Embedded override val record: RecordFields,
    override val changeNumber: Long,
    /** The daily goal, in whole millilitres, 500 to 10,000. */
    val amountMl: Int,
    /** The first day this goal counts for, as [IntakeEntity.day]. */
    val fromDay: Int,
) : Record<GoalEntity> {
    override fun withRecord(record: RecordFields, changeNumber: Long): GoalEntity =
        copy(record = record, changeNumber = changeNumber)

    /** The table's name, which is also the type name in a backup. */
    companion object {
        /** The table name. */
        const val TABLE: String = "goal"
    }
}

/** Reads of the goals. Only `RecordWriter` writes them. */
@Dao
interface GoalDao : RecordDao<GoalEntity> {
    @Query("SELECT * FROM goal WHERE id = :id")
    override suspend fun find(id: String): GoalEntity?

    @Query("SELECT * FROM goal WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<GoalEntity>

    /** The goals that are not deleted. */
    @Query("SELECT * FROM goal WHERE deletedAt IS NULL")
    fun observeLive(): Flow<List<GoalEntity>>

    /** The goals that are not deleted, once. */
    @Query("SELECT * FROM goal WHERE deletedAt IS NULL")
    suspend fun live(): List<GoalEntity>

    /** Every stored goal, deleted ones included, for a backup. */
    @Query("SELECT * FROM goal ORDER BY changeNumber")
    suspend fun all(): List<GoalEntity>
}
