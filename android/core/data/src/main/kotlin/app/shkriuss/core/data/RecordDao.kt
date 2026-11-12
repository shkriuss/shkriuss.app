package app.shkriuss.core.data

import androidx.room3.Insert
import androidx.room3.OnConflictStrategy
import androidx.room3.Update

/**
 * The reads and writes that [RecordWriter] needs from a DAO. Each table's
 * DAO extends it and implements [find] and [changedSince] for its table:
 * ```
 * @Dao
 * interface NoteDao : RecordDao<NoteEntity> {
 *     @Query("SELECT * FROM note WHERE id = :id")
 *     override suspend fun find(id: String): NoteEntity?
 *
 *     @Query("SELECT * FROM note WHERE " + RecordSql.CHANGED_SINCE)
 *     override suspend fun changedSince(afterUpdatedAt: Long, afterId: String, limit: Int): List<NoteEntity>
 * }
 * ```
 *
 * A DAO never declares `@Delete`, `@Upsert`, a `DELETE` or `UPDATE` query,
 * or `OnConflictStrategy.REPLACE`, which deletes the old row. All of them
 * would skip the stamping, and the first and last would remove a record
 * for good. Reads may filter out deleted records with
 * `WHERE deletedAt IS NULL`.
 */
interface RecordDao<T : Record<T>> {
    /** Stores [record] as it is, without stamping. Only [RecordWriter] calls it. */
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun rawInsert(record: T)

    /**
     * Replaces the stored row with the same ID by [record] as it is, without
     * stamping. Only [RecordWriter] calls it. Returns the number of rows
     * changed.
     */
    @Update(onConflict = OnConflictStrategy.ABORT)
    suspend fun rawUpdate(record: T): Int

    /** The record with [id], deleted or not, or null if there is none. */
    suspend fun find(id: String): T?

    /**
     * Up to [limit] records that changed after the position
     * ([afterUpdatedAt], [afterId]), deleted ones included, in the order of
     * [RecordSql.CHANGED_SINCE]. Call it through
     * `changedSince(cursor, limit)`.
     */
    suspend fun changedSince(afterUpdatedAt: Long, afterId: String, limit: Int): List<T>
}
