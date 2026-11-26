package app.shkriuss.feature.notes

import androidx.room3.withReadTransaction
import androidx.room3.withWriteTransaction
import app.shkriuss.core.backup.BackupContent
import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.backup.BackupSink
import app.shkriuss.core.backup.CheckedBackup
import app.shkriuss.core.backup.CheckedFile
import app.shkriuss.core.data.BEFORE_FIRST_CHANGE
import app.shkriuss.core.data.BackupTake
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.data.Record
import app.shkriuss.core.data.RecordDao
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.core.data.isDeleted
import app.shkriuss.core.data.timesAreWithinLimits
import app.shkriuss.feature.notes.data.AttachmentEntity
import app.shkriuss.feature.notes.data.NoteEntity
import app.shkriuss.feature.notes.data.NotesDatabase
import java.io.FileInputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.util.UUID
import kotlinx.coroutines.sync.withLock

/**
 * Notes' records and files in a backup and out of one
 * (docs/apps/notes/spec.md, "Backup contents"). Data version 1: two record
 * types, `note` and `attachment`, named after their tables, and the stream
 * of each file, byte for byte as it is stored, under its file's `id`. A
 * file's key is only in its record, wrapped.
 *
 * Writing ([list]) is one snapshot: one read transaction gives every
 * record of both tables, deleted ones too, and the list of files. The
 * records are read and given to the backup a page at a time
 * ([NoteLimits.NOTES_AT_A_TIME], [NoteLimits.FILES_AT_A_TIME]), in the
 * order of their change numbers, because every text or every file record
 * at once is more than the app's memory holds. The
 * streams of the files of that read that are not deleted and are whole on
 * the phone follow, and the rest are counted as left out. No stream is
 * removed while it runs: it holds `NotesRepository.streams`. The wipe of
 * the deleted records comes before it (`NotesBackups`). A deleted record
 * that still holds content stops it with [NotWipedException], so a backup
 * never holds deleted content.
 *
 * Reading ([restore]) takes the records in one write transaction through
 * `RecordWriter.takeFromBackup`, and stops with [UnreadableBackupException]
 * at the first thing this version cannot read. Then the transaction rolls
 * back and nothing changes. After it, the streams move in, and
 * [afterRestore] runs the sweep of every start: files of deleted notes are
 * marked deleted, deleted records are wiped, and streams that no record
 * needs go (spec, "After a restore").
 */
