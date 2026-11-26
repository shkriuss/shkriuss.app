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

    /** For each note with a file that is not deleted, how many it has, again after each change of a file. The list shows the number. */
    @Query("SELECT noteId, COUNT(*) AS count FROM attachment WHERE deletedAt IS NULL GROUP BY noteId")
    fun observeShownCounts(): Flow<List<FileCount>>

    /**
     * Up to [limit] names of the files of the notes [noteIds] that are not
     * deleted, each with what puts it in the order of its note: those
     * whose `id` comes after [afterId], in the order of their `id`s. A
     * search reads them page by page, from "" on, for a small group of
     * notes. The group alone sets no limit: a restore can give one note
     * any number of files.
     */
    @Query(
        "SELECT noteId, id, name, createdAt FROM attachment " +
            "WHERE noteId IN (:noteIds) AND deletedAt IS NULL AND id > :afterId ORDER BY id LIMIT :limit",
    )
    suspend fun shownNamesOf(noteIds: List<String>, afterId: String, limit: Int): List<FileName>

    /** The `id` and the size of every file that is not deleted, in the order of the change numbers. A backup finds the streams by them. */
    @Query("SELECT id, size FROM attachment WHERE deletedAt IS NULL ORDER BY changeNumber")
    suspend fun shownSizes(): List<FileSize>

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

    /** The `id`s of the files that are not deleted and whose note is: the sweep marks them deleted (spec, "Removing a file, and the wipe", point 3). */
    @Query(
        "SELECT attachment.id FROM attachment JOIN note ON note.id = attachment.noteId " +
            "WHERE attachment.deletedAt IS NULL AND note.deletedAt IS NOT NULL",
    )
    suspend fun shownIdsOfDeletedNotes(): List<String>

    /** The `id`s of the deleted files that are not in the wiped form yet (spec, "The wiped form"). */
    @Query(
        "SELECT id FROM attachment WHERE deletedAt IS NOT NULL " +
            "AND (name != '' OR mimeType != '' OR size != 0 OR length(wrappedKey) != 0)",
    )
    suspend fun deletedNotWipedIds(): List<String>

    /** The `id` of every file that is not wiped: each one names a stream the phone keeps. */
    @Query(
        "SELECT id FROM attachment WHERE deletedAt IS NULL " +
            "OR name != '' OR mimeType != '' OR size != 0 OR length(wrappedKey) != 0",
    )
    suspend fun unwipedIds(): List<String>

    /**
     * Up to [limit] files that hold a wrapped key, deleted ones that are
     * not wiped too, each with its key and nothing else: those whose `id`
     * comes after [afterId], in the order of their `id`s. The move of the
     * file keys reads them page by page, from "" on.
     */
    @Query("SELECT id, wrappedKey FROM attachment WHERE id > :afterId AND length(wrappedKey) > 0 ORDER BY id LIMIT :limit")
    suspend fun keysAfter(afterId: String, limit: Int): List<KeyOfFile>
}

/** How many files of one note are not deleted. */
data class FileCount(
    /** The `id` of the note. */
    val noteId: String,
    /** The number of its files that are not deleted. */
    val count: Int,
)

/** The name of one file, with what puts it in the order of its note. */
data class FileName(
    /** The `id` of its note. */
    val noteId: String,
    /** The record's `id`. */
    val id: String,
    /** The file's name. */
    val name: String,
    /** When it was added, in milliseconds since 1970 UTC. */
    val createdAt: Long,
)

/** Where a backup finds the stream of one file, and how long it must be. */
data class FileSize(
    /** The record's `id`, which names its stream. */
    val id: String,
    /** Its length in bytes, before encryption. */
    val size: Long,
)

/** The wrapped key of one file. */
class KeyOfFile(
    /** The record's `id`. */
    val id: String,
    /** Its file key, wrapped. */
    val wrappedKey: ByteArray,
)

/** How many files are not deleted, and how many bytes they hold: "12 files, 120 MB of 1 GB". */
data class FileTotals(
    /** The number of files. */
    val count: Int,
    /** Their bytes, before encryption. */
    val bytes: Long,
)
