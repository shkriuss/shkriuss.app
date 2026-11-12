package app.shkriuss.core.data

import androidx.room3.RoomDatabase
import androidx.room3.withWriteTransaction

/**
 * The only way to write records of one table. Every write stamps the
 * [RecordFields], so no caller sets them by hand:
 *
 * - [create] gives the record a new ID, and sets `createdAt` and
 *   `updatedAt` to now.
 * - [update], [markDeleted] and [restore] move `updatedAt` forward.
 * - Deleting only marks: [markDeleted] sets `deletedAt`, and the row stays.
 *
 * `updatedAt` always moves forward, even when the device's clock was set
 * back: a write sets it to now, or to one millisecond after the record's
 * last `updatedAt` if that is later.
 *
 * Each change reads the stored record and writes it back in one write
 * transaction, so two changes to the same record cannot overwrite each
 * other.
 */
class RecordWriter<T : Record<T>>(
    private val database: RoomDatabase,
    private val dao: RecordDao<T>,
    private val clock: Clock,
    private val ids: IdSource,
) {
    /**
     * Stores a new record. [build] gets the new record's fields and returns
     * the record. Any change it makes to those fields is ignored.
     */
    suspend fun create(build: (RecordFields) -> T): T {
        val now = clock.nowMillis()
        val fields = RecordFields(id = ids.newId(), createdAt = now, updatedAt = now, deletedAt = null)
        val record = build(fields).withRecord(fields)
        dao.rawInsert(record)
        return record
    }

    /**
     * Changes the record with [id]. [change] gets the stored record and
     * returns the changed one. Any change it makes to the [RecordFields] is
     * ignored. Nothing is written if nothing changed.
     *
     * Returns the stored record, or null if there is no record with [id] or
     * it is deleted.
     */
    suspend fun update(id: String, change: (T) -> T): T? = database.withWriteTransaction {
        val current = dao.find(id)
        if (current == null || current.record.isDeleted) return@withWriteTransaction null
        val changed = change(current).withRecord(current.record)
        if (changed == current) return@withWriteTransaction current
        write(changed.withRecord(current.record.copy(updatedAt = nextUpdatedAt(current.record))))
    }

    /**
     * Marks the record with [id] as deleted. The row stays, with
     * `deletedAt` set, so the deletion can reach other devices later.
     *
     * Returns the deleted record, or null if there is no record with [id]
     * or it was already deleted.
     */
    suspend fun markDeleted(id: String): T? = database.withWriteTransaction {
        val current = dao.find(id)
        if (current == null || current.record.isDeleted) return@withWriteTransaction null
        val now = nextUpdatedAt(current.record)
        write(current.withRecord(current.record.copy(updatedAt = now, deletedAt = now)))
    }

    /**
     * Brings back the deleted record with [id], for example to undo a
     * deletion.
     *
     * Returns the restored record, or null if there is no record with [id]
     * or it is not deleted.
     */
    suspend fun restore(id: String): T? = database.withWriteTransaction {
        val current = dao.find(id)
        if (current == null || !current.record.isDeleted) return@withWriteTransaction null
        write(current.withRecord(current.record.copy(updatedAt = nextUpdatedAt(current.record), deletedAt = null)))
    }

    private suspend fun write(record: T): T {
        check(dao.rawUpdate(record) == 1) { "The record to write is no longer stored" }
        return record
    }

    private fun nextUpdatedAt(fields: RecordFields): Long = maxOf(clock.nowMillis(), fields.updatedAt + 1)
}
