package app.shkriuss.feature.tasks

import android.database.SQLException
import android.net.Uri
import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.backup.BackupSink
import app.shkriuss.core.backup.Backups
import app.shkriuss.core.backup.CheckResult
import app.shkriuss.core.backup.CheckedBackup
import app.shkriuss.core.backup.CheckedFile
import app.shkriuss.core.backup.ExportResult
import app.shkriuss.core.backup.RestoreResult
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.data.RecordTimes
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.tasks.data.TaskEntity
import app.shkriuss.feature.tasks.data.TaskListEntity
import app.shkriuss.feature.tasks.data.TasksDatabase
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
import org.robolectric.RobolectricTestRunner

/**
 * Tasks' records in a backup (docs/apps/tasks/spec.md, "Backup
 * contents"): the byte layout of the spec's example, the list of every
 * record, the restore by the rule "the newest edit wins", what a restore
 * refuses, and a whole backup written and restored through `Backups` of
 * core/backup.
 */
@RunWith(RobolectricTestRunner::class)
class TasksBackupContentTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val database: TasksDatabase = memoryDatabase()
    private val clock = clockAt(monday(9, 30))
    private val ids = TestIdSource()
    private val repository = TasksRepository(database, clock, ids, TasksTime(clock) { UTC }, emptyBook(), work = Dispatchers.Unconfined)
    private val content = TasksBackupContent(database, clock, ids)
    private val others = mutableListOf<TasksDatabase>()

    @After
    fun closeTheDatabases() {
        database.close()
        others.forEach { it.close() }
    }

    private fun otherDatabase(): TasksDatabase = memoryDatabase().also { others += it }

    /** Record fields of a backup. Their IDs are not those the repository of the test hands out. */
    private fun fields(number: Long, updatedAt: Long = 1_000 + number, deletedAt: Long? = null) =
        RecordFields(TestIdSource.idNumber(100 + number), 1_000, updatedAt, deletedAt)

    private fun listRow(name: String = "Home", fields: RecordFields = fields(50)) = TaskListEntity(fields, 0, name)

    /** By default "Pills": every day from Monday, due Monday at 09:00, in Inbox, open. */
    private fun taskRow(
        title: String = "Pills",
        listId: String = INBOX,
        dueDay: Int? = MONDAY_DAY,
        repeat: Int = Repeat.DAILY.code,
        weekdays: Int = Weekdays.NONE,
        repeatFrom: Int? = MONDAY_DAY,
        remindMinute: Int? = 540,
        doneAt: Long? = null,
        fields: RecordFields = fields(1),
    ) = TaskEntity(fields, 0, listId, title, dueDay, repeat, weekdays, repeatFrom, remindMinute, doneAt)

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    private fun String.fromHex(): ByteArray = replace(" ", "").chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    /** What a database holds, deleted records included, without the change numbers. */
    private fun everything(of: TasksDatabase): List<String> = runBlocking {
        of.lists().all().map { it.copy(changeNumber = 0).toString() } + of.tasks().all().map { it.copy(changeNumber = 0).toString() }
    }.sorted()

    private fun listed(): List<BackupRecord> {
        val sink = ListingSink()
        runBlocking { content.list(sink) }
        assertEquals("Tasks leaves no file out", listOf(0L), sink.leftOut)
        return sink.records
    }

    private fun restore(into: TasksBackupContent, records: List<BackupRecord>, files: Int = 0) =
        runBlocking { into.restore(ListedBackup(records, files)) }

    // The content.

    @Test
    fun theExampleOfTheSpecIsItsBytes() {
        // "Home", and "Call the bank" in Inbox, due 2026-11-16, no reminder, done at 14:05 in Tbilisi.
        val home = listRow("Home")
        val doneAt = monday(14, 5).atZone(TBILISI).toInstant().toEpochMilli()
        val bank = taskRow("Call the bank", repeat = 0, repeatFrom = null, remindMinute = null, doneAt = doneAt)
        val bankHex = "00000000000000000000000000000000 00 00 00005125 ffffffff ffffffff 000001a1e3d130e0 000d 43616c6c207468652062616e6b"

        assertEquals("0004486f6d65", TasksBackupCodec.encode(home).content.toHex())
        assertEquals(bankHex.replace(" ", ""), TasksBackupCodec.encode(bank).content.toHex())
        assertEquals("task_list", TasksBackupCodec.encode(home).type)
        assertEquals("task", TasksBackupCodec.encode(bank).type)
        assertEquals(home, TasksBackupCodec.decodeList(BackupRecord("task_list", home.record, "0004 486f6d65".fromHex())))
        assertEquals(bank, TasksBackupCodec.decodeTask(BackupRecord("task", bank.record, bankHex.fromHex())))
    }

    @Test
    fun aListIdIsTheSixteenBytesOfItsUuidAndEveryValueGoesBothWays() {
        val listId = "0f8fad5b-d9cb-469f-a165-70867728950e"
        // "Gym", every Mon, Wed and Fri from Monday, due Wednesday at 18:30, in a list.
        val gym = taskRow("Gym", listId, MONDAY_DAY + 2, Repeat.WEEKLY.code, 0x15, MONDAY_DAY, 1_110)
        val record = TasksBackupCodec.encode(gym)

        assertEquals("0f8fad5bd9cb469fa16570867728950e 02 15 00005127 00005125 00000456 ffffffffffffffff 0003 47796d".replace(" ", ""), record.content.toHex())
        assertEquals(gym, TasksBackupCodec.decodeTask(record))
    }

    @Test
    fun aNameAndATitleAreTheirUtf8Bytes() {
        // One bell: four bytes.
        val bell = taskRow("🔔")
        val record = TasksBackupCodec.encode(bell)
        assertEquals(40 + 4, record.content.size)
        assertEquals("0004f09f9494", record.content.copyOfRange(38, 44).toHex())
        assertEquals(bell, TasksBackupCodec.decodeTask(record))

        // 200 of them: 800 bytes, the most a title can take. 60 for a name: 240 bytes.
        val longest = taskRow("🔔".repeat(200))
        assertEquals(40 + 800, TasksBackupCodec.encode(longest).content.size)
        assertEquals(longest, TasksBackupCodec.decodeTask(TasksBackupCodec.encode(longest)))
        val longestName = listRow("🔔".repeat(60))
        assertEquals(2 + 240, TasksBackupCodec.encode(longestName).content.size)
        assertEquals(longestName, TasksBackupCodec.decodeList(TasksBackupCodec.encode(longestName)))
    }

    // Writing.

    @Test
    fun theBackupListsEveryListAndTaskDeletedOnesTooEachOnce() = runBlocking {
        val home = repository.addList("Home")!!
        val old = repository.addList("Old")!!
        val kept = repository.addTask(NewTask("Pills", home.id, Due(MONDAY, PILLS, 540)))!!
        val deleted = repository.addTask(NewTask("Gym", INBOX, null))!!
        repository.deleteTask(deleted.id)
        repository.deleteList(old.id)

        val records = listed()

        assertEquals(listOf("task_list", "task_list", "task", "task"), records.map { it.type })
        val deletedRecord = records.single { it.fields.id == deleted.id }
        assertTrue("a deleted task keeps its marker", deletedRecord.fields.deletedAt != null)
        assertEquals("and its full content", 40 + 3, deletedRecord.content.size)
        assertTrue("a deleted list keeps its marker", records.single { it.fields.id == old.id }.fields.deletedAt != null)
        assertEquals(database.tasks().find(kept.id)!!.record, records.single { it.fields.id == kept.id }.fields)
        assertEquals(1, content.dataVersion)
    }

    // Reading.

    @Test
    fun aRestoreIntoAnEmptyAppGivesExactlyWhatTheBackupHolds() = runBlocking {
        val home = repository.addList("Home")!!
        repository.addTask(NewTask("Pills", home.id, Due(MONDAY, PILLS, 540)))
        repository.deleteTask(repository.addTask(NewTask("Gym", INBOX, Due(day(2), GYM, 1_110)))!!.id)
        repository.addTask(NewTask("Call the bank", INBOX, Due(MONDAY)))!!.also { repository.tick(it.id, MONDAY, Repeat.ONCE) }
        repository.deleteList(repository.addList("Old")!!.id)
        val other = otherDatabase()

        restore(TasksBackupContent(other, clock, TestIdSource()), listed())

        assertEquals(everything(database), everything(other))
    }

    @Test
    fun theNewestEditWinsAndTheSameBackupTwiceChangesNothing() = runBlocking {
        val home = repository.addList("Home")!!
        val pills = repository.addTask(NewTask("Pills", INBOX, null))!!
        val backup = listed()
        clock.advanceBy(60_000)
        repository.changeTask(pills.id, TaskEdit(title = "Vitamins"))
        repository.renameList(home.id, "House")
        val newer = everything(database)

        restore(content, backup)
        assertEquals("the edits after the backup are newer, so they stay", newer, everything(database))

        val other = otherDatabase()
        val otherContent = TasksBackupContent(other, clock, TestIdSource())
        restore(otherContent, backup)
        val once = everything(other)
        val numbers = runBlocking { other.tasks().all().map { it.changeNumber } + other.lists().all().map { it.changeNumber } }
        restore(otherContent, backup)
        assertEquals("nothing is written the second time", once, everything(other))
        assertEquals(numbers, runBlocking { other.tasks().all().map { it.changeNumber } + other.lists().all().map { it.changeNumber } })
    }

    @Test
    fun aTaskWhoseListIsNotInTheBackupIsTakenAndShowsInInbox() = runBlocking {
        // Only a restore, or later sync, makes such a task (spec, "Data", point 2).
        val gone = "0f8fad5b-d9cb-469f-a165-70867728950e"

        restore(content, listOf(TasksBackupCodec.encode(taskRow(listId = gone))))

        assertEquals("its listId stays as it is", gone, database.tasks().all().single().listId)
    }

    @Test
    fun afterTheRestoreItHandsOnTheTasksItTookAndOnlyThose() = runBlocking {
        repository.addList("Home")
        val kept = repository.addTask(NewTask("Kept", INBOX, null))!!
        val changed = repository.addTask(NewTask("Changed", INBOX, null))!!
        val backup = listed()
        val stored = backup.first { it.fields.id == changed.id }
        val newer = BackupRecord(stored.type, stored.fields.copy(updatedAt = stored.fields.updatedAt + 60_000), stored.content)
        val gone = TasksBackupCodec.encode(taskRow(title = "Gone", fields = fields(1, deletedAt = 5_000)))
        val newList = TasksBackupCodec.encode(listRow("Work"))
        val handed = mutableListOf<List<String>>()

        restore(TasksBackupContent(database, clock, ids) { handed += it }, backup.map { if (it == stored) newer else it } + gone + newList)

        // "Kept" has the same updatedAt as the backup, so it is not taken. A newer edit and a new task are, deleted or not.
        // A list is no task: it is taken, and not handed on.
        assertEquals("handed on once, after the transaction", 1, handed.size)
        assertEquals(setOf(changed.id, gone.fields.id), handed.single().toSet())
        assertTrue(kept.id !in handed.single())
        assertEquals(listOf("Home", "Work"), database.lists().all().map { it.name }.sorted())
    }

    @Test
    fun aRestoreThatIsRefusedHandsOnNothing() {
        val handed = mutableListOf<List<String>>()
        val refusing = TasksBackupContent(database, clock, ids) { handed += it }
        val good = TasksBackupCodec.encode(taskRow())

        assertThrows(UnreadableBackupException::class.java) { restore(refusing, listOf(good, BackupRecord("reminder", fields(2), good.content))) }

        assertEquals(emptyList<List<String>>(), handed)
    }

    @Test
    fun aReadThatTheDatabaseRefusesAfterTheTransactionLeavesTheRestoreStanding() {
        // As TasksRepository.afterRestore when its read of the tasks fails: the records are written by then.
        val failingAfter = TasksBackupContent(database, clock, ids) { throw SQLException("refused") }

        restore(failingAfter, listOf(TasksBackupCodec.encode(listRow("Home")), TasksBackupCodec.encode(taskRow())))

        assertEquals(listOf("Home"), runBlocking { database.lists().all() }.map { it.name })
        assertEquals(listOf("Pills"), runBlocking { database.tasks().all() }.map { it.title })
    }

    @Test
    fun aRecordOfAnotherTypeStopsTheRestoreAndNothingChanges() {
        val good = TasksBackupCodec.encode(taskRow())
        assertRefused(listOf(good, BackupRecord("reminder", fields(2), good.content)))
    }

    @Test
    fun aContentOfAnotherLengthStopsTheRestore() {
        val task = TasksBackupCodec.encode(taskRow())
        listOf(
            task.content + 0,
            task.content.copyOf(task.content.size - 1),
            task.content.copyOf(39),
            ByteArray(0),
        ).forEach { assertRefused(listOf(BackupRecord("task", task.fields, it))) }
        val list = TasksBackupCodec.encode(listRow())
        listOf(
            list.content + 0,
            list.content.copyOf(list.content.size - 1),
            list.content.copyOf(1),
            ByteArray(0),
        ).forEach { assertRefused(listOf(BackupRecord("task_list", list.fields, it))) }
    }

    @Test
    fun aValueOutsideItsLimitsStopsTheRestore() {
        listOf(
            taskRow(repeat = 5),
            taskRow(repeat = 255),
            taskRow(dueDay = -2),
            taskRow(dueDay = TaskLimits.DAYS.last + 1, repeat = 0, repeatFrom = null),
            taskRow(remindMinute = -2),
            taskRow(remindMinute = 1_440),
            taskRow(doneAt = -2),
            taskRow(doneAt = RecordTimes.LAST_MILLIS + 1),
            // The rules that join two values: a repeat, days, a day to count from or a reminder without a due day.
            taskRow(dueDay = null, repeatFrom = null, remindMinute = null),
            taskRow(dueDay = null, repeat = 0, weekdays = 1, repeatFrom = null, remindMinute = null),
            taskRow(dueDay = null, repeat = 0, repeatFrom = null),
            taskRow(dueDay = null, repeat = 0, remindMinute = null),
            // Days for a repeat other than every week, and none for every week.
            taskRow(repeat = Repeat.WEEKLY.code, weekdays = 0),
            taskRow(repeat = Repeat.WEEKLY.code, weekdays = 128),
            taskRow(weekdays = 1),
            // repeatFrom missing, out of place, or there with no repeat.
            taskRow(repeatFrom = null),
            taskRow(repeatFrom = MONDAY_DAY + 1),
            taskRow(repeat = 0, repeatFrom = MONDAY_DAY),
            // A due day that is not a date of its repeat: Gym is every Mon, Wed and Fri, and Tuesday is none.
            taskRow(dueDay = MONDAY_DAY + 1, repeat = Repeat.WEEKLY.code, weekdays = 0x15),
        ).forEach { assertRefused(listOf(TasksBackupCodec.encode(it))) }
    }

    @Test
    fun aListIdThatIsNeitherZeroNorAVersion4UuidStopsTheRestore() {
        val good = TasksBackupCodec.encode(taskRow()).content
        // A version 1 UUID, and one with the variant bits of another variant.
        listOf("0f8fad5bd9cb169fa16570867728950e", "0f8fad5bd9cb469f716570867728950e").forEach { id ->
            assertRefused(listOf(BackupRecord("task", fields(1), id.fromHex() + good.copyOfRange(16, good.size))))
        }
    }

    @Test
    fun aNameOrATitleOutsideItsLimitsStopsTheRestore() {
        listOf("", " Pills", "Pills ", "Two\nlines", "x".repeat(201))
            .forEach { assertRefused(listOf(TasksBackupCodec.encode(taskRow(title = it)))) }
        listOf("", " Home", "Home ", "Two\nlines", "x".repeat(61))
            .forEach { assertRefused(listOf(TasksBackupCodec.encode(listRow(name = it)))) }
    }

    @Test
    fun aNameOrATitleThatIsNotUtf8StopsTheRestore() {
        val fixed = TasksBackupCodec.encode(taskRow()).content.copyOf(38).toHex()
        // n = 2, then a lone continuation byte and a byte that never occurs in UTF-8; n = 3, then half of a pair.
        listOf("0002 80ff", "0003 eda080").forEach { title ->
            assertRefused(listOf(BackupRecord("task", fields(1), (fixed + title).fromHex())))
            assertRefused(listOf(BackupRecord("task_list", fields(50), title.fromHex())))
        }
    }

    @Test
    fun theFirstAndTheLastDayAreRestored() = runBlocking {
        val first = taskRow(dueDay = 0, repeatFrom = 0)
        val last = taskRow(dueDay = TaskLimits.DAYS.last, repeat = 0, repeatFrom = null, fields = fields(2))
        restore(content, listOf(TasksBackupCodec.encode(first), TasksBackupCodec.encode(last)))

        assertEquals(listOf(0, TaskLimits.DAYS.last), database.tasks().all().map { it.dueDay }.sortedBy { it })
    }

    @Test
    fun aRecordTimeThatNoRecordCanHoldStopsTheRestore() {
        val id = TestIdSource.idNumber(101)
        listOf(
            RecordFields(id, createdAt = -1, updatedAt = 1_000, deletedAt = null),
            RecordFields(id, createdAt = 1_000, updatedAt = RecordTimes.LAST_MILLIS + 1, deletedAt = null),
            RecordFields(id, createdAt = 1_000, updatedAt = 2_000, deletedAt = Long.MAX_VALUE),
        ).forEach {
            assertRefused(listOf(TasksBackupCodec.encode(taskRow(fields = it))))
            assertRefused(listOf(TasksBackupCodec.encode(listRow(fields = it))))
        }
    }

    @Test
    fun aRecordThatIsThereTwiceInOneTypeStopsTheRestore() {
        // The same ID again, with a newer deletion: the question counted one task, and the restore would end with none.
        val live = TasksBackupCodec.encode(taskRow())
        val deleted = TasksBackupCodec.encode(taskRow(fields = fields(1, updatedAt = 5_000, deletedAt = 5_000)))
        assertRefused(listOf(live, deleted))
        assertRefused(listOf(TasksBackupCodec.encode(listRow()), TasksBackupCodec.encode(listRow("Work"))))
    }

    @Test
    fun aListAndATaskMayHaveTheSameId() = runBlocking {
        // The spec refuses an ID twice in one type only.
        restore(content, listOf(TasksBackupCodec.encode(listRow(fields = fields(1))), TasksBackupCodec.encode(taskRow(fields = fields(1)))))

        assertEquals(1, database.lists().all().size)
        assertEquals(1, database.tasks().all().size)
    }

    @Test
    fun aFileStopsTheRestore() {
        assertRefused(listOf(TasksBackupCodec.encode(taskRow())), files = 1)
    }

    @Test
    fun anotherDataVersionStopsTheRestore() {
        val backup = object : CheckedBackup by ListedBackup(listOf(TasksBackupCodec.encode(taskRow())), 0) {
            override val dataVersion = 2
        }
        assertThrows(UnreadableBackupException::class.java) { runBlocking { content.restore(backup) } }
    }

    /** The restore fails with [UnreadableBackupException], and the database is as it was. */
    private fun assertRefused(records: List<BackupRecord>, files: Int = 0) {
        runBlocking { repository.addTask(NewTask("Already here", INBOX, null)) }
        val before = everything(database)
        assertThrows(UnreadableBackupException::class.java) { restore(content, records, files) }
        assertEquals("nothing changed", before, everything(database))
    }

    // A whole backup through core/backup.

    @Test
    fun aBackupWrittenByOneAppIsRestoredOnAnotherWithTheSameRecoveryKey() = runBlocking {
        val home = repository.addList("Home")!!
        repository.addTask(NewTask("Pills", home.id, Due(MONDAY, PILLS, 540)))
        repository.addTask(NewTask("Gym", INBOX, Due(day(2), GYM, 1_110)))
        pickerDocumentsIn(temporary.newFolder())
        val document: Uri = TestDocuments.uri("tasks-2026-11-16.shkbackup")
        val keys = SoftwareKeysApp(temporary.newFolder(), TasksServices.APP_NAME)
        val recoveryKey = keys.crypto.setup.createRecoveryKey().also { keys.crypto.setup.storeDerivedKeys(it) }

        val written = backupsOf(keys, content).export(document)
        assertEquals(
            ExportResult.Written(records = 3, files = 0, filesLeftOut = 0, notDeleted = mapOf("task_list" to 1L, "task" to 2L), madeAt = clock.nowMillis()),
            written,
        )

        val newPhone = SoftwareKeysApp(temporary.newFolder(), TasksServices.APP_NAME).also { it.crypto.setup.storeDerivedKeys(recoveryKey) }
        val other = otherDatabase()
        val onTheNewPhone = backupsOf(newPhone, TasksBackupContent(other, clock, TestIdSource()))
        val shown = (onTheNewPhone.check(document) as CheckResult.Good).backup
        val restored = onTheNewPhone.restore(document, shown)
        assertTrue(restored is RestoreResult.Restored)
        assertEquals(everything(database), everything(other))
    }

    private fun backupsOf(keys: SoftwareKeysApp, content: TasksBackupContent) =
        Backups(context.contentResolver, keys.crypto.backups, TasksServices.APP_NAME, content, temporary.newFolder(), clock, Dispatchers.IO)

    /** Collects what Tasks lists into a backup. */
    private class ListingSink : BackupSink {
        val records = mutableListOf<BackupRecord>()
        val leftOut = mutableListOf<Long>()

        override suspend fun record(record: BackupRecord) {
            records += record
        }

        override suspend fun file(id: String, length: Long, content: InputStream) = error("Tasks lists no files")

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

    private companion object {
        /** Monday 16 November 2026, in days since 1970-01-01. */
        val MONDAY_DAY: Int = MONDAY.toEpochDay().toInt()
    }
}
