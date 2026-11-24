package app.shkriuss.feature.tasks

import android.net.Uri
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.security.RecoveryKeyNeed
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.core.testing.TestIdSource
import java.io.File
import java.io.FileNotFoundException
import java.time.LocalDateTime
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Backup and restore as Settings drives them (docs/apps/tasks/spec.md,
 * "As in Water and Reminders" and "Backup contents"), with real keys on
 * the stand-in for the Keystore and the documents of a test file picker:
 * what the rows show about the keys, a backup that is written and then
 * checked, each answer for a file Tasks does not take, each failure, the
 * question before a restore, what follows a restore, and the file key
 * move.
 *
 * The keys are read at once on the test's thread. The database answers on
 * a thread of its own, so [write], [look] and [restore] wait until the
 * dialog that ends the step shows. The phone is in Tbilisi, on Monday 16
 * November 2026, as in the spec's examples.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = NotifyTestApp::class, qualifiers = "en-rGB")
class BackupViewModelTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val setup = AlarmsSetup().also { it.setClock(monday(14, 5)) }
    private val crypto get() = setup.keys.crypto
    private val repository get() = setup.repository
    private val model = BackupViewModel(setup.services.backups, Dispatchers.Unconfined)
    private val state get() = model.state.value
    private val document = TestDocuments.uri("tasks-2026-11-16.shkbackup")
    private val phones = mutableListOf<AnotherPhone>()

    /** "Pills": every day from Monday, due Monday at 09:00. */
    private val pills = Due(MONDAY, PILLS, 9 * 60)

    /** "Call the bank": once, due Monday at 10:00. */
    private val bank = Due(MONDAY, remindMinute = 10 * 60)

    /** Sunday 15 November 2026 at 20:00, the evening before the spec's Monday. */
    private val sundayEvening = day(-1).atTime(20, 0)

    @Before
    fun aFilePickerWithAFolder() = pickerDocumentsIn(temporary.newFolder())

    @After
    fun closeTheDatabases() {
        TestDocuments.onOpen = {}
        phones.forEach { it.close() }
        setup.database.close()
    }

    /** Another phone with the same recovery key as this one, unless [keys] are others. */
    private fun anotherPhone(keys: SoftwareKeysApp? = null): AnotherPhone =
        AnotherPhone(keys?.crypto ?: crypto, setup.clock, setup.zone).also { phones += it }

    /** Waits until no progress dialog shows any more: the work, also that on the database's thread, has ended. */
    private fun waitForTheEnd() {
        model.state.await { it.step != BackupStep.Writing && it.step != BackupStep.Checking && it.step != BackupStep.Restoring }
    }

    /** The user picked [to] for a new backup. Returns when the backup is written and checked, or has failed. */
    private fun write(to: Uri?) {
        model.write(to)
        waitForTheEnd()
    }

    /** The user picked [from] to restore. Returns when the file is checked. */
    private fun look(from: Uri?) {
        model.look(from)
        waitForTheEnd()
    }

    /** **Restore** at the question. Returns when the restore has ended. */
    private fun restore() {
        model.restore()
        waitForTheEnd()
    }

    /** The app gets its keys from a new recovery key, as the create flow stores them. */
    private fun giveKeys(): RecoveryKey = crypto.setup.createRecoveryKey().also { crypto.setup.storeDerivedKeys(it) }

    private fun keyFile(name: String) = File(setup.app.filesDir, "shk-keys/$name")

    /** Every list and task stored, deleted ones too, as text, without the change numbers. */
    private fun everything(): List<String> = runBlocking {
        val lists = setup.database.lists().all().map { it.copy(changeNumber = 0).toString() }
        val tasks = setup.database.tasks().all().map { it.copy(changeNumber = 0).toString() }
        (lists + tasks).sorted()
    }

    /** When the backup of the question was made, and how many tasks it holds, or null while no question shows. */
    private fun asked(): Pair<LocalDateTime, Long>? = (state.step as? BackupStep.Question)?.let { it.madeAt to it.tasks }

    /** The titles of the tasks that are not deleted. */
    private fun titles(): List<String> = runBlocking { repository.tasks().first() }.map { it.title }.sorted()

    /** The names of the lists that are not deleted. */
    private fun listNames(): List<String> = runBlocking { repository.lists().first() }.map { it.name }.sorted()

    /** A list, and three tasks, one of them deleted: two count. A list is no task, so it does not count either. */
    private fun twoTasksAndADeletedOne() {
        val home = checkNotNull(runBlocking { repository.addList("Home") })
        setup.add("Pills", pills, savedAt = monday(14, 5), listId = home.id)
        setup.add("Gym", Due(day(2), GYM, 18 * 60 + 30), savedAt = monday(14, 5))
        val gone = setup.add("Old", null, savedAt = monday(8))
        runBlocking { repository.deleteTask(gone.id) }
        setup.setClock(monday(14, 5))
    }

    // The rows of Settings.

    @Test
    fun beforeTheFirstReadNothingIsShown() {
        assertEquals(BackupScreen(), state)
        assertFalse(state.loaded)
    }

    @Test
    fun anAppWithNoRecoveryKeySaysNotSetUpAndTheAppLockIsOff() {
        model.refresh()

        assertEquals(BackupScreen(loaded = true, recoveryKey = RecoveryKeyLine.NOT_SET_UP, appLockOn = false), state)
    }

    @Test
    fun aSetupThatStoppedSaysSetupNotFinished() {
        giveKeys()
        assertTrue(keyFile("record").delete())

        model.refresh()

        assertEquals(RecoveryKeyLine.UNFINISHED, state.recoveryKey)
        assertFalse(state.appLockOn)
    }

    @Test
    fun withARecoveryKeyItSaysSetUpAndTheAppLockFollowsTheKeys() {
        val key = giveKeys()
        model.refresh()
        assertEquals(BackupScreen(loaded = true, recoveryKey = RecoveryKeyLine.SET_UP, appLockOn = false), state)

        // As on the way back from the app lock screen, where the user turned it on.
        crypto.appLock.beginTurnOn(checkNotNull(crypto.setup.checkAllWords(key))).finish()
        model.refresh()

        assertTrue(state.appLockOn)
        assertFalse("reading the keys never locks the app", crypto.appLock.isLocked())
    }

    // Going on, once the recovery key is there.

    @Test
    fun aBackupGoesOnToTheCreateDocumentScreenWithTheSuggestedName() {
        giveKeys()

        model.goOn(RecoveryKeyNeed.BACKUP)

        assertEquals(BackupOpen.NewDocument("tasks-2026-11-16.shkbackup"), state.open)
        assertEquals("the rows are read on the way", RecoveryKeyLine.SET_UP, state.recoveryKey)
        model.opened()
        assertNull(state.open)
    }

    @Test
    fun aRestoreGoesOnToTheOpenDocumentScreenAndTheAppLockToItsScreen() {
        giveKeys()

        model.goOn(RecoveryKeyNeed.RESTORE)
        assertEquals(BackupOpen.Document, state.open)
        model.opened()

        model.goOn(RecoveryKeyNeed.APP_LOCK)
        assertEquals(BackupOpen.AppLock, state.open)
    }

    @Test
    fun aSecondRequestBeforeTheFirstScreenOpenedIsIgnored() {
        giveKeys()

        model.goOn(RecoveryKeyNeed.BACKUP)
        // A tap on App lock while Settings waits for the file picker.
        model.goOn(RecoveryKeyNeed.APP_LOCK)

        assertEquals("only the first screen opens", BackupOpen.NewDocument("tasks-2026-11-16.shkbackup"), state.open)
        model.opened()
        model.goOn(RecoveryKeyNeed.APP_LOCK)
        assertEquals("once it opened, the next request goes on", BackupOpen.AppLock, state.open)
    }

    // Making a backup.

    @Test
    fun aBackupIsWrittenThenReadAgainAndCheckedAndSaysHowManyTasksItHolds() {
        giveKeys()
        twoTasksAndADeletedOne()
        val steps = CopyOnWriteArrayList<Pair<String, BackupStep?>>()
        TestDocuments.onOpen = { mode -> steps += mode to state.step }

        write(document)

        assertEquals(
            "written while \"Writing the backup\" shows, then read while \"Checking the backup\" shows",
            listOf("wt" to BackupStep.Writing, "r" to BackupStep.Checking),
            steps.toList(),
        )
        // A list and three tasks are in the file. The deleted task and the list do not count.
        assertEquals(BackupStep.Written(tasks = 2), state.step)
        assertTrue(TestDocuments.file("tasks-2026-11-16.shkbackup").length() > 0)

        model.close()
        assertNull(state.step)
    }

    @Test
    fun leavingThePickerWithoutAPlaceDoesNothing() {
        giveKeys()

        write(null)
        look(null)

        assertNull(state.step)
    }

    @Test
    fun withoutKeysNoBackupIsMadeAndNoFileIsLeft() {
        write(document)

        assertEquals(BackupStep.NoKeys, state.step)
        assertFalse(TestDocuments.file("tasks-2026-11-16.shkbackup").exists())
    }

    @Test
    fun aPlaceThatCannotBeWrittenSaysTheBackupCouldNotBeWritten() {
        giveKeys()
        TestDocuments.onOpen = { mode -> if (mode == "wt") throw FileNotFoundException("the storage app refuses") }

        write(document)

        assertEquals(BackupStep.NotWritten, state.step)
    }

    @Test
    fun anOlderCopyThatTheStorageAppHandsBackIsNotTakenForTheNewBackup() {
        giveKeys()
        twoTasksAndADeletedOne()
        write(document)
        assertEquals(BackupStep.Written(tasks = 2), state.step)
        model.close()
        val older = TestDocuments.file("tasks-2026-11-16.shkbackup").readBytes()
        setup.add("Dentist", bank, savedAt = monday(14, 6))
        // Right after the new backup is written, the storage app hands back the older copy, which also passes its check.
        TestDocuments.onOpen = { mode -> if (mode == "r") TestDocuments.file("tasks-2026-11-16.shkbackup").writeBytes(older) }

        write(document)

        assertEquals("not \"Backup written\" with the older copy's tasks", BackupStep.WrittenNotChecked, state.step)
    }

    @Test
    fun aFileThatCannotBeReadBackIsWrittenButNotChecked() {
        giveKeys()
        twoTasksAndADeletedOne()
        TestDocuments.onOpen = { mode -> if (mode == "r") throw FileNotFoundException("the storage app refuses to read") }

        write(document)

        assertEquals(BackupStep.WrittenNotChecked, state.step)
    }

    @Test
    fun aFileThatDoesNotPassItsCheckIsNamedAtOnce() {
        giveKeys()
        twoTasksAndADeletedOne()
        // The storage loses the end of the file between the write and the check.
        TestDocuments.onOpen = { mode ->
            if (mode == "r") {
                val file = TestDocuments.file("tasks-2026-11-16.shkbackup")
                file.writeBytes(file.readBytes().dropLast(10).toByteArray())
            }
        }

        write(document)

        assertEquals(BackupStep.WrittenNotUsable, state.step)
    }

    // Restoring a backup.

    @Test
    fun aGoodFileGivesTheQuestionAndRestoreTakesItsListsAndTasks() {
        giveKeys()
        setup.setClock(monday(9, 30))
        anotherPhone().apply {
            val home = addList("Home")
            add("Pills", pills, home.id)
            add("Gym", Due(day(2), GYM, 18 * 60 + 30))
            add("Call the bank", bank)
            writeBackup(document)
        }
        setup.setClock(monday(14, 5))
        val steps = CopyOnWriteArrayList<BackupStep?>()
        TestDocuments.onOpen = { steps += state.step }

        look(document)

        assertEquals("the whole file is checked first, while \"Checking the backup\" shows", listOf<BackupStep?>(BackupStep.Checking), steps.toList())
        assertEquals("made at 09:30 in Tbilisi, with 3 tasks", monday(9, 30) to 3L, asked())
        assertEquals("nothing is taken before the answer", emptyList<String>(), everything())

        restore()

        assertEquals("read again while \"Restoring the backup\" shows", listOf<BackupStep?>(BackupStep.Checking, BackupStep.Restoring), steps.toList())
        assertEquals(BackupStep.Restored, state.step)
        assertEquals(listOf("Call the bank", "Gym", "Pills"), titles())
        assertEquals(listOf("Home"), listNames())
        val home = runBlocking { repository.lists().first() }.single()
        assertEquals("a task is in its list again", home.id, runBlocking { repository.tasks().first() }.single { it.title == "Pills" }.listId)
    }

    @Test
    fun aFileThatChangedAfterTheQuestionIsAskedAboutAgainAndNothingIsTakenFirst() {
        giveKeys()
        setup.setClock(monday(9, 30))
        val phone = anotherPhone().apply {
            add("Pills", pills)
            writeBackup(document)
        }
        setup.setClock(monday(14, 5))
        look(document)
        assertEquals(monday(9, 30) to 1L, asked())

        // A storage app syncs a newer backup into the same file before Restore is tapped.
        setup.setClock(monday(14, 10))
        phone.add("Gym", Due(day(2), GYM, 18 * 60 + 30))
        phone.writeBackup(document)
        restore()

        assertEquals("asked again, with what the file holds now", monday(14, 10) to 2L, asked())
        assertEquals("nothing is taken before the new answer", emptyList<String>(), everything())

        restore()

        assertEquals(BackupStep.Restored, state.step)
        assertEquals(listOf("Gym", "Pills"), titles())
    }

    @Test
    fun cancelAtTheQuestionChangesNothing() {
        giveKeys()
        twoTasksAndADeletedOne()
        val before = everything()
        anotherPhone().apply {
            add("Pills", pills)
            writeBackup(document)
        }

        look(document)
        assertTrue(state.step is BackupStep.Question)
        model.close()

        assertNull(state.step)
        assertEquals(before, everything())
        // The file is no longer picked: Restore now does nothing.
        restore()
        assertNull(state.step)
        assertEquals(before, everything())
    }

    @Test
    fun aRestoreOnTheSamePhoneCannotUndoADeletionMadeAfterTheBackup() {
        giveKeys()
        val task = setup.add("Pills", pills, savedAt = monday(14, 5))
        write(document)
        model.close()
        setup.setClock(monday(15))
        runBlocking { repository.deleteTask(task.id) }

        look(document)
        assertEquals(monday(14, 5) to 1L, asked())
        restore()

        assertEquals(BackupStep.Restored, state.step)
        assertEquals("the deletion is the newer edit, so it stays", emptyList<String>(), titles())
    }

    // After a restore (spec, "Backup contents", point 3, and "Stopped between two writes").

    @Test
    fun aRestoreOnMondayAtNoonCountsEachTaskFromThenSoNoReminderOfTheMorningShows() {
        giveKeys()
        setup.setClock(sundayEvening)
        anotherPhone().apply {
            add("Pills", pills)
            add("Call the bank", bank)
            writeBackup(document)
        }
        assertEquals("no alarm yet on this phone", emptyList<Long>(), setup.waiting())

        setup.setClock(monday(12))
        look(document)
        restore()

        assertEquals("09:00 and 10:00 are dealt with: no missed reminder shows", emptyList<Long>(), setup.waiting())
        val restored = runBlocking { repository.tasks().first() }.associateBy { it.title }
        restored.values.forEach { assertNull(setup.shown(it)) }
        assertEquals(TaskEntry.countingFrom(checkNotNull(TaskReminders.numberOf(pills)), monday(12)), setup.entryOf(restored.getValue("Pills")))
        assertEquals(TaskEntry.countingFrom(checkNotNull(TaskReminders.numberOf(bank)), monday(12)), setup.entryOf(restored.getValue("Call the bank")))
    }

    @Test
    fun aTaskTheRestoreTookRemindsAtItsNextTimeAfterTheRestore() {
        giveKeys()
        setup.setClock(sundayEvening)
        anotherPhone().apply {
            add("Pills", pills)
            writeBackup(document)
        }

        setup.setClock(monday(8))
        look(document)
        restore()

        assertEquals("it reminds at 09:00, after the restore", listOf(setup.millisOf(monday(9))), setup.waiting())
    }

    @Test
    fun aTaskTheRestoreTookLosesItsNotificationAndItsSnooze() {
        giveKeys()
        // The other phone made "Pills" and a first backup, which this phone restored.
        setup.setClock(sundayEvening)
        val other = anotherPhone()
        val task = other.add("Pills", pills)
        other.writeBackup(document)
        look(document)
        restore()
        model.close()
        // On Monday it shows here at 09:00 and is snoozed until 09:12.
        setup.fireAt(monday(9))
        assertNotNull(setup.shown(task))
        setup.press(task, SNOOZE, monday(9, 2))
        assertEquals(setup.millisOf(monday(9, 12)), setup.entryOf(task).snoozeMillis)
        setup.fireAt(monday(9, 12))
        assertNotNull("the snooze ended, so it shows again", setup.shown(task))
        setup.press(task, SNOOZE, monday(9, 13))
        // The other phone gave it a new title, and made a second backup.
        setup.setClock(monday(9, 14))
        runBlocking { other.repository.changeTask(task.id, TaskEdit(title = "Vitamins")) }
        other.writeBackup(document)

        setup.setClock(monday(9, 15))
        look(document)
        restore()

        assertEquals(listOf("Vitamins"), titles())
        assertNull("its notification goes", setup.shown(task))
        val number = checkNotNull(TaskReminders.numberOf(pills))
        assertEquals("the snooze ends, and it counts from 09:15", TaskEntry.countingFrom(number, monday(9, 15)), setup.entryOf(task))
        assertEquals("09:00 is dealt with, and no snooze waits", emptyList<Long>(), setup.waiting())
    }

    @Test
    fun aTaskTheRestoreDidNotTakeKeepsItsSnooze() {
        giveKeys()
        val task = setup.add("Pills", pills, savedAt = sundayEvening)
        write(document)
        model.close()
        setup.fireAt(monday(9))
        setup.press(task, SNOOZE, monday(9, 2))
        val before = setup.entryOf(task)

        setup.setClock(monday(9, 5))
        look(document)
        restore()

        assertEquals(BackupStep.Restored, state.step)
        assertEquals("the same edit, so it is not taken", before, setup.entryOf(task))
        assertEquals("the snooze still ends at 09:12", listOf(setup.millisOf(monday(9, 12))), setup.waiting())
    }

    @Test
    fun aTaskTheRestoreTookDoneLosesItsEntriesAndItsNotification() {
        giveKeys()
        setup.setClock(sundayEvening)
        val other = anotherPhone()
        val task = other.add("Pills", bank)
        other.writeBackup(document)
        look(document)
        restore()
        model.close()
        setup.fireAt(monday(10))
        assertNotNull(setup.shown(task))
        // On the other phone it was ticked at 10:01.
        setup.setClock(monday(10, 1))
        runBlocking { other.repository.tick(task.id, MONDAY, Repeat.ONCE) }
        other.writeBackup(document)

        setup.setClock(monday(10, 2))
        look(document)
        restore()

        assertNotNull("done", setup.find(task)?.doneAt)
        assertNull("its notification goes", setup.shown(task))
        assertEquals("and its entries", TaskEntry(), setup.entryOf(task))
        assertEquals(emptyList<Long>(), setup.waiting())
    }

    // A file Tasks does not take: each answer of docs/user/backup.md.

    @Test
    fun aFileThatIsNoBackupIsNamed() {
        giveKeys()
        TestDocuments.file("photo.jpg").writeText("not a backup at all")

        look(TestDocuments.uri("photo.jpg"))

        assertEquals(BackupStep.Refused(BackupRefusal.NotABackup), state.step)
    }

    @Test
    fun aBackupOfANewerVersionIsNamed() {
        giveKeys()
        writeBackup(crypto, TasksServices.APP_NAME, OtherContent(dataVersion = 2, emptyList()), setup.clock, document)

        look(document)

        assertEquals(BackupStep.Refused(BackupRefusal.NewerVersion), state.step)
    }

    @Test
    fun aBackupOfAnotherAppIsNamedWithThatApp() {
        giveKeys()
        val reminders = SoftwareKeysApp(temporary.newFolder(), AppName.of("reminders"))
        reminders.crypto.setup.storeDerivedKeys(reminders.crypto.setup.createRecoveryKey())
        writeBackup(reminders.crypto, AppName.of("reminders"), OtherContent(dataVersion = 1, emptyList()), setup.clock, document)

        look(document)

        assertEquals(BackupStep.Refused(BackupRefusal.OtherApp("reminders")), state.step)
    }

    @Test
    fun aBackupMadeWithOtherWordsIsNamedWithTheShortNameOfItsKey() {
        giveKeys()
        val otherKeys = SoftwareKeysApp(temporary.newFolder(), TasksServices.APP_NAME)
        otherKeys.crypto.setup.storeDerivedKeys(otherKeys.crypto.setup.createRecoveryKey())
        anotherPhone(otherKeys).apply {
            add("Pills", pills)
            writeBackup(document)
        }

        look(document)

        val shortName = otherKeys.crypto.backups.keyId().toString()
        assertEquals(BackupStep.Refused(BackupRefusal.OtherRecoveryKey(shortName)), state.step)
        assertTrue("eight hex digits: $shortName", Regex("[0-9a-f]{8}").matches(shortName))
    }

    @Test
    fun withoutKeysARestoreSaysSo() {
        val otherKeys = SoftwareKeysApp(temporary.newFolder(), TasksServices.APP_NAME)
        otherKeys.crypto.setup.storeDerivedKeys(otherKeys.crypto.setup.createRecoveryKey())
        anotherPhone(otherKeys).apply {
            add("Pills", pills)
            writeBackup(document)
        }

        look(document)

        assertEquals(BackupStep.Refused(BackupRefusal.NoKeys), state.step)
    }

    @Test
    fun aFileThatIsCutShortIsNamedAsDamaged() {
        giveKeys()
        anotherPhone().apply {
            add("Pills", pills)
            writeBackup(document)
        }
        val file = TestDocuments.file("tasks-2026-11-16.shkbackup")
        file.writeBytes(file.readBytes().dropLast(1).toByteArray())

        look(document)

        assertEquals(BackupStep.Refused(BackupRefusal.Damaged), state.step)
    }

    // The three failures. In each, nothing in Tasks changes.

    @Test
    fun aFileThatCannotBeReadSaysSo() {
        giveKeys()
        TestDocuments.onOpen = { throw FileNotFoundException("the storage app refuses") }

        look(document)

        assertEquals(BackupStep.NotRead, state.step)
    }

    @Test
    fun aBackupWithSomethingTasksCannotReadIsRefusedAndNothingChanges() {
        giveKeys()
        twoTasksAndADeletedOne()
        val before = everything()
        val alarms = setup.waiting()
        val records = listOf(otherRecord("reminder", 1), otherRecord("reminder", 2))
        writeBackup(crypto, TasksServices.APP_NAME, OtherContent(dataVersion = 1, records), setup.clock, document)

        look(document)
        assertEquals("the file itself is whole, and holds no task", monday(14, 5) to 0L, asked())
        restore()

        assertEquals(BackupStep.Unreadable, state.step)
        assertEquals(before, everything())
        assertEquals(alarms, setup.waiting())
    }

    @Test
    fun whenTheBackupCannotBePutAsideThereIsNoRoomAndNothingChanges() {
        giveKeys()
        anotherPhone().apply {
            add("Pills", pills)
            writeBackup(document)
        }
        look(document)
        // The staging folder cannot be made: a file stands in its place.
        val staging = File(setup.app.noBackupFilesDir, "shk-restore")
        staging.deleteRecursively()
        staging.writeText("in the way")

        restore()

        assertEquals(BackupStep.NoRoom, state.step)
        assertEquals(emptyList<String>(), everything())
    }

    // The file key move (Water's spec, "Files", which Tasks follows).

    /** An app that made a file key before it had a recovery key: the old keyset waits to be moved. */
    private fun aFileKeyFromBeforeTheRecoveryKey() {
        crypto.files.wrap(TestIdSource.idNumber(1), crypto.files.newFileKey())
        giveKeys()
        assertTrue("the move is pending", crypto.setup.fileKeyMoveIsPending())
        assertFalse("and blocks a backup", crypto.backups.mayMakeBackup())
    }

    @Test
    fun aPendingFileKeyMoveIsFinishedWhenTheKeysAreRead() {
        aFileKeyFromBeforeTheRecoveryKey()

        model.refresh()

        assertFalse(crypto.setup.fileKeyMoveIsPending())
        assertTrue("a backup can be made", crypto.backups.mayMakeBackup())
        assertEquals(RecoveryKeyLine.SET_UP, state.recoveryKey)
    }

    @Test
    fun aPendingFileKeyMoveIsFinishedBeforeTasksGoesOn() {
        aFileKeyFromBeforeTheRecoveryKey()

        model.goOn(RecoveryKeyNeed.BACKUP)
        model.opened()
        write(document)

        assertEquals("the backup is not refused as \"not ready\"", BackupStep.Written(tasks = 0), state.step)
    }

    @Test
    fun withoutTheKeysOfARecoveryKeyThePendingMoveIsLeftAlone() {
        aFileKeyFromBeforeTheRecoveryKey()
        // The setup stopped: the old keyset is there, the keys of the recovery key are not.
        assertTrue(keyFile("record").delete())

        model.refresh()

        assertTrue("the old keyset stays", crypto.setup.fileKeyMoveIsPending())
        assertEquals(RecoveryKeyLine.UNFINISHED, state.recoveryKey)
    }

    @Test
    fun theStartOfTheAppFinishesAPendingFileKeyMove() {
        aFileKeyFromBeforeTheRecoveryKey()

        setup.services.start()

        assertFalse(crypto.setup.fileKeyMoveIsPending())
    }
}
