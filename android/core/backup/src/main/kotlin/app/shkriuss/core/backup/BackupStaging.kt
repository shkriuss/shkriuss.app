package app.shkriuss.core.backup

import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive

/**
 * The staging folder of one app. A restore must not change the app before
 * the last byte of the backup was checked, and a backup can be larger than
 * memory. So what is read is first put aside here, inside the app's
 * private storage ("Staging" in docs/architecture/backup-format.md).
 */
internal class BackupStaging(private val folder: File) {
    /** Deletes whatever a stopped restore left behind. */
    fun clear() {
        folder.listFiles()?.forEach { it.deleteRecursively() }
    }

    /** A new, empty folder of its own for one restore. */
    fun newRun(): StagedBackup {
        val run = File(folder, UUID.randomUUID().toString())
        try {
            return staging {
                if (!run.mkdirs()) throw IOException("The staging folder cannot be made")
                StagedBackup(run)
            }
        } catch (failed: BackupStagingException) {
            run.deleteRecursively()
            throw failed
        }
    }
}

/**
 * The staging of one restore, made only when the first record or file of
 * the backup arrives. So a backup that is refused by its header or by its
 * Manifest puts nothing aside and never touches the app's storage.
 */
internal class StagingOnDemand(private val staging: BackupStaging) : BodySink {
    private var run: StagedBackup? = null

    private fun run(): StagedBackup = run ?: staging.newRun().also { run = it }

    override fun record(record: BackupRecord) = run().record(record)

    override suspend fun file(id: String, content: BoundedInput) = run().file(id, content)

    /** Flushes what was put aside to storage and returns it. A backup with nothing in it is put aside as that. */
    fun finish(): StagedBackup = run().also { it.finish() }

    /** Deletes what was put aside, if anything was. */
    fun delete() {
        run?.delete()
    }
}

/** Runs [write], a write into staging. A failure of it is a [BackupStagingException], never a failed read of the backup. */
internal inline fun <T> staging(write: () -> T): T = try {
    write()
} catch (failed: BackupStagingException) {
    throw failed
} catch (failed: IOException) {
    throw BackupStagingException(failed)
}

/**
 * What one restore has put aside: the records in one file, each file
 * stream in a file of its own, and a list of the files. Records are
 * plaintext here, as they are in the database. File streams stay
 * encrypted with their own keys.
 */
internal class StagedBackup(private val folder: File) : BodySink {
    private val recordFile = FileOutputStream(File(folder, RECORDS))
    private val records = DataOutputStream(BufferedOutputStream(recordFile))
    private val listFile = FileOutputStream(File(folder, FILE_LIST))
    private val list = DataOutputStream(BufferedOutputStream(listFile))
    private var files = 0L

    override fun record(record: BackupRecord) = staging { RecordEntry.write(records, record) }

    override suspend fun file(id: String, content: BoundedInput) {
        val output = staging { FileOutputStream(File(folder, FILE_PREFIX + files)) }
        try {
            val buffer = ByteArray(BackupFormat.COPY_BUFFER)
            while (true) {
                coroutineContext.ensureActive()
                // A failure of this read is about the backup, not about staging.
                val read = content.read(buffer, 0, buffer.size)
                if (read < 0) break
                staging { output.write(buffer, 0, read) }
            }
            staging { output.fd.sync() }
        } finally {
            staging { output.close() }
        }
        staging {
            list.write(BackupIds.toBytes(id))
            list.writeLong(content.length)
        }
        files++
    }

    /** Flushes everything to storage. Call it before the app gets the backup. */
    fun finish() = staging {
        records.flush()
        recordFile.fd.sync()
        records.close()
        list.flush()
        listFile.fd.sync()
        list.close()
    }

    /** The backup as the app gets it, once the whole file was checked and [finish] was called. */
    fun checked(summary: BackupSummary): CheckedBackup = StagedChecked(summary, folder)

    /** Deletes the folder of this restore. */
    fun delete() {
        runCatching { records.close() }
        runCatching { list.close() }
        folder.deleteRecursively()
    }

    internal companion object {
        const val RECORDS = "records"
        const val FILE_LIST = "files"
        const val FILE_PREFIX = "file-"
    }
}

/** The checked backup, read back from the staging folder as the app asks for it. */
private class StagedChecked(private val summary: BackupSummary, private val folder: File) : CheckedBackup {
    override val dataVersion: Int get() = summary.dataVersion
    override val madeAt: Long get() = summary.madeAt
    override val recordCount: Long get() = summary.records
    override val fileCount: Long get() = summary.files

    override suspend fun forEachRecord(action: suspend (BackupRecord) -> Unit) {
        FileInputStream(File(folder, StagedBackup.RECORDS)).buffered().use { stream ->
            val input = BodyInput(stream)
            var number = 0L
            while (number++ < summary.records) action(nextRecord(input))
        }
    }

    override suspend fun forEachFile(action: suspend (CheckedFile) -> Unit) {
        DataInputStream(FileInputStream(File(folder, StagedBackup.FILE_LIST)).buffered()).use { list ->
            for (number in 0 until summary.files) {
                val id = ByteArray(BackupIds.BYTES).also { list.readFully(it) }
                val length = list.readLong()
                action(StagedFile(BackupIds.toText(id), length, File(folder, StagedBackup.FILE_PREFIX + number)))
            }
        }
    }

    /** The next record of the staged file. If it cannot be read, staging itself is broken. */
    private fun nextRecord(input: BodyInput): BackupRecord = try {
        if (input.tag() != BackupFormat.TAG_RECORD) damaged()
        RecordEntry.read(input)
    } catch (_: BackupRefused) {
        throw BackupStagingException(IOException("The records put aside cannot be read back"))
    }
}

/** One staged file stream. */
private class StagedFile(override val id: String, override val length: Long, private val file: File) : CheckedFile {
    override fun open(): InputStream = FileInputStream(file)

    override fun moveTo(target: File) {
        Files.move(file.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE)
    }
}
