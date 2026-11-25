package app.shkriuss.feature.notes.data

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
 * One note: a title and a text with its marks (table `note` in
 * docs/apps/notes/spec.md). Its files are rows of `attachment`. Adding,
 * removing or bringing back one of its files raises [fileChanges] in the
 * same transaction, so the note's `updatedAt` always moves with its
 * files. A deleted note keeps its content until it is wiped (ADR 0042).
 * `NoteRules.isStored` holds the limits of every column.
 */
@Entity(
    tableName = NoteEntity.TABLE,
    primaryKeys = ["id"],
    indices = [Index("changeNumber", unique = true), Index("updatedAt")],
)
data class NoteEntity(
    @Embedded override val record: RecordFields,
    override val changeNumber: Long,
    /** The title: 0 to 200 code points, one line, no space at either end, no control character. */
    val title: String,
    /** The text, with its marks: 0 to 100,000 code points, no control character but `\n` and tab. */
    val body: String,
    /** True if the note is pinned. Stored as 1 or 0. */
    val pinned: Boolean,
    /** How many times a file of the note was added, removed or brought back. After 2,147,483,647 it goes back to 0. */
    val fileChanges: Int,
) : Record<NoteEntity> {
    override fun withRecord(record: RecordFields, changeNumber: Long): NoteEntity =
        copy(record = record, changeNumber = changeNumber)

    /** The table's name, which is also the type name in a backup. */
    companion object {
        /** The table name. */
        const val TABLE: String = "note"
    }
}

/** Reads of the notes. Only `RecordWriter` writes them (docs/architecture/data.md). */
@Dao
interface NoteDao : RecordDao<NoteEntity> {
    @Query("SELECT * FROM note WHERE id = :id")
    override suspend fun find(id: String): NoteEntity?

    @Query("SELECT * FROM note WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<NoteEntity>

    /** The notes that are not deleted. The list puts them in its order. */
    @Query("SELECT * FROM note WHERE deletedAt IS NULL")
    fun observeShown(): Flow<List<NoteEntity>>

    /** The note [id], deleted or not, and again after each change of it. Null while there is none. */
    @Query("SELECT * FROM note WHERE id = :id")
    fun observe(id: String): Flow<NoteEntity?>

    /** How many notes are not deleted, for the limit of 5,000. */
    @Query("SELECT COUNT(*) FROM note WHERE deletedAt IS NULL")
    suspend fun shownCount(): Int

    /** Every note, deleted ones too, for a backup. */
    @Query("SELECT * FROM note")
    suspend fun all(): List<NoteEntity>

    /** The deleted notes that are not in the wiped form yet (docs/apps/notes/spec.md, "The wiped form"). */
    @Query("SELECT * FROM note WHERE deletedAt IS NOT NULL AND (title != '' OR body != '' OR pinned != 0 OR fileChanges != 0)")
    suspend fun deletedNotWiped(): List<NoteEntity>
}
