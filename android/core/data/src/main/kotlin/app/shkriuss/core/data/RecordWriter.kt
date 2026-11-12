package app.shkriuss.core.data

import androidx.room3.PooledConnection
import androidx.room3.RoomDatabase
import androidx.room3.executeSQL
import androidx.room3.withWriteTransaction

/**
 * The only way to write records of one table. Every write stamps the
 * [RecordFields] and gives the record a new change number, so no caller
 * sets them by hand:
 *
 * - [create] gives the record a new ID, and sets `createdAt` and
 *   `updatedAt` to now.
 * - [update], [markDeleted] and [restore] move `updatedAt` forward.
 * - Deleting only marks: [markDeleted] sets `deletedAt`, and the row stays.
 * - Every one of them takes the next change number from [ChangeCounter],
 *   in the same write transaction as the write itself.
 *
 * `updatedAt` always moves forward, even when the device's clock was set
 * back: a write sets it to now, or to one millisecond after the record's
 * last `updatedAt` if that is later. The change number does not depend on
 * the clock at all.
 *
 * Each write is one write transaction: it reads the stored record, takes a
 * change number and writes the record back, so two changes to the same
 * record cannot overwrite each other.
 */
class RecordWriter<T : Record<T>>(
    private val database: RoomDatabase,
    private val dao: RecordDao<T>,
    private val clock: Clock,
    private val ids: IdSource,
) {
    /**
     * Stores a new record. [build] gets the new record's fields and change
     * number, and returns the record. Any change it makes to them is
     * ignored.
     */
    suspend fun create(build: (fields: RecordFields, changeNumber: Long) -> T): T = database.withWriteTransaction {
        val now = clock.nowMillis()
        val fields = RecordFields(id = ids.newId(), createdAt = now, updatedAt = now, deletedAt = null)
        val changeNumber = nextChangeNumber()
        val record = build(fields, changeNumber).withRecord(fields, changeNumber)
        dao.rawInsert(record)
        record
    }

    /**
     * Changes the record with [id]. [change] gets the stored record and
     * returns the changed one. Any change it makes to the [RecordFields] or
     * the change number is ignored. Nothing is written if nothing changed.
     *
     * Returns the stored record, or null if there is no record with [id] or
     * it is deleted.
     */
    suspend fun update(id: String, change: (T) -> T): T? = database.withWriteTransaction {
        val current = dao.find(id)
        if (current == null || current.record.isDeleted) return@withWriteTransaction null
        val changed = change(current).withRecord(current.record, current.changeNumber)
        if (changed == current) return@withWriteTransaction current
        val fields = current.record.copy(updatedAt = nextUpdatedAt(current.record))
        write(changed.withRecord(fields, nextChangeNumber()))
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
        write(current.withRecord(current.record.copy(updatedAt = now, deletedAt = now), nextChangeNumber()))
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
        val fields = current.record.copy(updatedAt = nextUpdatedAt(current.record), deletedAt = null)
        write(current.withRecord(fields, nextChangeNumber()))
    }

    private suspend fun write(record: T): T {
        check(dao.rawUpdate(record) == 1) { "The record to write is no longer stored" }
        return record
    }

    private fun nextUpdatedAt(fields: RecordFields): Long = maxOf(clock.nowMillis(), fields.updatedAt + 1)

    /** Raises [ChangeCounter] by one and returns the new number. Call it inside the write transaction. */
    private suspend fun PooledConnection.nextChangeNumber(): Long {
        executeSQL(ChangeCounter.RAISE_SQL)
        return usePrepared(ChangeCounter.READ_SQL) { statement ->
            check(statement.step()) { "The change counter has no row" }
            statement.getLong(0)
        }
    }
}
