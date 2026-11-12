package app.shkriuss.core.backup

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
 */
internal class BackupWriter(private val out: DataOutputStream) : BackupSink {
    /** How many records were written. */
    var records = 0L
        private set

    /** How many files were written. */
    var files = 0L
        private set

    /** How many files the app said it left out. Never written into the backup. */
    var filesLeftOut = 0L
        private set

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
        }
        check(content.read() < 0) { "A file is longer than the length given for it" }
    }
}
