package app.shkriuss.core.backup

import app.shkriuss.core.data.RecordFields
import java.io.File
import java.io.InputStream

/**
 * What one app gives to a backup and takes from one. Each data app
 * implements it once. `core/backup` knows no table and no record type of
 * any app, so everything that is the app's own goes through here.
 *
 * The rules are in docs/architecture/backup-format.md, "What an app puts
 * in" and "The restore rule".
 */
interface BackupContent {
    /**
     * The app's own number for what its records and files mean inside a
     * backup. It starts at 1 and only goes up. Raise it whenever an older
     * version of the app could not use what this one writes. A backup
     * with a higher number than this is refused before [restore] is
     * called.
     */
    val dataVersion: Int

    /**
     * Lists everything that goes into a backup: every record, deleted
     * ones too, and then every file whose stored stream is on this
     * device. All of it is one snapshot. A file that is left out is
     * counted with [BackupSink.filesLeftOut].
     */
    suspend fun list(into: BackupSink)

    /**
     * Takes a backup into the app. It is called only with a backup that
     * was read to its end and passed every check.
     *
     * Write the records in one database transaction, through
     * `RecordWriter.takeFromBackup`. After it, move in the files whose
     * records were taken. A [CheckedBackup.dataVersion] below
     * [dataVersion] is an older backup, which the app must still read.
     */
    suspend fun restore(from: CheckedBackup)
}

/** Where an app lists its records and files while a backup is written. */
interface BackupSink {
    /** Adds one record. Every record comes before the first file. */
    suspend fun record(record: BackupRecord)

    /**
     * Adds one file: the stored, encrypted stream of the file whose record
     * has the ID [id], byte for byte. [content] must hold exactly [length]
     * bytes. It is read here and not closed.
     */
    suspend fun file(id: String, length: Long, content: InputStream)

    /**
     * Says that [count] more files are not in this backup, because their
     * stored streams are not on this device. Their records are still
     * listed. The numbers of all calls are added up and given back with
     * the result of writing the backup.
     */
    fun filesLeftOut(count: Long)
}

/**
 * One record on its way into or out of a backup.
 *
 * [type] says which kind of record it is, for example one name per table.
 * It holds the letters `a` to `z`, the digits and `_`, and is at most 64
 * characters long. [content] is the rest of the record, in the app's own
 * encoding, at most 16 MiB. It never holds the change number.
 */
class BackupRecord(val type: String, val fields: RecordFields, val content: ByteArray) {
    /** Names the record and never shows what is in it. */
    override fun toString(): String = "BackupRecord($type ${fields.id})"
}

/**
 * A backup that was read to its end and passed every check. Its records
 * and files are put aside in the app's own storage until [BackupContent.restore]
 * returns.
 */
interface CheckedBackup {
    /** The data version of the app that made the backup. Never above the app's own. */
    val dataVersion: Int

    /** When the backup was made, in milliseconds since 1970-01-01T00:00:00Z. */
    val madeAt: Long

    /** How many records the backup holds. */
    val recordCount: Long

    /** How many files the backup holds. */
    val fileCount: Long

    /** Calls [action] for every record, in the order of the backup. They are read as needed, not held in memory. */
    suspend fun forEachRecord(action: suspend (BackupRecord) -> Unit)

    /** Calls [action] for every file, in the order of the backup. */
    suspend fun forEachFile(action: suspend (CheckedFile) -> Unit)
}

/** One file of a checked backup: its stored, encrypted stream, put aside in the app's own storage. */
interface CheckedFile {
    /** The ID of the file's record. */
    val id: String

    /** The length of the stream in bytes. */
    val length: Long

    /** Opens the stream for reading. The caller closes it. */
    fun open(): InputStream

    /**
     * Moves the stream to [target] in the app's file store, replacing a
     * file that is there. Nothing is copied: the file is renamed. After
     * this the file is no longer part of the checked backup.
     */
    fun moveTo(target: File)
}