class NotesBackupContent(
    private val database: NotesDatabase,
    private val repository: NotesRepository,
    clock: Clock,
    ids: IdSource,
    private val afterRestore: suspend () -> Unit = {},
) : BackupContent {
    // takeFromBackup keeps the record fields it is given; the clock and the ID source are never used for it.
    private val notes = RecordWriter(database, database.notes(), clock, ids)
    private val files = RecordWriter(database, database.attachments(), clock, ids)
    private val store = repository.store

    override val dataVersion: Int = DATA_VERSION

    override suspend fun list(into: BackupSink) = repository.streams.withLock {
        // One snapshot: every row is read in one read transaction. A stream never changes, and none is removed while
        // this holds the lock, so each stream below is the file its record describes.
        val shown = database.withReadTransaction {
            val unwiped = database.notes().deletedNotWipedIds().isNotEmpty() || database.attachments().deletedNotWipedIds().isNotEmpty()
            if (unwiped) throw NotWipedException()
            eachRecord(database.notes(), NoteLimits.NOTES_AT_A_TIME) { into.record(NotesBackupCodec.encode(it)) }
            eachRecord(database.attachments(), NoteLimits.FILES_AT_A_TIME) { into.record(NotesBackupCodec.encode(it)) }
            database.attachments().shownSizes()
        }
        val whole = shown.filter { store.isWhole(it.id, it.size) }
        // Not on this phone, or damaged: its record is in the backup, its stream is not (spec, "Writing", point 3).
        into.filesLeftOut((shown.size - whole.size).toLong())
        into.fileBytes(whole.sumOf { StreamLength.of(it.size) })
        whole.forEach { file ->
            FileInputStream(store.stream(file.id)).use { into.file(file.id, StreamLength.of(file.size), it) }
        }
    }

    /**
     * Gives every record that [dao] reads to [action], deleted ones too,
     * in the order of their change numbers. A page of [pageSize] records
     * is given before the next is read, so only a few are in memory.
     */
    private suspend fun <T : Record<T>> eachRecord(dao: RecordDao<T>, pageSize: Int, action: suspend (T) -> Unit) {
        var after = BEFORE_FIRST_CHANGE
        do {
            val page = dao.changedSince(after, pageSize)
            page.forEach { action(it) }
            page.lastOrNull()?.let { after = it.changeNumber }
        } while (page.size == pageSize)
    }

    override suspend fun restore(from: CheckedBackup) {
        if (from.dataVersion != DATA_VERSION) throw UnreadableBackupException("data version ${from.dataVersion}")
        val moveIn = database.withWriteTransaction { takeRecords(from) }
        moveStreamsIn(from, moveIn)
        afterRestore()
    }

    /** What a restore knows of one file of the backup, to check its File entry. */
    private class BackupFile(val size: Long, val wiped: Boolean, val take: BackupTake)

    /**
     * Takes every record of [from] and checks every File entry, inside the
     * restore's transaction. Returns the size of each file whose stream may
     * move in: its record was taken or the same, and it is not deleted
     * after the transaction.
     */
    private suspend fun takeRecords(from: CheckedBackup): Map<String, Long> {
        val noteIds = HashSet<String>()
        val backupFiles = HashMap<String, BackupFile>()
        val notesOfFiles = HashSet<String>()
        from.forEachRecord { record ->
            // takeFromBackup does not check the form of an ID. A file's ID names its stream on the phone.
            if (!NoteRules.isId(record.fields.id)) throw UnreadableBackupException("a record ID that is not a version 4 UUID")
            when (record.type) {
                NoteEntity.TABLE -> {
                    if (!noteIds.add(record.fields.id)) throw UnreadableBackupException("a note ID is there twice")
                    notes.takeFromBackup(NotesBackupCodec.decodeNote(record))
                }
                AttachmentEntity.TABLE -> {
                    if (record.fields.id in backupFiles) throw UnreadableBackupException("a file ID is there twice")
                    val row = NotesBackupCodec.decodeFile(record)
                    backupFiles[record.fields.id] = BackupFile(row.size, NoteRules.isWiped(row), files.takeFromBackup(row))
                    notesOfFiles += row.noteId
                }
                else -> throw UnreadableBackupException("a record of the type ${record.type}")
            }
        }
        // A note is never purged, so every file's note is in the backup, deleted or not.
        if (!noteIds.containsAll(notesOfFiles)) throw UnreadableBackupException("a file whose note is not in the backup")

        val staged = HashSet<String>()
        from.forEachFile { file ->
            val backupFile = backupFiles[file.id] ?: throw UnreadableBackupException("a file entry with no file record")
            if (backupFile.wiped) throw UnreadableBackupException("a file entry of a wiped file")
            if (!staged.add(file.id)) throw UnreadableBackupException("a file entry that is there twice")
            if (file.length != StreamLength.of(backupFile.size)) throw UnreadableBackupException("a file entry of another length")
        }
        return staged.mapNotNull { id ->
            val stored = database.attachments().find(id)
            val mayMove = backupFiles.getValue(id).take != BackupTake.STORED_IS_NEWER && stored != null && !stored.record.isDeleted
            if (mayMove) id to stored.size else null
        }.toMap()
    }

    /**
     * Moves in, by a rename, each stream of [moveIn] that is not whole on
     * the phone: none there, or one of another length, which the staged one
     * replaces (spec, "After a restore", point 1). A rename that fails
     * leaves that file as a stop would: it shows "Not on this phone", and
     * restoring the same backup again brings it.
     */
    private suspend fun moveStreamsIn(from: CheckedBackup, moveIn: Map<String, Long>) {
        if (moveIn.isEmpty()) return
        repository.streams.withLock {
            from.forEachFile { file: CheckedFile ->
                val size = moveIn[file.id] ?: return@forEachFile
                if (store.isWhole(file.id, size)) return@forEachFile
                try {
                    store.moveIn(file.id, file::moveTo)
                } catch (_: IOException) {
                    // As a stop between the transaction and the moves: the record is there, its stream is not yet.
                }
            }
        }
    }

    /** Notes' data version. */
    companion object {
        /** The data version Notes writes and reads. */
        const val DATA_VERSION: Int = 1
    }
}

/**
 * Thrown by [NotesBackupContent.restore] when a backup holds something
 * this version of Notes cannot read: another record type, a content of
 * another length, a title, text or name that is not UTF-8 or breaks its
 * limits, a value or a record time outside its limits, the wiped form
 * included, a record ID that is not a version 4 UUID or is there twice in
 * one type, a file whose note is not in the backup, or a File entry that
 * does not fit its file. It is the third failure of
 * docs/architecture/backup-format.md, "The answers". The message names
 * what was wrong, never what a record holds.
 */
class UnreadableBackupException(reason: String) : Exception("Notes cannot read this backup: $reason")

