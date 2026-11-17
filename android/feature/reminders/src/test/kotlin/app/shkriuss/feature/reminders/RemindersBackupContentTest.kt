package app.shkriuss.feature.reminders

import android.net.Uri
import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.backup.BackupSink
import app.shkriuss.core.backup.Backups
import app.shkriuss.core.backup.CheckedBackup
import app.shkriuss.core.backup.CheckedFile
import app.shkriuss.core.backup.ExportResult
import app.shkriuss.core.backup.RestoreResult
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.data.RecordTimes
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.reminders.data.ReminderEntity
import app.shkriuss.feature.reminders.data.RemindersDatabase
import java.io.InputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * Reminders' records in a backup (docs/apps/reminders/spec.md, "Backup
 * contents"): the byte layout of the spec's two examples, the list of
 * every record, the restore by the rule "the newest edit wins", what a
 * restore refuses, and a whole backup written and restored through
 * `Backups` of core/backup.
 */
@RunWith(RobolectricTestRunner::class)
class RemindersBackupContentTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val database: RemindersDatabase = memoryDatabase()
    private val clock = clockAt(monday(9, 30))
    private val ids = TestIdSource()
    private val repository = RemindersRepository(database, clock, ids, RemindersTime(clock) { UTC }, emptyBook(), work = Dispatchers.Unconfined)
    private val content = RemindersBackupContent(database, clock, ids)
    private val others = mutableListOf<RemindersDatabase>()

    @After
    fun closeTheDatabases() {
        database.close()
        others.forEach { it.close() }
    }

    private fun otherDatabase(): RemindersDatabase = memoryDatabase().also { others += it }

    /** Record fields of a backup. Their IDs are not those the repository of the test hands out. */
    private fun fields(number: Long, updatedAt: Long = 1_000 + number, deletedAt: Long? = null) =
        RecordFields(TestIdSource.idNumber(100 + number), 1_000, updatedAt, deletedAt)

    private fun row(
        title: String = "Pills",
        repeat: Int = 1,
        weekdays: Int = 0,
        day: Int = MONDAY.toEpochDay().toInt(),
        minute: Int = 540,
        fields: RecordFields = fields(1),
    ) = ReminderEntity(fields, 0, title = title, day = day, minuteOfDay = minute, repeat = repeat, weekdays = weekdays)

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    private fun String.fromHex(): ByteArray = replace(" ", "").chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    /** What a database holds, deleted records included, without the change numbers. */
    private fun everything(of: RemindersDatabase): List<String> = runBlocking {
        of.reminders().all().map { it.copy(changeNumber = 0).toString() }.sorted()
    }

    private fun listed(): List<BackupRecord> {
        val sink = ListingSink()
        runBlocking { content.list(sink) }
        assertEquals("Reminders leaves no file out", listOf(0L), sink.leftOut)
        return sink.records
    }

    private fun restore(into: RemindersBackupContent, records: List<BackupRecord>, files: Int = 0) =
        runBlocking { into.restore(ListedBackup(records, files)) }

    // The content.

    @Test
    fun theTwoExamplesOfTheSpecAreTheirBytes() {
        // "Call the bank", once, 2026-11-16 at 14:00, and "Gym", every Mon, Wed and Fri at 18:30 from 2026-11-16.
        val bank = row("Call the bank", repeat = 0, minute = 840)
        val gym = row("Gym", repeat = 2, weekdays = 0x15, minute = 1_110, fields = fields(2))

        assertEquals("00 00 00005125 00000348 000d 43616c6c207468652062616e6b".replace(" ", ""), RemindersBackupCodec.encode(bank).content.toHex())
        assertEquals("02 15 00005125 00000456 0003 47796d".replace(" ", ""), RemindersBackupCodec.encode(gym).content.toHex())
        assertEquals("reminder", RemindersBackupCodec.encode(bank).type)
        assertEquals(bank, RemindersBackupCodec.decode(RemindersBackupCodec.encode(bank)))
        assertEquals(gym, RemindersBackupCodec.decode(BackupRecord("reminder", fields(2), "02 15 00005125 00000456 0003 47796d".fromHex())))
    }

    @Test
    fun aTitleIsItsUtf8Bytes() {
        // One bell: four bytes.
        val bell = row("🔔")
        val record = RemindersBackupCodec.encode(bell)
        assertEquals(12 + 4, record.content.size)
        assertEquals("0004f09f9494", record.content.copyOfRange(10, 16).toHex())
        assertEquals(bell, RemindersBackupCodec.decode(record))

        // 200 of them: 800 bytes, the most a title can take.
        val longest = row("🔔".repeat(200))
        assertEquals(12 + 800, RemindersBackupCodec.encode(longest).content.size)
        assertEquals(longest, RemindersBackupCodec.decode(RemindersBackupCodec.encode(longest)))
    }

    // Writing.

    @Test
    fun theBackupListsEveryReminderDeletedOnesTooEachOnce() = runBlocking {
        val kept = repository.add("Pills", pills())!!
        val deleted = repository.add("Gym", gym())!!
        repository.delete(listOf(deleted.id))

        val records = listed()

        assertEquals(listOf("reminder", "reminder"), records.map { it.type })
        val deletedRecord = records.single { it.fields.id == deleted.id }
        assertTrue("a deleted reminder keeps its marker", deletedRecord.fields.deletedAt != null)
        assertEquals("and its full content", 12 + 3, deletedRecord.content.size)
        assertEquals(database.reminders().find(kept.id)!!.record, records.single { it.fields.id == kept.id }.fields)
        assertEquals(1, content.dataVersion)
    }

    // Reading.

    @Test
    fun aRestoreIntoAnEmptyAppGivesExactlyWhatTheBackupHolds() = runBlocking {
        repository.add("Pills", pills())
        repository.delete(listOf(repository.add("Gym", gym())!!.id))
        repository.add("Call the bank", CALL_THE_BANK)
        val other = otherDatabase()

        restore(RemindersBackupContent(other, clock, TestIdSource()), listed())

        assertEquals(everything(database), everything(other))
    }

    @Test
    fun theNewestEditWinsAndTheSameBackupTwiceChangesNothing() = runBlocking {
        val pills = repository.add("Pills", pills())!!
        val backup = listed()
        clock.advanceBy(60_000)
        repository.change(pills.id, "Vitamins", pills())
        val newer = everything(database)

        restore(content, backup)
        assertEquals("the edit after the backup is newer, so it stays", newer, everything(database))

        val other = otherDatabase()
        val otherContent = RemindersBackupContent(other, clock, TestIdSource())
        restore(otherContent, backup)
        val once = runBlocking { other.reminders().all() }
        restore(otherContent, backup)
        assertEquals("nothing is written the second time", once, runBlocking { other.reminders().all() })
    }

    @Test
    fun aRecordOfAnotherTypeStopsTheRestoreAndNothingChanges() {
        val good = RemindersBackupCodec.encode(row())
        assertRefused(listOf(good, BackupRecord("task", fields(2), good.content)))
    }

    @Test
    fun aContentOfAnotherLengthStopsTheRestore() {
        val good = RemindersBackupCodec.encode(row())
        listOf(
            good.content + 0,
            good.content.copyOf(good.content.size - 1),
            good.content.copyOf(11),
            ByteArray(0),
        ).forEach { assertRefused(listOf(BackupRecord("reminder", good.fields, it))) }
    }

    @Test
    fun aValueOutsideItsLimitsStopsTheRestore() {
        listOf(
            row(repeat = 5),
            row(repeat = -1),
            row(day = -1),
            row(day = ReminderLimits.DAYS.last + 1),
            row(minute = -1),
            row(minute = 1_440),
            row(repeat = 2, weekdays = 0),
            row(repeat = 2, weekdays = 128),
            row(repeat = 1, weekdays = 1),
            row(repeat = 0, weekdays = 0x15),
        ).forEach { assertRefused(listOf(RemindersBackupCodec.encode(it))) }
    }

    @Test
    fun aTitleOutsideItsLimitsStopsTheRestore() {
        listOf("", " Pills", "Pills ", "Two\nlines", "x".repeat(201))
            .forEach { assertRefused(listOf(RemindersBackupCodec.encode(row(title = it)))) }
    }

    @Test
    fun aTitleThatIsNotUtf8StopsTheRestore() {
        // n = 2, then a lone continuation byte and a byte that never occurs in UTF-8.
        listOf("01 00 00005125 0000021c 0002 80ff", "01 00 00005125 0000021c 0003 eda080").forEach { hex ->
            assertRefused(listOf(BackupRecord("reminder", fields(1), hex.fromHex())))
        }
    }

    @Test
    fun theFirstAndTheLastDayAreRestored() = runBlocking {
        restore(content, listOf(RemindersBackupCodec.encode(row(day = 0)), RemindersBackupCodec.encode(row(day = ReminderLimits.DAYS.last, fields = fields(2)))))

        assertEquals(listOf(0, ReminderLimits.DAYS.last), database.reminders().all().map { it.day }.sorted())
    }

    @Test
    fun aRecordTimeThatNoRecordCanHoldStopsTheRestore() {
        val id = TestIdSource.idNumber(101)
        listOf(
            RecordFields(id, createdAt = -1, updatedAt = 1_000, deletedAt = null),
            RecordFields(id, createdAt = 1_000, updatedAt = RecordTimes.LAST_MILLIS + 1, deletedAt = null),
            RecordFields(id, createdAt = 1_000, updatedAt = 2_000, deletedAt = Long.MAX_VALUE),
        ).forEach { assertRefused(listOf(RemindersBackupCodec.encode(row(fields = it)))) }
    }

    @Test
    fun aFileStopsTheRestore() {
        assertRefused(listOf(RemindersBackupCodec.encode(row())), files = 1)
    }

    @Test
    fun anotherDataVersionStopsTheRestore() {
        val backup = object : CheckedBackup by ListedBackup(listOf(RemindersBackupCodec.encode(row())), 0) {
            override val dataVersion = 2
        }
        assertThrows(UnreadableBackupException::class.java) { runBlocking { content.restore(backup) } }
    }

    /** The restore fails with [UnreadableBackupException], and the database is as it was. */
    private fun assertRefused(records: List<BackupRecord>, files: Int = 0) {
        runBlocking { repository.add("Already here", pills()) }
        val before = everything(database)
        assertThrows(UnreadableBackupException::class.java) { restore(content, records, files) }
        assertEquals("nothing changed", before, everything(database))
    }

    // A whole backup through core/backup.

    @Test
    fun aBackupWrittenByOneAppIsRestoredOnAnotherWithTheSameRecoveryKey() = runBlocking {
        repository.add("Pills", pills())
        repository.add("Gym", gym())
        TestDocuments.folder = temporary.newFolder()
        TestDocuments.onOpen = {}
        Robolectric.setupContentProvider(TestDocuments::class.java, TestDocuments.AUTHORITY)
        val document: Uri = TestDocuments.uri("reminders-2026-11-16.shkbackup")
        val keys = SoftwareKeysApp(temporary.newFolder(), RemindersServices.APP_NAME)
        val recoveryKey = keys.crypto.setup.createRecoveryKey().also { keys.crypto.setup.storeDerivedKeys(it) }

        val written = backupsOf(keys, content).export(document)
        assertEquals(ExportResult.Written(records = 2, files = 0, filesLeftOut = 0, notDeleted = mapOf("reminder" to 2L)), written)

        val newPhone = SoftwareKeysApp(temporary.newFolder(), RemindersServices.APP_NAME).also { it.crypto.setup.storeDerivedKeys(recoveryKey) }
        val other = otherDatabase()
        val restored = backupsOf(newPhone, RemindersBackupContent(other, clock, TestIdSource())).restore(document)
        assertTrue(restored is RestoreResult.Restored)
        assertEquals(everything(database), everything(other))
    }

    private fun backupsOf(keys: SoftwareKeysApp, content: RemindersBackupContent) =
        Backups(context.contentResolver, keys.crypto.backups, RemindersServices.APP_NAME, content, temporary.newFolder(), clock, Dispatchers.IO)

    /** Collects what Reminders lists into a backup. */
    private class ListingSink : BackupSink {
        val records = mutableListOf<BackupRecord>()
        val leftOut = mutableListOf<Long>()

        override suspend fun record(record: BackupRecord) {
            records += record
        }

        override suspend fun file(id: String, length: Long, content: InputStream) = error("Reminders lists no files")

        override fun filesLeftOut(count: Long) {
            leftOut += count
        }
    }

    /** A checked backup that holds [records] and, as far as its counts say, [files] files. */
    private class ListedBackup(private val records: List<BackupRecord>, private val files: Int) : CheckedBackup {
        override val dataVersion = 1
        override val madeAt = 0L
        override val recordCount = records.size.toLong()
        override val fileCount = files.toLong()

        override suspend fun forEachRecord(action: suspend (BackupRecord) -> Unit) = records.forEach { action(it) }

        override suspend fun forEachFile(action: suspend (CheckedFile) -> Unit) = Unit
    }
}
