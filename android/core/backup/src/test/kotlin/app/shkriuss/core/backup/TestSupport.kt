package app.shkriuss.core.backup

import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.rules.TemporaryFolder

/** The app name of every test, as in the vectors of crypto-design.md. */
internal val WATER: AppName = AppName.of("water")

/** Bytes to lower-case hexadecimal text. */
internal fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

/** Hexadecimal text to bytes. Spaces and line breaks are ignored. */
internal fun hex(text: String): ByteArray {
    val digits = text.filterNot { it.isWhitespace() }
    return ByteArray(digits.length / 2) { digits.substring(2 * it, 2 * it + 2).toInt(16).toByte() }
}

/** SHA-256 as hex. It is a checksum here, to compare what went in with what came out. */
internal fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).toHex()

/** Bytes with a pattern that does not repeat at any block size the code uses: byte number i is i mod 251. */
internal fun pattern(size: Int): ByteArray = ByteArray(size) { (it % 251).toByte() }

/** A document that fails with [failure] once [good] bytes of it were read. */
internal class FailingInput(file: ByteArray, private val good: Int, private val failure: IOException) : InputStream() {
    private val bytes = ByteArrayInputStream(file)
    private var read = 0

    override fun read(): Int {
        if (read >= good) throw failure
        read++
        return bytes.read()
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (read >= good) throw failure
        val count = bytes.read(buffer, offset, minOf(length, good - read))
        if (count > 0) read += count
        return count
    }
}

/** A record for a test. Record number [number] has the ID that [TestIdSource] gives that number. */
internal fun record(
    number: Long,
    content: String = "content $number",
    type: String = "note",
    updatedAt: Long = TestClock.START_MILLIS + number,
    deletedAt: Long? = null,
): BackupRecord = BackupRecord(
    type,
    RecordFields(TestIdSource.idNumber(number), TestClock.START_MILLIS, updatedAt, deletedAt),
    content.toByteArray(),
)

/**
 * A small app for the tests. Its records are in memory and its file
 * streams are files in [fileStore], named by file ID. It restores by the
 * rule of backup-format.md: the newest edit wins, and a file comes in only
 * with its record.
 */
internal class FakeApp(private val fileStore: File, override val dataVersion: Int = 1) : BackupContent {
    /** The records, by ID, in the order they were added. */
    val records = LinkedHashMap<String, BackupRecord>()

    /** How many files the app says it left out of a backup. */
    var filesLeftOut = 0L

    /** How often [restore] was called. */
    var restores = 0

    /** The data version of the last backup [restore] got. */
    var restoredDataVersion: Int? = null

    /** Thrown by [list] after the records, or by [restore] after the first record, to stop in the middle. */
    var failure: Exception? = null

    fun add(vararg added: BackupRecord) = added.forEach { records[it.fields.id] = it }

    /** Stores the stream of the file with the ID of record [number]. */
    fun putFile(number: Long, bytes: ByteArray) = File(fileStore, TestIdSource.idNumber(number)).writeBytes(bytes)

    fun fileIds(): List<String> = fileStore.list().orEmpty().sorted()

    override suspend fun list(into: BackupSink) {
        records.values.forEach { into.record(it) }
        failure?.let { throw it }
        fileIds().forEach { id ->
            val file = File(fileStore, id)
            file.inputStream().use { into.file(id, file.length(), it) }
        }
        if (filesLeftOut > 0) into.filesLeftOut(filesLeftOut)
    }

    override suspend fun restore(from: CheckedBackup) {
        restores++
        restoredDataVersion = from.dataVersion
        val taken = mutableSetOf<String>()
        val same = mutableSetOf<String>()
        from.forEachRecord { record ->
            val stored = records[record.fields.id]
            when {
                stored == null || stored.fields.updatedAt < record.fields.updatedAt -> {
                    records[record.fields.id] = record
                    taken += record.fields.id
                }
                stored.fields.updatedAt == record.fields.updatedAt -> same += record.fields.id
            }
            failure?.let { throw it }
        }
        from.forEachFile { file ->
            val target = File(fileStore, file.id)
            if (file.id in taken || (file.id in same && !target.exists())) file.moveTo(target)
        }
    }

