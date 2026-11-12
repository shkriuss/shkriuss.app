package app.shkriuss.core.backup

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Failures that are not answers about the file: a backup whose writing
 * failed, a read of the document that fails, staging that cannot be
 * written, and the app's own code that fails. After each, nothing is left
 * in staging (item 9 of "What the tests must cover" in backup-format.md,
 * and "The answers").
 */
class NothingChangesTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private fun deviceWithKeys(): Device = Device(temporary).also { it.giveKeys() }

    private fun staged(device: Device): List<String> = device.stagingFolder.list().orEmpty().toList()

    /** A document in memory that knows whether it was closed. */
    private class Document : ByteArrayOutputStream() {
        var closed = false

        override fun close() {
            closed = true
        }
    }

    @Test
    fun aBackupWhoseWritingFailedIsClosedAndNeverRestored() {
        val device = deviceWithKeys()
        device.app.add(record(1), record(2))
        device.app.putFile(2, pattern(500))
        val stop = IOException("The app could not list its files")
        device.app.failure = stop
        val document = Document()

        val thrown = runBlocking { runCatching { device.engine.write { document } } }.exceptionOrNull()

        assertSame(stop, thrown)
        assertTrue("the document is closed", document.closed)
        device.app.failure = null
        assertEquals("what was written is not a backup", BackupAnswer.Damaged, device.answerOf(document.toByteArray()))
    }

    @Test
    fun aReadOfTheDocumentThatFailsStaysThatFailure() {
        val device = deviceWithKeys()
        device.app.add(record(1), record(2))
        device.app.putFile(2, pattern(500))
        val file = device.backup()
        val before = device.app.snapshot()

        for (good in listOf(0, 3, 12, 20, 60, file.size / 2, file.size - 1)) {
            val failure = IOException("The storage went away")
            val checked = runBlocking { runCatching { device.engine.check(FailingInput(file, good, failure)) } }
            val restored = runBlocking { runCatching { device.engine.restore(FailingInput(file, good, failure)) } }

            assertSame("a check that fails after $good bytes", failure, checked.exceptionOrNull())
            assertSame("a restore that fails after $good bytes", failure, restored.exceptionOrNull())
        }
        assertEquals(0, device.app.restores)
        assertEquals(before, device.app.snapshot())
        assertEquals(emptyList<String>(), staged(device))
    }

    @Test
    fun stagingThatCannotBeWrittenIsAFailureOfItsOwn() {
        val device = deviceWithKeys()
        device.app.add(record(1))
        val file = device.backup()
        // A file stands where the staging folder should be, so nothing can be put aside.
        val noFolder = temporary.newFile()
        val engine = BackupEngine(device.keys.crypto.backups, WATER, device.app, BackupStaging(noFolder), device.clock)

        val thrown = runBlocking { runCatching { engine.restore(ByteArrayInputStream(file)) } }.exceptionOrNull()

        assertTrue("$thrown", thrown is BackupStagingException)
        assertEquals(0, device.app.restores)
        assertEquals("a check needs no staging", CheckResult.Good::class, runBlocking { engine.check(ByteArrayInputStream(file)) }::class)
    }

    @Test
    fun aFileThatIsRefusedByItsHeaderNeverTouchesStaging() {
        val device = deviceWithKeys()
        val fromAnotherKey = deviceWithKeys().backup()
        // A file stands where the staging folder should be. A restore that needed staging would fail.
        val engine = BackupEngine(device.keys.crypto.backups, WATER, device.app, BackupStaging(temporary.newFile()), device.clock)

        val notABackup = runBlocking { engine.restore(ByteArrayInputStream(pattern(500))) }
        val otherKey = runBlocking { engine.restore(ByteArrayInputStream(fromAnotherKey)) }

        assertEquals(RestoreResult.Refused(BackupAnswer.NotABackup), notABackup)
        assertTrue("$otherKey", (otherKey as RestoreResult.Refused).answer is BackupAnswer.OtherRecoveryKey)
        assertEquals(0, device.app.restores)
    }

    @Test
    fun whenTheAppsOwnCodeFailsItsFailurePassesThroughAndStagingIsEmptied() {
        val device = deviceWithKeys()
        device.app.add(record(1), record(2))
        device.app.putFile(2, pattern(500))
        val file = device.backup()
        val stop = IllegalStateException("The database is closed")
        device.app.failure = stop

        val thrown = runBlocking { runCatching { device.engine.restore(ByteArrayInputStream(file)) } }.exceptionOrNull()

        assertSame(stop, thrown)
        assertEquals(1, device.app.restores)
        assertEquals(emptyList<String>(), staged(device))
    }

    @Test
    fun theAppGetsTheBackupFromStagingAndCanReadItMoreThanOnce() {
        val device = deviceWithKeys()
        device.app.add(record(1), record(2, type = "file"))
        device.app.putFile(2, pattern(500))
        val file = device.backup()
        val seen = mutableListOf<String>()
        val content = object : BackupContent {
            override val dataVersion = 1

            override suspend fun list(into: BackupSink) = error("not listed in this test")

            override suspend fun restore(from: CheckedBackup) {
                seen += "staged while the app runs: ${staged(device).size}"
                repeat(2) {
                    from.forEachRecord { seen += "record ${it.type}" }
                    from.forEachFile { staged -> seen += "file ${staged.length} ${sha256(staged.open().use { it.readBytes() })}" }
                }
                seen += "counts ${from.recordCount} ${from.fileCount}"
            }
        }
        val engine = BackupEngine(device.keys.crypto.backups, WATER, content, BackupStaging(device.stagingFolder), device.clock)

        runBlocking { engine.restore(ByteArrayInputStream(file)) }

        val once = listOf("record note", "record file", "file 500 ${sha256(pattern(500))}")
        assertEquals(listOf("staged while the app runs: 1") + once + once + "counts 2 1", seen)
        assertEquals("staging is emptied when the app is done", emptyList<String>(), staged(device))
    }

    @Test
    fun theCallAtAppStartDeletesWhatAStoppedRestoreLeft() {
        val folder = temporary.newFolder()
        val left = File(folder, "left-by-a-stop").apply { mkdirs() }
        File(left, "records").writeBytes(pattern(100))
        File(left, "file-0").writeBytes(pattern(100))
        File(folder, "stray").writeBytes(pattern(10))

        BackupStaging(folder).clear()

        assertEquals(emptyList<String>(), folder.list().orEmpty().toList())
        assertTrue("the folder itself stays", folder.isDirectory)
        // A staging folder that was never made is nothing to clear.
        BackupStaging(File(folder, "never-made")).clear()
    }
}
