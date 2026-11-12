package app.shkriuss.core.data.sample

import androidx.room3.ColumnInfo
import androidx.room3.Dao
import androidx.room3.Database
import androidx.room3.Embedded
import androidx.room3.Entity
import androidx.room3.Index
import androidx.room3.Query
import androidx.room3.RoomDatabase
import app.shkriuss.core.data.Record
import app.shkriuss.core.data.RecordDao
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.data.RecordSql

/**
 * A database that exists only in the tests of core/data. It shows how an
 * app's database follows the record conventions, and it carries the
 * example migration ([SampleMigrations]).
 */
@Database(entities = [SampleNote::class], version = 2)
abstract class SampleDatabase : RoomDatabase() {
    /** The notes table. */
    abstract fun notes(): SampleNoteDao
}

/** One note. Version 2 added [pinned] ([SampleMigrations.From1To2]). */
@Entity(
    tableName = "sample_note",
    primaryKeys = ["id"],
    indices = [Index("updatedAt", "id")],
)
data class SampleNote(
    @Embedded override val record: RecordFields,
    val title: String,
    /** Pinned notes are shown first. Added in version 2; old notes are not pinned. */
    @ColumnInfo(defaultValue = "0") val pinned: Boolean,
) : Record<SampleNote> {
    override fun withRecord(record: RecordFields): SampleNote = copy(record = record)
}

/** Reads and writes for [SampleNote]. */
@Dao
interface SampleNoteDao : RecordDao<SampleNote> {
    @Query("SELECT * FROM sample_note WHERE id = :id")
    override suspend fun find(id: String): SampleNote?

    @Query("SELECT * FROM sample_note WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterUpdatedAt: Long, afterId: String, limit: Int): List<SampleNote>

    /** The notes that are not deleted, oldest first. */
    @Query("SELECT * FROM sample_note WHERE deletedAt IS NULL ORDER BY createdAt, id")
    suspend fun live(): List<SampleNote>

    /** Every stored note, deleted ones included. */
    @Query("SELECT * FROM sample_note ORDER BY createdAt, id")
    suspend fun all(): List<SampleNote>
}
