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
 * One file attached to a note (table `attachment` in
 * docs/apps/notes/spec.md). Its bytes are its stream, a file of their own
 * named by the record's `id`, encrypted with the file's own key; the row
 * holds that key, wrapped by `core/crypto` (blob kind 4). A file is added
 * or removed, never edited, so its key and its stream never change. A
 * deleted file keeps its content until it is wiped (ADR 0042): then its
 * name, type, size and key are cleared and its stream is removed.
 * `NoteRules.isStored` holds the limits of every column.
 *
 * [wrappedKey] is an array, so [equals] and [hashCode] compare its bytes:
 * `RecordWriter` writes nothing for a change that leaves a row equal.
 */
@Entity(
    tableName = AttachmentEntity.TABLE,
    primaryKeys = ["id"],
    indices = [Index("changeNumber", unique = true), Index("noteId")],
)
data class AttachmentEntity(
    @Embedded override val record: RecordFields,
    override val changeNumber: Long,
    /** The `id` of its note: 36 characters, lower case, a version 4 UUID. A wipe keeps it. */
    val noteId: String,
    /** The file's name, as the picker gave it: 1 to 255 code points, one line, no space at either end, no control character. */
    val name: String,
    /** Its type, as the picker gave it, such as `image/jpeg`: 3 to 127 characters, type `/` subtype. */
    val mimeType: String,
    /** Its length in bytes, before encryption: 0 to 25,000,000. */
    val size: Long,
    /** Its file key, wrapped: 50 to 1,024 bytes, starting with `53 48 4B 01 04`. */
    val wrappedKey: ByteArray,
) : Record<AttachmentEntity> {
    override fun withRecord(record: RecordFields, changeNumber: Long): AttachmentEntity =
        copy(record = record, changeNumber = changeNumber)

    override fun equals(other: Any?): Boolean =
        other is AttachmentEntity &&
            record == other.record &&
            changeNumber == other.changeNumber &&
            noteId == other.noteId &&
            name == other.name &&
            mimeType == other.mimeType &&
            size == other.size &&
            wrappedKey.contentEquals(other.wrappedKey)

    override fun hashCode(): Int {
        var hash = record.hashCode()
        hash = 31 * hash + changeNumber.hashCode()
        hash = 31 * hash + noteId.hashCode()
        hash = 31 * hash + name.hashCode()
        hash = 31 * hash + mimeType.hashCode()
        hash = 31 * hash + size.hashCode()
        return 31 * hash + wrappedKey.contentHashCode()
    }

    /** The table's name, which is also the type name in a backup. */
    companion object {
        /** The table name. */
        const val TABLE: String = "attachment"
    }
}

/** Reads of the files. Only `RecordWriter` writes them (docs/architecture/data.md). */
@Dao
interface AttachmentDao : RecordDao<AttachmentEntity> {
    @Query("SELECT * FROM attachment WHERE id = :id")
    override suspend fun find(id: String): AttachmentEntity?

    @Query("SELECT * FROM attachment WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<AttachmentEntity>

    /** The files that are not deleted, of every note. The list and its search read their names and counts. */
    @Query("SELECT * FROM attachment WHERE deletedAt IS NULL")
    fun observeShown(): Flow<List<AttachmentEntity>>

    /** The files of the note [noteId] that are not deleted. The note puts them in its order. */
    @Query("SELECT * FROM attachment WHERE noteId = :noteId AND deletedAt IS NULL")
    fun observeShownOf(noteId: String): Flow<List<AttachmentEntity>>

    /** The files of the note [noteId] that are not deleted, once. Deleting the note deletes them. */
    @Query("SELECT * FROM attachment WHERE noteId = :noteId AND deletedAt IS NULL")
    suspend fun shownOf(noteId: String): List<AttachmentEntity>

    /**
     * How many files of the note [noteId] are not wiped: shown, or removed
     * while their Undo may still bring them back. A note with one is not
     * empty when it closes.
     */
    @Query(
        "SELECT COUNT(*) FROM attachment WHERE noteId = :noteId AND (deletedAt IS NULL " +
            "OR name != '' OR mimeType != '' OR size != 0 OR length(wrappedKey) != 0)",
    )
    suspend fun unwipedCountOf(noteId: String): Int

    /** How many files of the note [noteId] are not deleted, for the limit of 20. */
    @Query("SELECT COUNT(*) FROM attachment WHERE noteId = :noteId AND deletedAt IS NULL")
    suspend fun shownCountOf(noteId: String): Int

    /** The bytes of all files that are not deleted, for the limit of 1 GB. */
    @Query("SELECT COALESCE(SUM(size), 0) FROM attachment WHERE deletedAt IS NULL")
    suspend fun shownBytes(): Long

    /** How many files are not deleted, and their bytes, again after each change, for Settings. */
    @Query("SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM attachment WHERE deletedAt IS NULL")
    fun observeTotals(): Flow<FileTotals>

    /** The files that are not deleted and whose note is: the sweep marks them deleted (spec, "Removing a file, and the wipe", point 3). */
    @Query(
        "SELECT attachment.* FROM attachment JOIN note ON note.id = attachment.noteId " +
            "WHERE attachment.deletedAt IS NULL AND note.deletedAt IS NOT NULL",
    )
    suspend fun shownOfDeletedNotes(): List<AttachmentEntity>

    /** The deleted files that are not in the wiped form yet (spec, "The wiped form"). */
    @Query(
        "SELECT * FROM attachment WHERE deletedAt IS NOT NULL " +
            "AND (name != '' OR mimeType != '' OR size != 0 OR length(wrappedKey) != 0)",
    )
    suspend fun deletedNotWiped(): List<AttachmentEntity>

    /** The `id` of every file that is not wiped: each one names a stream the phone keeps. */
    @Query(
        "SELECT id FROM attachment WHERE deletedAt IS NULL " +
            "OR name != '' OR mimeType != '' OR size != 0 OR length(wrappedKey) != 0",
    )
    suspend fun unwipedIds(): List<String>

    /** The files that hold a wrapped key, deleted ones that are not wiped too, for the move of the file keys. */
    @Query("SELECT * FROM attachment WHERE length(wrappedKey) > 0")
    suspend fun withKeys(): List<AttachmentEntity>
}

/** How many files are not deleted, and how many bytes they hold: "12 files, 120 MB of 1 GB". */
data class FileTotals(
    /** The number of files. */
    val count: Int,
    /** Their bytes, before encryption. */
    val bytes: Long,
)
