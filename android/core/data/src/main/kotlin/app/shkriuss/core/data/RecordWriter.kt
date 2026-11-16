package app.shkriuss.core.data

import androidx.room3.PooledConnection
import androidx.room3.RoomDatabase
import androidx.room3.executeSQL
import androidx.room3.withWriteTransaction

/** What [RecordWriter.takeFromBackup] did with one record of a backup. */
enum class BackupTake {
    /** The record of the backup is stored now: no record with its ID was stored, or the stored one was older. */
    TAKEN,

    /** The stored record has the same `updatedAt`. Nothing was written. */
    SAME,

    /** The stored record has a later `updatedAt`, so it stays. Nothing was written. */
    STORED_IS_NEWER,
}

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
 * - [takeFromBackup] is the one write that keeps the [RecordFields] it is
 *   given: a record of a backup was stamped when it was first written.
 *
 * `updatedAt` always moves forward, even when the device's clock was set
 * back: a write sets it to now, or to one millisecond after the record's
 * last `updatedAt` if that is later. It never passes the last time a
 * record can hold ([RecordTimes]): a record that holds that time keeps
 * it. The change number does not depend on the clock at all.
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

    /**
     * Takes one record of a backup, by the rule "the newest edit wins"
     * (ADR 0008, docs/architecture/backup-format.md). It is the only way
     * a record of a backup is written.
     *
     * [record] keeps its own ID, `createdAt`, `updatedAt` and `deletedAt`:
     * they are the ones it had when the backup was made. Its change
     * number is ignored. It gets a new one here, and only when it is
     * written.
     *
     * - No record with its ID is stored: it is stored.
     * - The stored record has an older `updatedAt`: it is replaced.
     * - The stored record has the same `updatedAt`, or a later one:
     *   nothing is written.
     *
     * So restoring the same backup twice writes nothing the second time,
     * and a record that was changed or deleted after the backup stays as
     * it is. A deleted record is taken like any other.
     *
     * A record whose `createdAt`, `updatedAt` or `deletedAt` is not a
     * time a record can hold ([RecordTimes]) is refused with
     * [IllegalArgumentException], and nothing is written. An app checks
     * the records of a backup first ([timesAreWithinLimits]) and gives
     * its own answer. Thrown inside the app's write transaction, it rolls
     * the whole restore back.
     *
     * This is the function for backups. It is not the function for sync,
     * where the same `updatedAt` must end the same on every device.
     */
    suspend fun takeFromBackup(record: T): BackupTake = database.withWriteTransaction {
        require(record.record.timesAreWithinLimits) { "A record's times are from 0 to ${RecordTimes.LAST_MILLIS}" }
        val stored = dao.find(record.record.id)
        when {
            stored == null -> {
                dao.rawInsert(record.withRecord(record.record, nextChangeNumber()))
                BackupTake.TAKEN
            }
            stored.record.updatedAt < record.record.updatedAt -> {
                write(record.withRecord(record.record, nextChangeNumber()))
                BackupTake.TAKEN
            }
            stored.record.updatedAt == record.record.updatedAt -> BackupTake.SAME
            else -> BackupTake.STORED_IS_NEWER
        }
    }

    private suspend fun write(record: T): T {
        check(dao.rawUpdate(record) == 1) { "The record to write is no longer stored" }
        return record
    }

    /**
     * The `updatedAt` of the next write to a record: now, or one
     * millisecond after its last `updatedAt` if that is later. It never
     * moves back, and it stops at the last time a record can hold, so
     * the sum cannot pass the end of a 64-bit number.
     */
    private fun nextUpdatedAt(fields: RecordFields): Long {
        val last = fields.updatedAt
        if (last >= RecordTimes.LAST_MILLIS) return last
        return maxOf(clock.nowMillis(), last + 1).coerceAtMost(RecordTimes.LAST_MILLIS)
    }

    /** Raises [ChangeCounter] by one and returns the new number. Call it inside the write transaction. */
    private suspend fun PooledConnection.nextChangeNumber(): Long {
        executeSQL(ChangeCounter.RAISE_SQL)
        return usePrepared(ChangeCounter.READ_SQL) { statement ->
            check(statement.step()) { "The change counter has no row" }
            statement.getLong(0)
        }
    }
}