/**
 * Thrown by [NotesBackupContent.list] when a deleted record still holds
 * its content: the wipe before the backup did not reach it. The backup
 * stops, so it never holds deleted content (docs/apps/notes/spec.md,
 * "Writing", point 1).
 */
class NotWipedException : Exception("A deleted record is not wiped yet")

/**
 * The content of the two record types, as docs/apps/notes/spec.md,
 * "Backup contents", fixes it. Numbers are big-endian. The four record
 * fields travel in the container.
 *
 * `note`, 11 + n + m bytes:
 *
 * | Offset | Size | Content |
 * |---|---|---|
 * | 0 | 1 | `pinned`, `00` or `01` |
 * | 1 | 4 | `fileChanges`, int32 |
 * | 5 | 2 | n, the title's length in bytes, unsigned, 0 to 800 |
 * | 7 | n | The title, in UTF-8 |
 * | 7 + n | 4 | m, the text's length in bytes, 0 to 400,000 |
 * | 11 + n | m | The text, in UTF-8 |
 *
 * `attachment`, 29 + t + n + k bytes:
 *
 * | Offset | Size | Content |
 * |---|---|---|
 * | 0 | 16 | `noteId`, the 16 bytes of the ID |
 * | 16 | 8 | `size`, int64 |
 * | 24 | 1 | t, the type's length, 0 to 127 |
 * | 25 | t | `mimeType`, in ASCII |
 * | 25 + t | 2 | n, the name's length in bytes, 0 to 1,020 |
 * | 27 + t | n | `name`, in UTF-8 |
 * | 27 + t + n | 2 | k, the wrapped key's length, 0 to 1,024 |
 * | 29 + t + n | k | `wrappedKey`, exactly as in the row |
 */
object NotesBackupCodec {
    /** The bytes of a note's content around its title and its text. */
    const val NOTE_FIXED_LENGTH: Int = 11

    /** The bytes of a file's content around its type, its name and its key. */
    const val FILE_FIXED_LENGTH: Int = 29

    /** The most bytes a title takes: 200 code points of 4 bytes. */
    const val MOST_TITLE_BYTES: Int = 4 * NoteLimits.MOST_TITLE

    /** The most bytes a text takes: 100,000 code points of 4 bytes. */
    const val MOST_BODY_BYTES: Int = 4 * NoteLimits.MOST_BODY

    /** The most bytes a file name takes: 255 code points of 4 bytes. */
    const val MOST_NAME_BYTES: Int = 4 * NoteLimits.MOST_NAME

    private const val ID_BYTES = 16
    private const val NOT_PINNED: Byte = 0
    private const val PINNED: Byte = 1

    /** A note as a backup record. */
    fun encode(row: NoteEntity): BackupRecord {
        val title = row.title.toByteArray(Charsets.UTF_8)
        val body = row.body.toByteArray(Charsets.UTF_8)
        return BackupRecord(
            NoteEntity.TABLE,
            row.record,
            ByteBuffer.allocate(NOTE_FIXED_LENGTH + title.size + body.size)
                .put(if (row.pinned) PINNED else NOT_PINNED)
                .putInt(row.fileChanges)
                .putShort(title.size.toShort())
                .put(title)
                .putInt(body.size)
                .put(body)
                .array(),
        )
    }

    /** A file as a backup record. Its wrapped key goes in exactly as it is in the row. */
    fun encode(row: AttachmentEntity): BackupRecord {
        val type = row.mimeType.toByteArray(Charsets.US_ASCII)
        val name = row.name.toByteArray(Charsets.UTF_8)
        val note = UUID.fromString(row.noteId)
        return BackupRecord(
            AttachmentEntity.TABLE,
            row.record,
            ByteBuffer.allocate(FILE_FIXED_LENGTH + type.size + name.size + row.wrappedKey.size)
                .putLong(note.mostSignificantBits)
                .putLong(note.leastSignificantBits)
                .putLong(row.size)
                .put(type.size.toByte())
                .put(type)
                .putShort(name.size.toShort())
                .put(name)
                .putShort(row.wrappedKey.size.toShort())
                .put(row.wrappedKey)
                .array(),
        )
    }

