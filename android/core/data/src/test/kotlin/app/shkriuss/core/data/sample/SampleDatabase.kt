package app.shkriuss.core.data.sample

import androidx.room3.ColumnInfo
import androidx.room3.Dao
import androidx.room3.Database
import androidx.room3.Embedded
import androidx.room3.Entity
import androidx.room3.Index
import androidx.room3.Query
import androidx.room3.RoomDatabase
import app.shkriuss.core.data.ChangeCounter
import app.shkriuss.core.data.Record
import app.shkriuss.core.data.RecordDao
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.data.RecordSql

/**
 * A database that exists only in the tests of core/data. It shows how an
 * app's database follows the record conventions, and it carries the
 * example migration ([SampleMigrations]). It has two record tables, which
 * share one [ChangeCounter].
 */
@Database(entities = [SampleNote::class, SampleTag::class, ChangeCounter::class], version = 2)
abstract class SampleDatabase : RoomDatabase() {
    /** The notes table. */
    abstract fun notes(): SampleNoteDao

    /** The tags table. */
    abstract fun tags(): SampleTagDao
}

/** One note. Version 2 added [pinned] ([SampleMigrations.From1To2]). */
@Entity(
    tableName = "sample_note",
    primaryKeys = ["id"],
    indices = [Index("changeNumber", unique = true)],
)
data class SampleNote(
    @Embedded override val record: RecordFields,
    override val changeNumber: Long,
    val title: String,
    /** Pinned notes are shown first. Added in version 2; old notes are not pinned. */
    @ColumnInfo(defaultValue = "0") val pinned: Boolean,
) : Record<SampleNote> {
    override fun withRecord(record: RecordFields, changeNumber: Long): SampleNote =
        copy(record = record, changeNumber = changeNumber)
}

/** One tag, a second record table. */
@Entity(
    tableName = "sample_tag",
    primaryKeys = ["id"],
    indices = [Index("changeNumber", unique = true)],
)
data class SampleTag(
    @Embedded override val record: RecordFields,
    override val changeNumber: Long,
    val name: String,
) : Record<SampleTag> {
    override fun withRecord(record: RecordFields, changeNumber: Long): SampleTag =
        copy(record = record, changeNumber = changeNumber)
}

/** Reads and writes for [SampleNote]. */
@Dao
interface SampleNoteDao : RecordDao<SampleNote> {
    @Query("SELECT * FROM sample_note WHERE id = :id")
    override suspend fun find(id: String): SampleNote?

    @Query("SELECT * FROM sample_note WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<SampleNote>

    /** The notes that are not deleted, oldest first. */
    @Query("SELECT * FROM sample_note WHERE deletedAt IS NULL ORDER BY createdAt, id")
    suspend fun live(): List<SampleNote>

    /** Every stored note, deleted ones included. */
    @Query("SELECT * FROM sample_note ORDER BY createdAt, id")
    suspend fun all(): List<SampleNote>
}

/** Reads and writes for [SampleTag]. */
@Dao
interface SampleTagDao : RecordDao<SampleTag> {
    @Query("SELECT * FROM sample_tag WHERE id = :id")
    override suspend fun find(id: String): SampleTag?

    @Query("SELECT * FROM sample_tag WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<SampleTag>
}