    /** Everything the app holds, as text that two apps can be compared by. No order of adding is in it. */
    fun snapshot(): Map<String, String> {
        val ofRecords = records.values.associate { "record ${it.fields.id}" to "${it.type} ${it.fields} ${it.content.toHex()}" }
        val ofFiles = fileIds().associate { "file $it" to sha256(File(fileStore, it).readBytes()) }
        return (ofRecords + ofFiles).toSortedMap()
    }
}

/**
 * One device in a test: an app with real keys from the test fixtures of
 * `core/crypto`, its [FakeApp], its staging folder, and the engine that
 * writes, checks and restores backups for it. Its functions wait for the
 * result, so a test reads straight down.
 */
internal class Device(private val temporary: TemporaryFolder, dataVersion: Int = 1) {
    val keys = SoftwareKeysApp(temporary.newFolder(), WATER)
    val app = FakeApp(temporary.newFolder(), dataVersion)
    val clock = TestClock()
    val stagingFolder: File = temporary.newFolder()
    val engine = BackupEngine(keys.crypto.backups, WATER, app, BackupStaging(stagingFolder), clock)

    /** Gives the app its keys from a new recovery key, or from [recoveryKey], and returns that key. */
    fun giveKeys(recoveryKey: RecoveryKey = keys.crypto.setup.createRecoveryKey()): RecoveryKey {
        keys.crypto.setup.storeDerivedKeys(recoveryKey)
        return recoveryKey
    }

    /** How often a document was opened for writing. A backup that is refused opens none. */
    var documentsOpened = 0
        private set

    /** Writes a backup into memory. Returns the result and every byte that was written. */
    fun write(): Pair<ExportResult, ByteArray> {
        val document = ByteArrayOutputStream()
        val result = runBlocking {
            engine.write {
                documentsOpened++
                document
            }
        }
        return result to document.toByteArray()
    }

    /** Writes a backup that must succeed, and returns the file. */
    fun backup(): ByteArray {
        val (result, file) = write()
        check(result is ExportResult.Written) { "The backup was not written: $result" }
        return file
    }

    fun check(file: ByteArray): CheckResult = runBlocking { engine.check(ByteArrayInputStream(file)) }

    fun restore(file: ByteArray): RestoreResult = runBlocking { engine.restore(ByteArrayInputStream(file)) }

    /**
     * The answer for a file that must be refused. A check and a restore
     * must give the same answer, the app's code must not have been called,
     * the app must be as it was, and nothing may be left in staging.
     */
    fun answerOf(file: ByteArray): BackupAnswer {
        val before = app.snapshot()
        val restoresBefore = app.restores
        val checked = check(file)
        val restored = restore(file)
        check(checked is CheckResult.Refused) { "The check took the file: $checked" }
        check(restored is RestoreResult.Refused) { "The restore took the file: $restored" }
        assertEquals("a check and a restore give the same answer", checked.answer, restored.answer)
        assertEquals("the app's code is not called", restoresBefore, app.restores)
        assertEquals("the app is as it was", before, app.snapshot())
        assertEquals("nothing is left in staging", emptyList<String>(), stagingFolder.list().orEmpty().toList())
        return restored.answer
    }

    /** A backup file of this app whose body is [body] as it is, encrypted with the app's real keys. */
    fun fileWithBody(body: ByteArray): ByteArray {
        val header = BackupHeader.of(keys.crypto.backups.keyId(), WATER.value)
        val file = ByteArrayOutputStream()
        file.write(header.bytes)
        keys.crypto.backups.encryptingStream(header.bytes, file).use { it.write(body) }
        return file.toByteArray()
    }
}
