package app.shkriuss.feature.notes

import android.net.Uri
import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.security.RecoveryKeyNeed
import app.shkriuss.core.testing.TestDocuments
import java.io.File
import java.io.FileNotFoundException
import java.time.LocalDateTime
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Backup and restore as Settings drives them (docs/apps/notes/spec.md,
 * "As in Water and Tasks" and "Backup contents"), with real keys on the
 * stand-in for the Keystore and the documents of a test file picker:
 * what the rows show about the keys, a backup that is written and then
 * checked, what stops a backup before it is written, the question before
 * a restore, the answers, and the move of the file keys.
 *
 * The work runs on threads of its own, so [write], [look] and [restore]
 * wait until the dialog that ends the step shows. The phone is in UTC, on
 * Tuesday 24 November 2026 at 09:30, as in the spec's examples.
 */
@RunWith(RobolectricTestRunner::class)
class BackupViewModelTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val phone by lazy { NotesPhone(temporary.newFolder()) }
    private val crypto get() = phone.keys.crypto
    private val model by lazy { BackupViewModel(phone.services.backups, Dispatchers.Unconfined) }
    private val state get() = model.state.value
    private val document = TestDocuments.uri("notes-2026-11-24.shkbackup")
    private val others = mutableListOf<NotesPhone>()

    @Before
    fun aFilePickerWithAFolder() = pickerDocumentsIn(temporary.newFolder())

    @After
    fun closeTheDatabases() {
        TestDocuments.onOpen = {}
        others.forEach { it.close() }
        phone.close()
    }

    /** Waits until the state shows a step that [ends]. */
    private fun waitFor(ends: (BackupStep?) -> Boolean) {
        model.state.await { ends(it.step) }
    }

    /** Waits until no progress dialog shows any more: the work has ended. */
    private fun waitForTheEnd() = waitFor { it?.isWorking != true }

    private fun write(to: Uri?) {
        model.write(to)
        waitForTheEnd()
    }

    private fun look(from: Uri?) {
        model.look(from)
        waitForTheEnd()
    }

    private fun restore() {
        model.restore()
        waitForTheEnd()
    }

    private fun giveKeys(): RecoveryKey = phone.giveKeys()

    private fun keyFile(name: String) = File(phone.keysFolder, name)

    /** A phone of another copy of Notes, with the same recovery key as this one, unless it is given others. */
    private fun anotherPhone(sameKey: RecoveryKey? = null): NotesPhone =
        NotesPhone(temporary.newFolder(), phone.clock).also { other ->
            others += other
            other.giveKeys(sameKey ?: other.keys.crypto.setup.createRecoveryKey())
        }

    /** Two notes with three files, and a note that is deleted: two notes and three files count. */
    private fun twoNotesWithThreeFiles() {
        val trip = phone.note("Trip", "- [ ] Passport")
        phone.add(trip, picked("ticket.jpg", 2_400), picked("map.pdf", 5_000))
        val shop = phone.note("Shopping")
        phone.add(shop, picked("list.txt", 30, type = "text/plain"))
        val gone = phone.note("Old")
        runBlocking { phone.repository.wipe(checkNotNull(phone.repository.deleteNote(gone))) }
    }

    // The rows of Settings.

    @Test
    fun beforeTheFirstReadNothingIsShown() {
        assertEquals(BackupScreen(), state)
    }

    @Test
    fun theRowsSayWhereTheRecoveryKeyStandsAndWhetherTheAppLockIsOn() {
        model.refresh()
        model.state.await { it.loaded }
        assertEquals(BackupScreen(loaded = true, recoveryKey = RecoveryKeyLine.NOT_SET_UP, appLockOn = false), state)

        val key = giveKeys()
        model.refresh()
        model.state.await { it.recoveryKey == RecoveryKeyLine.SET_UP }
        crypto.appLock.beginTurnOn(checkNotNull(crypto.setup.checkAllWords(key))).finish()
        model.refresh()
        model.state.await { it.appLockOn }

        assertTrue(keyFile("record").delete())
        model.refresh()
        model.state.await { it.recoveryKey == RecoveryKeyLine.UNFINISHED }
    }

    // Going on, once the recovery key is there.

    @Test
    fun aBackupGoesOnToTheCreateDocumentScreenAndASecondRequestBeforeItIsIgnored() {
        giveKeys()

        model.goOn(RecoveryKeyNeed.BACKUP)
        model.goOn(RecoveryKeyNeed.APP_LOCK)
        model.state.await { it.open != null }

        assertEquals(BackupOpen.NewDocument("notes-2026-11-24.shkbackup"), state.open)
        model.opened()
        model.goOn(RecoveryKeyNeed.RESTORE)
        model.state.await { it.open != null }
        assertEquals(BackupOpen.Document, state.open)
        model.opened()
        model.goOn(RecoveryKeyNeed.APP_LOCK)
        model.state.await { it.open != null }
        assertEquals(BackupOpen.AppLock, state.open)
    }

    @Test
    fun theFileKeysMoveToTheRecoveryKeyBeforeItGoesOn() {
        val trip = phone.note("Trip")
        val ticket = phone.add(trip, picked("ticket.jpg", 2_400)).single()
        giveKeys()
        assertTrue(crypto.setup.fileKeyMoveIsPending())

        model.goOn(RecoveryKeyNeed.BACKUP)
        model.state.await { it.open != null }

        assertFalse("the move is done", crypto.setup.fileKeyMoveIsPending())
        val moved = phone.files().single()
        assertTrue(crypto.files.isSealedByCurrentKey(moved.wrappedKey))
        assertEquals("the record keeps its time", ticket.record, moved.record)
        assertEquals(FileState.READY, phone.stateOf(moved))
    }

    // Making a backup.

    @Test
    fun aBackupIsWrittenThenCheckedAndSaysHowManyNotesAndFilesItHolds() {
        giveKeys()
        twoNotesWithThreeFiles()
        val opened = CopyOnWriteArrayList<Pair<String, BackupStep?>>()
        TestDocuments.onOpen = { mode -> opened += mode to state.step }

        write(document)

        assertEquals(listOf("wt", "r"), opened.map { it.first })
        assertTrue("written while \"Writing the backup\" shows", opened[0].second is BackupStep.Writing)
        assertTrue("read again while \"Checking the backup\" shows", opened[1].second is BackupStep.Checking)
        assertEquals(BackupStep.Written(notes = 2, files = 3, leftOut = 0), state.step)
        model.close()
        assertNull(state.step)
    }

    @Test
    fun aBackupSaysHowManyFilesItLeftOut() {
        giveKeys()
        val trip = phone.note("Trip")
        val (ticket, _) = phone.add(trip, picked("ticket.jpg", 2_400), picked("map.pdf", 5_000))
        phone.store.stream(ticket.record.id).delete()

        write(document)

        assertEquals(BackupStep.Written(notes = 1, files = 1, leftOut = 1), state.step)
    }

    @Test
    fun withoutKeysNoBackupIsMade() {
        write(document)

        assertEquals(BackupStep.NoKeys, state.step)
    }

    @Test
    fun aWipeThatFailsStopsTheBackupBeforeItIsWritten() {
        giveKeys()
        val trip = phone.note("Trip", "Passport")
        runBlocking { phone.repository.deleteNote(trip) }
        phone.database.refuseWritesTo("note")
        TestDocuments.onOpen = { error("no document is opened") }

        write(document)

        assertEquals(BackupStep.NotWiped, state.step)
        model.close()
        phone.database.acceptWritesTo("note")
        TestDocuments.onOpen = {}
        write(document)
        assertEquals(BackupStep.Written(notes = 0, files = 0, leftOut = 0), state.step)
    }

    @Test
    fun aDeletedNoteWhoseUndoIsStillOpenStopsTheBackup() {
        giveKeys()
        val trip = phone.note("Trip", "Passport")
        runBlocking { phone.services.snackbars.offer { NotesMessage.NoteDeleted(checkNotNull(phone.repository.deleteNote(trip))) } }

        write(document)

        assertEquals(BackupStep.NotWiped, state.step)
        model.close()
        look(document)
        assertTrue("what was written is no backup", state.step is BackupStep.Refused)
    }

    @Test
    fun aFileKeyThatCannotMoveStopsTheBackupWithItsOwnWords() {
        val trip = phone.note("Trip")
        val ticket = phone.add(trip, picked("ticket.jpg", 2_400)).single()
        // The wrapped key is damaged after its first bytes: it can no longer be sealed again.
        phone.damageKey(ticket.record.id, ticket.wrappedKey.copyOf().also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() })
        giveKeys()

        write(document)

        assertEquals(BackupStep.FilesStillMoving, state.step)
        assertTrue(crypto.setup.fileKeyMoveIsPending())
    }

    @Test
    fun aPlaceThatCannotBeWrittenSaysTheBackupCouldNotBeWritten() {
        giveKeys()
        TestDocuments.onOpen = { mode -> if (mode != "r") throw FileNotFoundException("This place cannot be written now") }

        write(document)

        assertEquals(BackupStep.NotWritten, state.step)
    }

    @Test
    fun aFileThatCannotBeReadAgainIsWrittenButNotChecked() {
        giveKeys()
        val trip = phone.note("Trip")
        val ticket = phone.add(trip, picked("ticket.jpg", 2_400)).single()
        phone.store.stream(ticket.record.id).delete()
        TestDocuments.onOpen = { mode -> if (mode == "r") throw FileNotFoundException("Not yet") }

        write(document)

        assertEquals(BackupStep.WrittenNotChecked(leftOut = 1), state.step)
    }

    // Restoring a backup.

    @Test
    fun aRestoreAsksFirstWithWhatTheBackupHoldsAndCancelChangesNothing() {
        giveKeys()
        twoNotesWithThreeFiles()
        write(document)
        model.close()

        look(document)

        val question = state.step as BackupStep.Question
        assertEquals(LocalDateTime.of(2026, 11, 24, 9, 30), question.madeAt.withSecond(0).withNano(0))
        assertEquals(2L, question.notes)
        assertEquals(3L, question.files)
        model.close()
        assertNull(state.step)
        model.restore()
        assertNull("Restore after Cancel does nothing", state.step)
    }

    @Test
    fun aBackupOfAnotherCopyOfNotesIsRestoredWithItsFiles() {
        val key = giveKeys()
        val other = anotherPhone(key)
        val trip = other.note("Trip", "Passport")
        val ticket = other.add(trip, picked("ticket.jpg", 2_400)).single()
        assertEquals(BackupStep.Written(1, 1, 0), runBlocking { other.services.backups.write(document) {} })

        look(document)
        restore()

        assertEquals(BackupStep.Restored, state.step)
        assertEquals("Passport", phone.notes().single().body)
        assertEquals(FileState.READY, phone.stateOf(phone.filesOf(trip).single()))
        assertTrue(phone.read(phone.filesOf(trip).single()).contentEquals(other.read(ticket)))
    }

    @Test
    fun aBackupMadeWithOtherWordsNamesTheKeyItNeeds() {
        giveKeys()
        val other = anotherPhone()
        runBlocking { other.services.backups.write(document) {} }

        look(document)

        val refused = state.step as BackupStep.Refused
        assertEquals(BackupRefusal.OtherRecoveryKey(other.keys.crypto.backups.keyId().toString()), refused.reason)
    }

    @Test
    fun aFileThatIsNoBackupAndAFileThatCannotBeReadChangeNothing() {
        giveKeys()
        TestDocuments.file("holiday.jpg").writeBytes(ByteArray(3_000) { it.toByte() })

        look(TestDocuments.uri("holiday.jpg"))
        assertEquals(BackupStep.Refused(BackupRefusal.NotABackup), state.step)
        model.close()

        TestDocuments.onOpen = { throw FileNotFoundException("The storage app stopped") }
        look(TestDocuments.uri("holiday.jpg"))
        assertEquals(BackupStep.NotRead, state.step)
    }

    @Test
    fun aBackupWithSomethingNotesCannotReadChangesNothing() {
        giveKeys()
        val kept = phone.note("Kept")
        writeBackup(phone.keys, HandMadeContent(listOf(BackupRecord("note", fieldsOf(kept, later = 99), ByteArray(3)))), phone.clock, document)

        look(document)
        restore()

        assertEquals(BackupStep.Unreadable, state.step)
        assertEquals("Kept", phone.notes().single().title)
    }

    @Test
    fun aDialogWithNoButtonCannotBeClosed() {
        giveKeys()
        val release = java.util.concurrent.CountDownLatch(1)
        TestDocuments.onOpen = { release.await() }

        model.write(document)
        waitFor { it is BackupStep.Writing }
        model.close()

        assertTrue(state.step is BackupStep.Writing)
        release.countDown()
        waitForTheEnd()
        assertTrue(state.step is BackupStep.Written)
    }
}
