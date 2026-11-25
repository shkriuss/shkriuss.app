package app.shkriuss.feature.water

import android.net.Uri
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.notify.Alarm
import app.shkriuss.core.security.RecoveryKeyNeed
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.water.data.GoalEntity
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
 * Backup and restore as Settings drives them (docs/apps/water/spec.md,
 * "Backup and restore screens"), with real keys on the stand-in for the
 * Keystore and the documents of a test file picker: what the rows show
 * about the keys, a backup that is written and then checked, each answer
 * for a file Water does not take, each failure, the question before a
 * restore, and the file key move of "Files".
 *
 * The keys are read at once on the test's thread. The database answers on
 * a thread of its own, so [write], [look] and [restore] wait until the
 * dialog that ends the step shows. The local time is UTC, on Friday 13
 * November 2026.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = RemindersTestApp::class)
class BackupViewModelTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val clock = clockAt(at(14, 5))
    private val water = RemindersSetup(clock)
    private val crypto get() = water.keys.crypto
    private val repository get() = water.repository
    private val model = BackupViewModel(water.services.backups, Dispatchers.Unconfined)
    private val state get() = model.state.value
    private val document = TestDocuments.uri("water-2026-11-13.shkbackup")

    @Before
    fun aFilePickerWithAFolder() = pickerDocumentsIn(temporary.newFolder())

    @After
    fun closeTheDatabase() {
        TestDocuments.onOpen = {}
        water.database.close()
    }

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

    private fun keyFile(name: String) = File(water.app.filesDir, "shk-keys/$name")

    /** Everything stored, as text, without the change numbers. */
    /** When the backup of the question was made, and how many drinks it holds, or null while no question shows. */
    private fun asked(): Pair<LocalDateTime, Long>? = (state.step as? BackupStep.Question)?.let { it.madeAt to it.drinks }

    private fun everything(): List<String> = runBlocking {
        val database = water.database
        (database.intake().all().map { it.copy(changeNumber = 0).toString() } +
            database.goals().all().map { it.copy(changeNumber = 0).toString() } +
            database.settings().all().map { it.copy(changeNumber = 0).toString() }).sorted()
    }

    /** Three drinks, one of them deleted, a goal and a setting: five records, two of them drinks that count. */
    private fun twoDrinksAndMore() = runBlocking {
        repository.addDrink(THE_DAY, 8 * 60, 250)
        repository.addDrink(THE_DAY, 10 * 60, 300)
        val gone = repository.addDrink(THE_DAY, 12 * 60, 500)
        repository.deleteDrink(gone.id)
        repository.setGoal(THE_DAY, 2_500)
        repository.changeSettings { it.copy(cup1Ml = 200) }
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

        assertEquals(BackupOpen.NewDocument("water-2026-11-13.shkbackup"), state.open)
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

        assertEquals("only the first screen opens", BackupOpen.NewDocument("water-2026-11-13.shkbackup"), state.open)
        model.opened()
        model.goOn(RecoveryKeyNeed.APP_LOCK)
        assertEquals("once it opened, the next request goes on", BackupOpen.AppLock, state.open)
    }

    // Making a backup.

    @Test
    fun aBackupIsWrittenThenReadAgainAndCheckedAndSaysHowManyDrinksItHolds() {
        giveKeys()
        twoDrinksAndMore()
        val steps = CopyOnWriteArrayList<Pair<String, BackupStep?>>()
        TestDocuments.onOpen = { mode -> steps += mode to state.step }

        write(document)

        assertEquals(
            "written while \"Writing the backup\" shows, then read while \"Checking the backup\" shows",
            listOf("wt" to BackupStep.Writing, "r" to BackupStep.Checking),
            steps.toList(),
        )
        // Three drinks, a goal and a setting are in the file. The deleted drink, the goal and the setting are no drinks.
        assertEquals(BackupStep.Written(drinks = 2), state.step)
        assertTrue(TestDocuments.file("water-2026-11-13.shkbackup").length() > 0)

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
        assertFalse(TestDocuments.file("water-2026-11-13.shkbackup").exists())
    }

    @Test
    fun aPlaceThatCannotBeWrittenSaysTheBackupCouldNotBeWritten() {
        giveKeys()
        TestDocuments.onOpen = { mode -> if (mode == "wt") throw FileNotFoundException("the storage app refuses") }

        write(document)

        assertEquals(BackupStep.NotWritten, state.step)
    }

    @Test
    fun aFileThatCannotBeReadBackIsWrittenButNotChecked() {
        giveKeys()
        twoDrinksAndMore()
        TestDocuments.onOpen = { mode -> if (mode == "r") throw FileNotFoundException("the storage app refuses to read") }

        write(document)

        assertEquals(BackupStep.WrittenNotChecked, state.step)
    }

    @Test
    fun anOlderCopyThatTheStorageAppHandsBackIsNotTakenForTheNewBackup() {
        giveKeys()
        twoDrinksAndMore()
        write(document)
        assertEquals(BackupStep.Written(drinks = 2), state.step)
        model.close()
        val older = TestDocuments.file("water-2026-11-13.shkbackup").readBytes()
        runBlocking { repository.addDrink(THE_DAY, 13 * 60, 150) }
        clock.advanceBy(60_000)
        // Right after the new backup is written, the storage app hands back the older copy, which also passes its check.
        TestDocuments.onOpen = { mode -> if (mode == "r") TestDocuments.file("water-2026-11-13.shkbackup").writeBytes(older) }

        write(document)

        assertEquals("not \"Backup written\" with the older copy's drinks", BackupStep.WrittenNotChecked, state.step)
    }

    @Test
    fun aFileThatDoesNotPassItsCheckIsNamedAtOnce() {
        giveKeys()
        twoDrinksAndMore()
        // The storage loses the end of the file between the write and the check.
        TestDocuments.onOpen = { mode ->
            if (mode == "r") {
                val file = TestDocuments.file("water-2026-11-13.shkbackup")
                file.writeBytes(file.readBytes().dropLast(10).toByteArray())
            }
        }

        write(document)

        assertEquals(BackupStep.WrittenNotUsable, state.step)
    }

    // Restoring a backup.

    @Test
    fun aGoodFileGivesTheQuestionAndRestoreTakesItsRecords() {
        giveKeys()
        clock.setTo(at(9, 30))
        backupOfAnotherPhone(crypto, clock, document) {
            addDrink(THE_DAY, 7 * 60, 150)
            addDrink(THE_DAY, 8 * 60, 250)
            addDrink(THE_DAY, 9 * 60, 300)
            setGoal(THE_DAY, 3_000)
        }
        clock.setTo(at(14, 5))
        val steps = CopyOnWriteArrayList<BackupStep?>()
        TestDocuments.onOpen = { steps += state.step }

        look(document)

        assertEquals("the whole file is checked first, while \"Checking the backup\" shows", listOf<BackupStep?>(BackupStep.Checking), steps.toList())
        assertEquals(at(9, 30) to 3L, asked())
        assertEquals("nothing is taken before the answer", emptyList<String>(), everything())

        restore()

        assertEquals("read again while \"Restoring the backup\" shows", listOf<BackupStep?>(BackupStep.Checking, BackupStep.Restoring), steps.toList())
        assertEquals(BackupStep.Restored, state.step)
        assertEquals(listOf(300, 250, 150), runBlocking { repository.drinksOf(THE_DAY).first() }.map { it.amountMl })
        assertEquals(3_000, runBlocking { repository.factsOf(THE_DAY) }.goalMl)
    }

    @Test
    fun aFileThatChangedAfterTheQuestionIsAskedAboutAgainAndNothingIsTakenFirst() {
        giveKeys()
        clock.setTo(at(9, 30))
        backupOfAnotherPhone(crypto, clock, document) { addDrink(THE_DAY, 7 * 60, 150) }
        clock.setTo(at(14, 5))
        look(document)
        assertEquals(at(9, 30) to 1L, asked())

        // A storage app syncs a newer backup into the same file before Restore is tapped.
        clock.setTo(at(14, 10))
        backupOfAnotherPhone(crypto, clock, document) {
            addDrink(THE_DAY, 7 * 60, 150)
            addDrink(THE_DAY, 8 * 60, 250)
        }
        restore()

        assertEquals("asked again, with what the file holds now", at(14, 10) to 2L, asked())
        assertEquals("nothing is taken before the new answer", emptyList<String>(), everything())

        restore()

        assertEquals(BackupStep.Restored, state.step)
        assertEquals(listOf(250, 150), runBlocking { repository.drinksOf(THE_DAY).first() }.map { it.amountMl })
    }

    @Test
    fun cancelAtTheQuestionChangesNothing() {
        giveKeys()
        twoDrinksAndMore()
        val before = everything()
        backupOfAnotherPhone(crypto, clock, document) { addDrink(THE_DAY, 7 * 60, 150) }

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
        val drink = runBlocking { repository.addDrink(THE_DAY, 8 * 60, 250) }
        write(document)
        model.close()
        clock.setTo(at(15, 0))
        runBlocking { repository.deleteDrink(drink.id) }

        look(document)
        assertEquals(at(14, 5) to 1L, asked())
        restore()

        assertEquals(BackupStep.Restored, state.step)
        assertEquals("the deletion is the newer edit, so it stays", emptyList<Drink>(), runBlocking { repository.drinksOf(THE_DAY).first() })
    }

    @Test
    fun afterARestoreTheRemindersFollowTheRestoredData() {
        giveKeys()
        backupOfAnotherPhone(crypto, clock, document) { changeSettings { it.copy(remindersOn = true) } }
        assertEquals("no reminders yet on this phone", emptyList<Long>(), water.waiting())

        look(document)
        restore()

        assertEquals("the alarm of the restored settings", listOf(water.millisOf(at(15, 0))), water.waiting())
    }

    @Test
    fun aRestoreStandsWhenTheRemindersCannotReadTheDatabaseAfterIt() {
        giveKeys()
        backupOfAnotherPhone(crypto, clock, document) { addDrink(THE_DAY, 7 * 60, 150) }
        // A reminder shows, so after the restore the reminders read today's goal to see whether it still fits.
        runBlocking { repository.changeSettings { it.copy(remindersOn = true) } }
        clock.setTo(at(15, 0))
        water.reminders.onAlarm(Alarm(WaterReminders.ALARM, water.millisOf(at(15, 0))), water.app.notify.notifications)
        assertNotNull(water.reminder())
        look(document)
        water.database.refuseReadsOf(GoalEntity.TABLE)

        restore()

        assertEquals(BackupStep.Restored, state.step)
        assertEquals(listOf(150), runBlocking { water.database.intake().all() }.map { it.amountMl })
        assertNotNull("the reminder stays until the next change", water.reminder())
    }

    // A file Water does not take: each answer of docs/user/backup.md.

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
        writeBackup(crypto, WaterServices.APP_NAME, OtherContent(dataVersion = 2, emptyList()), clock, document)

        look(document)

        assertEquals(BackupStep.Refused(BackupRefusal.NewerVersion), state.step)
    }

    @Test
    fun aBackupOfAnotherAppIsNamedWithThatApp() {
        giveKeys()
        val notes = SoftwareKeysApp(temporary.newFolder(), AppName.of("notes"))
        notes.crypto.setup.storeDerivedKeys(notes.crypto.setup.createRecoveryKey())
        writeBackup(notes.crypto, AppName.of("notes"), OtherContent(dataVersion = 1, emptyList()), clock, document)

        look(document)

        assertEquals(BackupStep.Refused(BackupRefusal.OtherApp("notes")), state.step)
    }

    @Test
    fun aBackupMadeWithOtherWordsIsNamedWithTheShortNameOfItsKey() {
        giveKeys()
        val other = SoftwareKeysApp(temporary.newFolder(), WaterServices.APP_NAME)
        other.crypto.setup.storeDerivedKeys(other.crypto.setup.createRecoveryKey())
        backupOfAnotherPhone(other.crypto, clock, document) { addDrink(THE_DAY, 7 * 60, 150) }

        look(document)

        val shortName = other.crypto.backups.keyId().toString()
        assertEquals(BackupStep.Refused(BackupRefusal.OtherRecoveryKey(shortName)), state.step)
        assertTrue("eight hex digits: $shortName", Regex("[0-9a-f]{8}").matches(shortName))
    }

    @Test
    fun withoutKeysARestoreSaysSo() {
        val other = SoftwareKeysApp(temporary.newFolder(), WaterServices.APP_NAME)
        other.crypto.setup.storeDerivedKeys(other.crypto.setup.createRecoveryKey())
        backupOfAnotherPhone(other.crypto, clock, document) { addDrink(THE_DAY, 7 * 60, 150) }

        look(document)

        assertEquals(BackupStep.Refused(BackupRefusal.NoKeys), state.step)
    }

    @Test
    fun aFileThatIsCutShortIsNamedAsDamaged() {
        giveKeys()
        backupOfAnotherPhone(crypto, clock, document) { addDrink(THE_DAY, 7 * 60, 150) }
        val file = TestDocuments.file("water-2026-11-13.shkbackup")
        file.writeBytes(file.readBytes().dropLast(1).toByteArray())

        look(document)

        assertEquals(BackupStep.Refused(BackupRefusal.Damaged), state.step)
    }

    // The three failures. In each, nothing in Water changes.

    @Test
    fun aFileThatCannotBeReadSaysSo() {
        giveKeys()
        TestDocuments.onOpen = { throw FileNotFoundException("the storage app refuses") }

        look(document)

        assertEquals(BackupStep.NotRead, state.step)
    }

    @Test
    fun aBackupWithSomethingWaterCannotReadIsRefusedAndNothingChanges() {
        giveKeys()
        twoDrinksAndMore()
        val before = everything()
        val records = listOf(otherRecord("note", 1), otherRecord("note", 2))
        writeBackup(crypto, WaterServices.APP_NAME, OtherContent(dataVersion = 1, records), clock, document)

        look(document)
        assertEquals("the file itself is whole, and holds no drink", at(14, 5) to 0L, asked())
        restore()

        assertEquals(BackupStep.Unreadable, state.step)
        assertEquals(before, everything())
    }

    @Test
    fun whenTheBackupCannotBePutAsideThereIsNoRoomAndNothingChanges() {
        giveKeys()
        backupOfAnotherPhone(crypto, clock, document) { addDrink(THE_DAY, 7 * 60, 150) }
        look(document)
        // The staging folder cannot be made: a file stands in its place.
        val staging = File(water.app.noBackupFilesDir, "shk-restore")
        staging.deleteRecursively()
        staging.writeText("in the way")

        restore()

        assertEquals(BackupStep.NoRoom, state.step)
        assertEquals(emptyList<String>(), everything())
    }

    @Test
    fun aRestoreThatTheDatabaseRefusesChangesNothingAndSaysThereIsNoRoom() {
        giveKeys()
        backupOfAnotherPhone(crypto, clock, document) {
            addDrink(THE_DAY, 7 * 60, 150)
            setGoal(THE_DAY, 2_500)
        }
        look(document)
        // As on a full disk: every write to the table of goals fails. The drink comes first, so its write rolls back.
        water.database.refuseWritesTo(GoalEntity.TABLE)

        restore()

        assertEquals(BackupStep.NoRoom, state.step)
        assertEquals(emptyList<String>(), everything())
    }

    // The file key move (spec, "Files").

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
    fun aPendingFileKeyMoveIsFinishedBeforeWaterGoesOn() {
        aFileKeyFromBeforeTheRecoveryKey()

        model.goOn(RecoveryKeyNeed.BACKUP)
        model.opened()
        write(document)

        assertEquals("the backup is not refused as \"not ready\"", BackupStep.Written(drinks = 0), state.step)
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
}
