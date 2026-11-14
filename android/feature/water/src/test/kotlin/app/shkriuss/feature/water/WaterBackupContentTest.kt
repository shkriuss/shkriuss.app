package app.shkriuss.feature.water

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.backup.BackupSink
import app.shkriuss.core.backup.Backups
import app.shkriuss.core.backup.CheckedBackup
import app.shkriuss.core.backup.CheckedFile
import app.shkriuss.core.backup.ExportResult
import app.shkriuss.core.backup.RestoreResult
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.water.data.GoalEntity
import app.shkriuss.feature.water.data.IntakeEntity
import app.shkriuss.feature.water.data.SettingsEntity
import app.shkriuss.feature.water.data.WaterDatabase
import java.io.File
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
 * Water's records in a backup (docs/apps/water/spec.md, "Backup
 * contents"): the byte layout of each type, the list of every record, the
 * restore by the rule "the newest edit wins", what a restore refuses, and a
 * whole backup written and restored through `Backups` of core/backup.
 */
@RunWith(RobolectricTestRunner::class)
class WaterBackupContentTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val database: WaterDatabase = memoryDatabase()
    private val clock = clockAt(at(14, 5))
    private val ids = TestIdSource()
    private val repository = WaterRepository(database, clock, ids)
    private val content = WaterBackupContent(database, clock, ids)
    private val others = mutableListOf<WaterDatabase>()

    @After
    fun closeTheDatabases() {
        database.close()
        others.forEach { it.close() }
    }

    private fun otherDatabase(): WaterDatabase = memoryDatabase().also { others += it }

    /** Record fields of a backup. Their IDs are not those the repository of the test hands out. */
    private fun fields(number: Long, updatedAt: Long = 1_000 + number, deletedAt: Long? = null) =
        RecordFields(TestIdSource.idNumber(100 + number), 1_000, updatedAt, deletedAt)

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    /** What a database holds, deleted records included, without the change numbers. */
    private fun everything(of: WaterDatabase): List<String> = runBlocking {
        (of.intake().all().map { it.copy(changeNumber = 0).toString() } +
            of.goals().all().map { it.copy(changeNumber = 0).toString() } +
            of.settings().all().map { it.copy(changeNumber = 0).toString() }).sorted()
    }

    private fun listed(): List<BackupRecord> {
        val sink = ListingSink()
        runBlocking { content.list(sink) }
        assertEquals("Water leaves no file out", listOf(0L), sink.leftOut)
        return sink.records
    }

    private fun restore(into: WaterBackupContent, records: List<BackupRecord>, files: Int = 0) =
        runBlocking { into.restore(ListedBackup(records, files)) }

    // The content of each type.

    @Test
    fun aDrinkIsTwelveBytesAsInTheSpec() {
        // 250 ml on 2026-11-13 at 14:05.
        val drink = IntakeEntity(fields(1), 7, amountMl = 250, day = THE_DAY.asWaterDay(), minuteOfDay = 14 * 60 + 5)
        val record = WaterBackupCodec.encode(drink)
        assertEquals("intake", record.type)
        assertEquals("000000fa000051220000034d", record.content.toHex())
        assertEquals(drink.copy(changeNumber = 0), WaterBackupCodec.decode(record))
    }

    @Test
    fun aGoalIsEightBytesAsInTheSpec() {
        // 2,500 ml from 2026-11-13.
        val goal = GoalEntity(fields(1), 7, amountMl = 2_500, fromDay = THE_DAY.asWaterDay())
        val record = WaterBackupCodec.encode(goal)
        assertEquals("goal", record.type)
        assertEquals("000009c400005122", record.content.toHex())
        assertEquals(goal.copy(changeNumber = 0), WaterBackupCodec.decode(record))
    }

    @Test
    fun aSettingsRecordIsTwentySixBytesAsInTheSpec() {
        // Fluid ounces, quick amounts 148, 237 and 473 ml, reminders on, every 90 minutes, from 07:30 until 21:00.
        val settings = SettingsEntity(fields(1), 7, 1, 148, 237, 473, true, 90, 7 * 60 + 30, 21 * 60)
        val record = WaterBackupCodec.encode(settings)
        assertEquals("settings", record.type)
        assertEquals("0100000094000000ed000001d9010000005a000001c2000004ec", record.content.toHex())
        assertEquals(settings.copy(changeNumber = 0), WaterBackupCodec.decode(record))
    }

    // Writing.

    @Test
    fun theBackupListsEveryRecordOfTheThreeTablesDeletedOnesTooEachOnce() = runBlocking {
        val kept = repository.addDrink(THE_DAY, 600, 250)
        val deleted = repository.addDrink(THE_DAY, 700, 500)
        repository.deleteDrink(deleted.id)
        repository.setGoal(THE_DAY, 2_500)
        repository.changeSettings { it.copy(remindersOn = true) }

        val records = listed()

        assertEquals(listOf("goal", "intake", "intake", "settings"), records.map { it.type }.sorted())
        assertEquals(records.size, records.map { it.fields.id }.toSet().size)
        val deletedRecord = records.single { it.fields.id == deleted.id }
        assertTrue("a deleted drink keeps its marker", deletedRecord.fields.deletedAt != null)
        assertEquals("and its full content", 12, deletedRecord.content.size)
        assertEquals(database.intake().find(kept.id)!!.record, records.single { it.fields.id == kept.id }.fields)
        assertEquals(1, content.dataVersion)
    }

    // Reading.

    @Test
    fun aRestoreIntoAnEmptyAppGivesExactlyWhatTheBackupHolds() = runBlocking {
        repository.addDrink(THE_DAY, 600, 250)
        repository.deleteDrink(repository.addDrink(THE_DAY, 700, 500).id)
        repository.setGoal(THE_DAY, 2_500)
        repository.changeSettings { it.copy(unit = WaterUnit.US_FLUID_OUNCES) }
        val other = otherDatabase()

        restore(WaterBackupContent(other, clock, TestIdSource()), listed())

        assertEquals(everything(database), everything(other))
    }

    @Test
    fun theNewestEditWinsAndTheSameBackupTwiceChangesNothing() = runBlocking {
        val drink = repository.addDrink(THE_DAY, 600, 250)
        val backup = listed()
        clock.advanceBy(60_000)
        repository.changeDrink(drink.id, 600, 300)
        val newer = everything(database)

        restore(content, backup)
        assertEquals("the edit after the backup is newer, so it stays", newer, everything(database))

        val other = otherDatabase()
        val otherContent = WaterBackupContent(other, clock, TestIdSource())
        restore(otherContent, backup)
        val once = runBlocking { other.intake().all() }
        restore(otherContent, backup)
        assertEquals("nothing is written the second time", once, runBlocking { other.intake().all() })
    }

    @Test
    fun aRecordOfAnotherTypeStopsTheRestoreAndNothingChanges() {
        val good = WaterBackupCodec.encode(IntakeEntity(fields(1), 0, 250, THE_DAY.asWaterDay(), 600))
        val other = BackupRecord("coffee", fields(2), ByteArray(12))

        assertRefused(listOf(good, other))
    }

    @Test
    fun aContentOfAnotherLengthStopsTheRestore() {
        val drink = WaterBackupCodec.encode(IntakeEntity(fields(1), 0, 250, THE_DAY.asWaterDay(), 600))
        assertRefused(listOf(BackupRecord("intake", drink.fields, drink.content + 0)))
        assertRefused(listOf(BackupRecord("goal", fields(2), ByteArray(12))))
        assertRefused(listOf(BackupRecord("settings", fields(3), ByteArray(25))))
    }

    @Test
    fun aValueOutsideItsLimitsStopsTheRestore() {
        val day = THE_DAY.asWaterDay()
        val wrong = listOf(
            IntakeEntity(fields(1), 0, 0, day, 600),
            IntakeEntity(fields(1), 0, 3_001, day, 600),
            IntakeEntity(fields(1), 0, 250, day, 1_440),
            IntakeEntity(fields(1), 0, 250, day, -1),
        ).map(WaterBackupCodec::encode) + listOf(
            GoalEntity(fields(1), 0, 499, day),
            GoalEntity(fields(1), 0, 10_001, day),
        ).map(WaterBackupCodec::encode) + listOf(
            SettingsEntity(fields(1), 0, 2, 150, 250, 500, false, 60, 480, 1_320),
            SettingsEntity(fields(1), 0, 0, 0, 250, 500, false, 60, 480, 1_320),
            SettingsEntity(fields(1), 0, 0, 150, 3_001, 500, false, 60, 480, 1_320),
            SettingsEntity(fields(1), 0, 0, 150, 250, 5_000, false, 60, 480, 1_320),
            SettingsEntity(fields(1), 0, 0, 150, 250, 500, false, 50, 480, 1_320),
            SettingsEntity(fields(1), 0, 0, 150, 250, 500, false, 60, 1_410, 1_439),
            SettingsEntity(fields(1), 0, 0, 150, 250, 500, false, 60, 480, 509),
            SettingsEntity(fields(1), 0, 0, 150, 250, 500, false, 60, 480, 1_440),
        ).map(WaterBackupCodec::encode)
        wrong.forEach { assertRefused(listOf(it)) }
        // A flag that is neither 0 nor 1.
        val settings = WaterBackupCodec.encode(SettingsEntity(fields(1), 0, 0, 150, 250, 500, true, 60, 480, 1_320))
        assertRefused(listOf(BackupRecord("settings", settings.fields, settings.content.copyOf().also { it[13] = 2 })))
    }

    @Test
    fun aFileStopsTheRestore() {
        val drink = WaterBackupCodec.encode(IntakeEntity(fields(1), 0, 250, THE_DAY.asWaterDay(), 600))
        assertRefused(listOf(drink), files = 1)
    }

    /** The restore fails with [UnreadableBackupException], and the database is as it was. */
    private fun assertRefused(records: List<BackupRecord>, files: Int = 0) {
        runBlocking { repository.addDrink(THE_DAY, 300, 150) }
        val before = everything(database)
        assertThrows(UnreadableBackupException::class.java) { restore(content, records, files) }
        assertEquals("nothing changed", before, everything(database))
    }

    // A whole backup through core/backup.

    @Test
    fun aBackupWrittenByOneAppIsRestoredOnAnotherWithTheSameRecoveryKey() = runBlocking {
        repository.addDrink(THE_DAY, 600, 250)
        repository.setGoal(THE_DAY, 2_500)
        repository.changeSettings { it.copy(remindersOn = true, intervalMinutes = 90) }
        Documents.folder = temporary.newFolder()
        Robolectric.setupContentProvider(Documents::class.java, AUTHORITY)
        val document = Uri.parse("content://$AUTHORITY/water-2026-11-13.shkbackup")
        val keys = SoftwareKeysApp(temporary.newFolder(), WATER)
        val recoveryKey = keys.crypto.setup.createRecoveryKey().also { keys.crypto.setup.storeDerivedKeys(it) }

        val written = backupsOf(keys, content).export(document)
        assertEquals(ExportResult.Written(records = 3, files = 0, filesLeftOut = 0), written)

        val newPhone = SoftwareKeysApp(temporary.newFolder(), WATER).also { it.crypto.setup.storeDerivedKeys(recoveryKey) }
        val other = otherDatabase()
        val restored = backupsOf(newPhone, WaterBackupContent(other, clock, TestIdSource())).restore(document)
        assertTrue(restored is RestoreResult.Restored)
        assertEquals(everything(database), everything(other))
    }

    private fun backupsOf(keys: SoftwareKeysApp, content: WaterBackupContent) =
        Backups(context.contentResolver, keys.crypto.backups, WATER, content, temporary.newFolder(), clock, Dispatchers.IO)

    /** Collects what Water lists into a backup. */
    private class ListingSink : BackupSink {
        val records = mutableListOf<BackupRecord>()
        val leftOut = mutableListOf<Long>()

        override suspend fun record(record: BackupRecord) {
            records += record
        }

        override suspend fun file(id: String, length: Long, content: InputStream) = error("Water lists no files")

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

    /** Documents of the system file picker, as files behind a content provider of the test. */
    class Documents : ContentProvider() {
        override fun onCreate(): Boolean = true

        override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor =
            ParcelFileDescriptor.open(File(folder, uri.lastPathSegment!!), ParcelFileDescriptor.parseMode(mode))

        override fun getType(uri: Uri): String? = null

        override fun query(uri: Uri, columns: Array<String>?, where: String?, arguments: Array<String>?, order: String?): Cursor? = null

        override fun insert(uri: Uri, values: ContentValues?): Uri? = null

        override fun delete(uri: Uri, where: String?, arguments: Array<String>?): Int = 0

        override fun update(uri: Uri, values: ContentValues?, where: String?, arguments: Array<String>?): Int = 0

        companion object {
            lateinit var folder: File
        }
    }

    private companion object {
        val WATER: AppName = AppName.of("water")
        const val AUTHORITY = "app.shkriuss.feature.water.test.documents"
    }
}
