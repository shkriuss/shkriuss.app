package app.shkriuss.core.backup

import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.testing.TestIdSource
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Writing a backup: when none can be made, files that are left out, and
 * the mistakes of the calling code that stop a backup at once (items 12
 * and 13 of "What the tests must cover" in backup-format.md, and "Writing
 * a backup").
 */
class ExportTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private fun deviceWithKeys(): Device = Device(temporary).also { it.giveKeys() }

    /** An app that lists what [listing] says, to try what the writer refuses. */
    private fun appThatLists(dataVersion: Int = 1, listing: suspend (BackupSink) -> Unit) = object : BackupContent {
        override val dataVersion = dataVersion

        override suspend fun list(into: BackupSink) = listing(into)

        override suspend fun restore(from: CheckedBackup) = error("not restored in this test")
    }

    /** Writes a backup of [content] with the keys of [device]. Returns what happened and every byte that was written. */
    private fun write(device: Device, content: BackupContent): Pair<Result<ExportResult>, ByteArray> {
        val engine = BackupEngine(device.keys.crypto.backups, WATER, content, BackupStaging(device.stagingFolder), device.clock)
        val document = ByteArrayOutputStream()
        val result = runBlocking { runCatching { engine.write { document } } }
        return result to document.toByteArray()
    }

    /** A mistake of the calling code stops the backup with [expected], and what was written is no backup. */
    private inline fun <reified T : Throwable> assertStops(
        why: String,
        dataVersion: Int = 1,
        noinline listing: suspend (BackupSink) -> Unit,
    ) {
        val device = deviceWithKeys()
        val (result, written) = write(device, appThatLists(dataVersion, listing))

        assertTrue("$why: ${result.exceptionOrNull()}", result.exceptionOrNull() is T)
        assertNotEquals("$why: what was written is not taken", CheckResult.Good::class, device.check(written)::class)
    }

    @Test
    fun noBackupIsMadeBeforeTheAppHasItsKeysFromARecoveryKey() {
        val device = Device(temporary)
        device.app.add(record(1))

        val (result, written) = device.write()

        assertEquals(ExportResult.NotReady, result)
        assertEquals("no document is opened", 0, device.documentsOpened)
        assertEquals(0, written.size)
    }

    @Test
    fun filesThatAreLeftOutAreCountedAndTheirRecordsStillGoIn() {
        val device = deviceWithKeys()
        device.app.add(record(1, type = "file"), record(2, type = "file"), record(3, type = "file"))
        // Only the stream of the first file is on this device.
        device.app.putFile(1, pattern(200))
        device.app.filesLeftOut = 2

        val (result, file) = device.write()

        assertEquals(ExportResult.Written(records = 3, files = 1, filesLeftOut = 2), result)
        val summary = BackupSummary(dataVersion = 1, madeAt = device.clock.nowMillis, records = 3, files = 1)
        assertEquals("the file itself does not say how many were left out", CheckResult.Good(summary), device.check(file))

        val other = Device(temporary)
        other.keys.crypto.setup.storeDerivedKeys(device.giveKeys())
        // A second set of keys from a second recovery key is not this test: restore on the same device.
        val restored = Device(temporary, dataVersion = 1)
        assertTrue(restored.app.records.isEmpty())
        assertEquals(RestoreResult.Restored(summary), device.restore(file))
        assertEquals(3, device.app.records.size)
        assertEquals(listOf(TestIdSource.idNumber(1)), device.app.fileIds())
    }

    @Test
    fun theNumbersOfFilesLeftOutAreAddedUp() {
        val device = deviceWithKeys()
        val (result, _) = write(
            device,
            appThatLists { sink ->
                sink.filesLeftOut(2)
                sink.record(record(1))
                sink.filesLeftOut(0)
                sink.filesLeftOut(3)
            },
        )

        assertEquals(ExportResult.Written(records = 1, files = 0, filesLeftOut = 5), result.getOrThrow())
    }

    @Test
    fun mistakesOfTheCallingCodeStopTheBackupAtOnce() {
        val id = TestIdSource.idNumber(1)
        val bytes = pattern(10)
        assertStops<IllegalStateException>("a record after a file") { sink ->
            sink.file(id, 10, ByteArrayInputStream(bytes))
            sink.record(record(1))
        }
        assertStops<IllegalArgumentException>("an ID that is not a UUID") { it.record(BackupRecord("note", record(1).fields.copy(id = "1"), ByteArray(0))) }
        assertStops<IllegalArgumentException>("a file ID that is not a UUID") { it.file("file-1", 10, ByteArrayInputStream(bytes)) }
        assertStops<IllegalArgumentException>("an upper-case type name") { it.record(record(1, type = "Note")) }
        assertStops<IllegalArgumentException>("no type name") { it.record(record(1, type = "")) }
        assertStops<IllegalArgumentException>("a type name of 65 letters") { it.record(record(1, type = "a".repeat(65))) }
        assertStops<IllegalArgumentException>("content above 16 MiB") {
            it.record(BackupRecord("note", record(1).fields, ByteArray(BackupFormat.LARGEST_CONTENT + 1)))
        }
        assertStops<IllegalStateException>("a file shorter than the length given") { it.file(id, 11, ByteArrayInputStream(bytes)) }
        assertStops<IllegalStateException>("a file longer than the length given") { it.file(id, 9, ByteArrayInputStream(bytes)) }
        assertStops<IllegalArgumentException>("a file length below 0") { it.file(id, -1, ByteArrayInputStream(bytes)) }
        assertStops<IllegalArgumentException>("files left out below 0") { it.filesLeftOut(-1) }
        assertStops<IllegalArgumentException>("data version 0", dataVersion = 0) { }
    }

    @Test
    fun anIdInUpperCaseComesBackInLowerCase() {
        val device = deviceWithKeys()
        val upper = "0F1E2D3C-4B5A-4978-8695-A4B3C2D1E0FF"
        device.app.add(BackupRecord("note", record(1).fields.copy(id = upper), "Milk".toByteArray()))
        val file = device.backup()
        device.app.records.clear()

        device.restore(file)

        assertEquals(listOf(upper.lowercase()), device.app.records.keys.toList())
    }

    @Test
    fun anAppNameThatDoesNotFitIntoTheHeaderIsRefusedWhenTheAppStarts() {
        val device = deviceWithKeys()
        val tooLong = AppName.of("a".repeat(33))

        val refused = runCatching { BackupEngine(device.keys.crypto.backups, tooLong, device.app, BackupStaging(device.stagingFolder), device.clock) }

        assertTrue(refused.exceptionOrNull() is IllegalArgumentException)
    }

    @Test
    fun nothingShowsTheContentOfARecord() {
        val secret = "Call the doctor"
        val shown = record(1, content = secret).toString()

        assertFalse(shown, shown.contains(secret))
        assertFalse(shown, shown.contains(secret.toByteArray().toHex()))
        assertEquals("BackupRecord(note ${TestIdSource.idNumber(1)})", shown)
    }
}
