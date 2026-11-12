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
 *     override suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<NoteEntity>
 * }
 * ```
 *
 * A DAO only reads. It never declares `@Insert`, `@Update`, `@Delete`,
 * `@Upsert`, or an `INSERT`, `UPDATE`, `DELETE` or `REPLACE` query. All of
 * them would skip the stamping and the change number, and some would
 * remove a record for good. Only this interface declares the two writes,
 * and only [RecordWriter] calls them. `checkDaoRules` fails the build
 * otherwise. The one exception is one query marked [PurgesDeletedRecords].
 * Reads may filter out deleted records with `WHERE deletedAt IS NULL`.
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
     * Up to [limit] records whose change number is above
     * [afterChangeNumber], deleted ones included, lowest change number
     * first ([RecordSql.CHANGED_SINCE]). To read every change, start at
     * [BEFORE_FIRST_CHANGE] and continue from the change number of the last
     * record of each page.
     */
    suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<T>
}