    /**
     * The note a `note` record holds, with the record fields of the backup
     * and change number 0, which `takeFromBackup` replaces. Throws
     * [UnreadableBackupException] for another type, another length, a
     * title or text that is not UTF-8 or breaks its limits, a value outside
     * its limits, or a record time that no record can hold.
     */
    fun decodeNote(record: BackupRecord): NoteEntity {
        if (record.type != NoteEntity.TABLE) throw UnreadableBackupException("a record of the type ${record.type}")
        val bytes = record.content
        val content = Reading(bytes, NoteEntity.TABLE)
        val pinned = when (content.byte()) {
            NOT_PINNED.toInt() -> false
            PINNED.toInt() -> true
            else -> throw outside(NoteEntity.TABLE, "pinned")
        }
        val fileChanges = content.int()
        val title = content.text(content.short(), MOST_TITLE_BYTES, Charsets.UTF_8, "title")
        val body = content.text(content.int(), MOST_BODY_BYTES, Charsets.UTF_8, "text")
        content.end()
        val row = NoteEntity(record.fields, NO_CHANGE_NUMBER, title = title, body = body, pinned = pinned, fileChanges = fileChanges)
        if (!NoteRules.isStored(row)) throw outside(NoteEntity.TABLE, "title, text or fileChanges")
        if (!record.fields.timesAreWithinLimits) throw outside(NoteEntity.TABLE, "createdAt, updatedAt or deletedAt")
        return row
    }

    /**
     * The file an `attachment` record holds, with the record fields of the
     * backup and change number 0, which `takeFromBackup` replaces. Throws
     * [UnreadableBackupException] for another type, another length, a
     * name or type that breaks its limits, a value outside its limits, the
     * wiped form included (`NoteRules.isStored`), or a record time that no
     * record can hold.
     */
    fun decodeFile(record: BackupRecord): AttachmentEntity {
        if (record.type != AttachmentEntity.TABLE) throw UnreadableBackupException("a record of the type ${record.type}")
        val content = Reading(record.content, AttachmentEntity.TABLE)
        val note = ByteBuffer.wrap(content.bytes(ID_BYTES))
        val noteId = UUID(note.long, note.long).toString()
        val size = content.long()
        val type = content.text(content.byte(), NoteLimits.TYPE_LENGTH.last, Charsets.US_ASCII, "mimeType")
        val name = content.text(content.short(), MOST_NAME_BYTES, Charsets.UTF_8, "name")
        val keyLength = content.short()
        if (keyLength > NoteLimits.WRAPPED_KEY_LENGTH.last) throw outside(AttachmentEntity.TABLE, "wrappedKey")
        val wrappedKey = content.bytes(keyLength)
        content.end()
        val row = AttachmentEntity(record.fields, NO_CHANGE_NUMBER, noteId, name, type, size, wrappedKey)
        if (!NoteRules.isStored(row)) throw outside(AttachmentEntity.TABLE, "noteId, name, mimeType, size or wrappedKey")
        if (!record.fields.timesAreWithinLimits) throw outside(AttachmentEntity.TABLE, "createdAt, updatedAt or deletedAt")
        return row
    }

    /**
     * Reads the fields of one content in their order. A content that ends
     * inside a field, or goes on after the last one, has another length
     * than its fields give.
     */
    private class Reading(bytes: ByteArray, private val type: String) {
        private val buffer = ByteBuffer.wrap(bytes)

        fun byte(): Int = take(Byte.SIZE_BYTES) { buffer.get().toInt() and BYTE_MASK }

        fun short(): Int = take(Short.SIZE_BYTES) { buffer.short.toInt() and SHORT_MASK }

        fun int(): Int = take(Int.SIZE_BYTES) { buffer.int }

        fun long(): Long = take(Long.SIZE_BYTES) { buffer.long }

        fun bytes(count: Int): ByteArray = take(count) { ByteArray(count).also { buffer.get(it) } }

        /** A text of [length] bytes, at most [most], in [charset]. One that is not of that charset breaks its limits. */
        fun text(length: Int, most: Int, charset: Charset, what: String): String {
            if (length !in 0..most) throw outside(type, what)
            return decoded(bytes(length), charset) ?: throw outside(type, what)
        }

        /** The content must end here. */
        fun end() {
            if (buffer.hasRemaining()) throw lengthProblem()
        }

        private inline fun <T> take(count: Int, read: () -> T): T {
            if (count < 0 || buffer.remaining() < count) throw lengthProblem()
            return read()
        }

        private fun lengthProblem() = UnreadableBackupException("a $type record of ${buffer.capacity()} bytes, not the length its fields give")
    }

    /** [bytes] in [charset], or null if they are not of it. */
    private fun decoded(bytes: ByteArray, charset: Charset): String? = try {
        charset.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
    } catch (_: CharacterCodingException) {
        null
    }

    private fun outside(type: String, what: String) = UnreadableBackupException("a $type record whose $what is outside its limits")

    private const val BYTE_MASK = 0xff
    private const val SHORT_MASK = 0xffff

    /** `takeFromBackup` ignores the change number that comes with a record. */
    private const val NO_CHANGE_NUMBER = 0L
}
