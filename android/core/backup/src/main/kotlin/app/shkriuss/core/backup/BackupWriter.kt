package app.shkriuss.core.backup

import app.shkriuss.core.data.isDeleted
import java.io.DataOutputStream
import java.io.InputStream
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive

/**
 * Writes the body of a backup into the encrypted stream: the Manifest,
 * then what the app lists, then End. It is the [BackupSink] the app lists
 * into, so it also counts what goes in and what the app left out.
 *
 * What the format does not allow is a mistake of the calling code and
 * stops the backup at once.
 *
 * [progress] is told the bytes of the files written so far, out of the
 * total the app gave with [fileBytes], after each piece of a file.
 */
internal class BackupWriter(private val out: DataOutputStream, private val progress: (BackupProgress) -> Unit = {}) : BackupSink {
    /** How many records were written. */
    var records = 0L
        private set

    /** How many files were written. */
    var files = 0L
        private set

    /** How many files the app said it left out. Never written into the backup. */
    var filesLeftOut = 0L
        private set

    private val counts = RecordCounts()

    /** The total the app gave for its files, or null. */
    private var fileTotal: Long? = null

    /** The bytes of files written so far. */
    private var fileDone = 0L

    /** For each type name, how many of the records written are not deleted. Never written into the backup. */
    val notDeleted: Map<String, Long> get() = counts.notDeleted()

    /** Writes the first entry. */
    fun manifest(dataVersion: Int, madeAt: Long) {
        require(dataVersion >= 1) { "A data version is 1 or higher" }
        out.writeByte(BackupFormat.TAG_MANIFEST)
        out.writeInt(dataVersion)
        out.writeLong(madeAt)
    }

    override suspend fun record(record: BackupRecord) {
        check(files == 0L) { "Every record is listed before the first file" }
        RecordEntry.write(out, record)
        records++
        counts.count(record)
    }

    override suspend fun file(id: String, length: Long, content: InputStream) {
        require(length >= 0) { "The length of a file is 0 or more" }
        val idBytes = BackupIds.toBytes(id)
        out.writeByte(BackupFormat.TAG_FILE)
        out.write(idBytes)
        out.writeLong(length)
        copyExactly(content, length)
        files++
    }

    override fun fileBytes(total: Long) {
        require(total >= 0) { "The bytes of the files are 0 or more" }
        check(files == 0L && fileTotal == null) { "The bytes of the files are given once, before the first file" }
        fileTotal = total
        progress(BackupProgress(0, total))
    }

    override fun filesLeftOut(count: Long) {
        require(count >= 0) { "The number of files left out is 0 or more" }
        filesLeftOut += count
    }

    /** Writes the last entry, with the counts that prove the backup is whole. */
    fun end() {
        out.writeByte(BackupFormat.TAG_END)
        out.writeLong(records)
        out.writeLong(files)
    }

    /** Copies [length] bytes, a buffer at a time, so a file of any size is never held in memory. */
    private suspend fun copyExactly(content: InputStream, length: Long) {
        val buffer = ByteArray(BackupFormat.COPY_BUFFER)
        var left = length
        while (left > 0) {
            coroutineContext.ensureActive()
            val read = content.read(buffer, 0, minOf(left, buffer.size.toLong()).toInt())
            check(read >= 0) { "A file is shorter than the length given for it" }
            out.write(buffer, 0, read)
            left -= read
            fileDone += read
            progress(BackupProgress(fileDone, fileTotal))
        }
        check(content.read() < 0) { "A file is longer than the length given for it" }
    }
}

/**
 * Counts, for each type name, the records that are not deleted, while a
 * backup is written or read. The deleted flag and the type name are in the
 * container, so the content of a record is never looked at.
 */
internal class RecordCounts {
    private val byType = sortedMapOf<String, Long>()

    /** Counts [record], unless it is deleted. */
    fun count(record: BackupRecord) {
        if (!record.fields.isDeleted) byType.merge(record.type, 1L, Long::plus)
    }

    /** The counts so far. A type whose records are all deleted is not in it. */
    fun notDeleted(): Map<String, Long> = byType.toMap()
}
