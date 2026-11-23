package app.shkriuss.feature.tasks.data

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
 * One list that the user made: a name (table `task_list` in
 * docs/apps/tasks/spec.md). Inbox is no row here: it is fixed, so two
 * phones never make two of it. A deleted list keeps its name, as every
 * record keeps its content.
 */
@Entity(
    tableName = TaskListEntity.TABLE,
    primaryKeys = ["id"],
    indices = [Index("changeNumber", unique = true)],
)
data class TaskListEntity(
    @Embedded override val record: RecordFields,
    override val changeNumber: Long,
    /** The name: 1 to 60 code points, one line, no space at either end. */
    val name: String,
) : Record<TaskListEntity> {
    override fun withRecord(record: RecordFields, changeNumber: Long): TaskListEntity =
        copy(record = record, changeNumber = changeNumber)

    /** The table's name, which is also the type name in a backup. */
    companion object {
        /** The table name. */
        const val TABLE: String = "task_list"
    }
}

/** Reads of the lists. Only `RecordWriter` writes them (docs/architecture/data.md). */
@Dao
interface TaskListDao : RecordDao<TaskListEntity> {
    @Query("SELECT * FROM task_list WHERE id = :id")
    override suspend fun find(id: String): TaskListEntity?

    @Query("SELECT * FROM task_list WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<TaskListEntity>

    /** The lists that are not deleted. The screens put them in their order. */
    @Query("SELECT * FROM task_list WHERE deletedAt IS NULL")
    fun observeLive(): Flow<List<TaskListEntity>>

    /** How many lists are not deleted, for the limit of 100. */
    @Query("SELECT COUNT(*) FROM task_list WHERE deletedAt IS NULL")
    suspend fun liveCount(): Int

    /** Every stored list, deleted ones included, for a backup. */
    @Query("SELECT * FROM task_list ORDER BY changeNumber")
    suspend fun all(): List<TaskListEntity>
}
