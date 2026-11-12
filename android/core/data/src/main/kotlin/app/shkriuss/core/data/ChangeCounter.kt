package app.shkriuss.core.data

import androidx.room3.Entity
import androidx.room3.PrimaryKey

/**
 * The last change number handed out in a database (ADR 0027). Every app
 * database lists it among its entities. It is not a record: it is never
 * backed up or synced.
 *
 * The table has at most one row, with [id] 1. [RecordWriter] raises
 * [lastNumber] by one inside each write transaction and gives the new
 * value to the record it writes. SQLite runs one write transaction at a
 * time, so numbers are handed out in the order the writes commit. The
 * counter never goes down, so a number is never used twice, even after
 * deleted records are purged.
 */
@Entity(tableName = ChangeCounter.TABLE)
data class ChangeCounter(
    /** Always 1. */
    @PrimaryKey val id: Int,
    /** The last change number handed out. */
    val lastNumber: Long,
) {
    /** The table name and the SQL [RecordWriter] runs. Not a DAO: the counter is not a record. */
    companion object {
        /** The table name. */
        const val TABLE: String = "change_counter"

        /** Raises the counter by one, and creates its row the first time. */
        internal const val RAISE_SQL: String =
            "INSERT INTO $TABLE (id, lastNumber) VALUES (1, 1) " +
                "ON CONFLICT (id) DO UPDATE SET lastNumber = lastNumber + 1"

        /** Reads the last number handed out. There is no row before the first write. */
        const val READ_SQL: String = "SELECT lastNumber FROM $TABLE WHERE id = 1"
    }
}
