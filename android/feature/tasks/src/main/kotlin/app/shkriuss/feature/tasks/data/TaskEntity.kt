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
 * One task: a title in a list, with a due day, a repeat and a reminder
 * time if the user set them (table `task` in docs/apps/tasks/spec.md).
 * The due day is a local date, with no time zone, so a task stays due on
 * the same date in a new time zone. A deleted task keeps its content, as
 * every record does. `TaskRules.isStored` holds the limits of every
 * column and the rules that join two of them.
 */
@Entity(
    tableName = TaskEntity.TABLE,
    primaryKeys = ["id"],
    indices = [Index("changeNumber", unique = true), Index("listId"), Index("dueDay")],
)
data class TaskEntity(
    @Embedded override val record: RecordFields,
    override val changeNumber: Long,
    /** The `id` of its list, or `""` for Inbox. A list that is deleted or not stored shows the task in Inbox. */
    val listId: String,
    /** The title: 1 to 200 code points, one line, no space at either end. */
    val title: String,
    /** The due day, in days since 1970-01-01 (`LocalDate.toEpochDay`), 0 to 2,932,896, or null for none. */
    val dueDay: Int?,
    /** 0 once, 1 every day, 2 every week, 3 every month, 4 every year (`Repeat.code`). 0 when [dueDay] is null. */
    val repeat: Int,
    /** Every week: a bit per day, Monday 1 to Sunday 64, 1 to 127. Any other repeat: 0. */
    val weekdays: Int,
    /** The day the repeat counts from, 0 to [dueDay]. Null when [repeat] is 0. */
    val repeatFrom: Int?,
    /** The reminder time, in minutes after midnight, 0 to 1439, or null for none. Null when [dueDay] is null. */
    val remindMinute: Int?,
    /** When the task was done, in milliseconds since 1970 UTC, or null while it is open. */
    val doneAt: Long?,
) : Record<TaskEntity> {
    override fun withRecord(record: RecordFields, changeNumber: Long): TaskEntity =
        copy(record = record, changeNumber = changeNumber)

    /** The table's name, which is also the type name in a backup. */
    companion object {
        /** The table name. */
        const val TABLE: String = "task"
    }
}

/** Reads of the tasks. Only `RecordWriter` writes them (docs/architecture/data.md). */
@Dao
interface TaskDao : RecordDao<TaskEntity> {
    @Query("SELECT * FROM task WHERE id = :id")
    override suspend fun find(id: String): TaskEntity?

    @Query("SELECT * FROM task WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<TaskEntity>

    /** The tasks that are not deleted. The screens put them in their order. */
    @Query("SELECT * FROM task WHERE deletedAt IS NULL")
    fun observeLive(): Flow<List<TaskEntity>>

    /** The tasks that are not deleted, once. */
    @Query("SELECT * FROM task WHERE deletedAt IS NULL")
    suspend fun live(): List<TaskEntity>

    /** The tasks of the list [listId] that are not deleted, open and done. Deleting a list deletes them. */
    @Query("SELECT * FROM task WHERE listId = :listId AND deletedAt IS NULL")
    suspend fun liveIn(listId: String): List<TaskEntity>

    /** How many tasks are not deleted, for the limit of 5,000. */
    @Query("SELECT COUNT(*) FROM task WHERE deletedAt IS NULL")
    suspend fun liveCount(): Int

    /** Every stored task, deleted ones included, for a backup. */
    @Query("SELECT * FROM task ORDER BY changeNumber")
    suspend fun all(): List<TaskEntity>
}
