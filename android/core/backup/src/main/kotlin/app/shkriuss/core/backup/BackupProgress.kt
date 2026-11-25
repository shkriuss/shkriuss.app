package app.shkriuss.core.backup

import java.io.FilterInputStream
import java.io.InputStream

/**
 * How far a backup, its check or a restore has come, for a progress bar:
 * [done] bytes of [total], or of a total that is not known (null). A
 * screen shows a circle while the total is not known.
 *
 * - While a backup is written, the bytes are those of the files the app
 *   lists, out of the total the app gave first ([BackupSink.fileBytes]).
 *   The records come before the files and are not counted.
 * - While a backup is checked or restored, the bytes are those of the
 *   document read so far, out of the document's length when its provider
 *   tells it. A restore then still writes the records and moves the files
 *   in, with all bytes read.
 *
 * It holds two numbers and nothing of what the backup holds.
 */
data class BackupProgress(val done: Long, val total: Long?) {
    /** [done] as a part of [total], from 0 to 1, or null when the total is not known or is 0. */
    val fraction: Float?
        get() = total?.takeIf { it > 0 }?.let { (done.toDouble() / it).coerceIn(0.0, 1.0).toFloat() }
}

/**
 * The document of a check or a restore, counting the bytes read from it
 * and telling [progress] after each read. [total] is the document's
 * length, or null if its provider does not tell it.
 */
internal class CountingInput(
    input: InputStream,
    private val total: Long?,
    private val progress: (BackupProgress) -> Unit,
) : FilterInputStream(input) {
    private var done = 0L

    override fun read(): Int = super.read().also { if (it >= 0) counted(1) }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
        super.read(buffer, offset, length).also { if (it > 0) counted(it.toLong()) }

    override fun skip(count: Long): Long = super.skip(count).also { if (it > 0) counted(it) }

    private fun counted(bytes: Long) {
        done += bytes
        progress(BackupProgress(done, total))
    }
}
