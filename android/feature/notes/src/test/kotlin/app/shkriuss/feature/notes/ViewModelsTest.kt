package app.shkriuss.feature.notes

import androidx.room3.withWriteTransaction
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.notes.data.NoteEntity
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The ViewModels of the list and of an open note, and the one snackbar,
 * on a real database in memory, a real folder of streams and software
 * keys. Their work runs off the test's thread, and each test waits for
 * the state it expects. The pauses before a search and a save are the
 * test's own: a pause ends when the test says so.
 */
@RunWith(RobolectricTestRunner::class)
class ViewModelsTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val folder by lazy { temporary.newFolder() }
    private val phone by lazy { Phone(folder) }
    private val crypto by lazy { cryptoIn(File(folder, "shk-keys")).crypto }
    private val repository get() = phone.repository
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val problems = CopyOnWriteArrayList<AddProblem>()
    private val keyMoves = CopyOnWriteArrayList<Unit>()

    private val snackbars by lazy { NotesSnackbars(repository, { keyMoves += Unit }, scope, Dispatchers.IO) }
    private val adds by lazy { FileAdds(repository, crypto.files, MutableStateFlow(true), Mutex(), { problems += it }, scope, Dispatchers.IO) }
    private val reader by lazy { FileReader(repository, crypto.files, { false }, Dispatchers.IO) }

    /** The pauses asked for, and the way to end the one that waits. */
    private val pauses = CopyOnWriteArrayList<Long>()
    private val endPause = Channel<Unit>(Channel.UNLIMITED)
    private val wait: suspend (Long) -> Unit = { millis ->
        pauses += millis
        endPause.receive()
    }

    /** The clock of the save times, which the test moves. */
    @Volatile
    private var elapsed = 0L

    @After
    fun close() {
        scope.cancel()
        phone.close()
    }

    private fun list() = NotesListViewModel(repository, snackbars, Dispatchers.IO, wait)

    private fun open(id: String) = NoteViewModel(repository, adds, reader, snackbars, id, Dispatchers.IO, wait) { elapsed }

    private fun stored(id: String): NoteEntity? = runBlocking { phone.database.notes().find(id) }

    private fun NotesListViewModel.shown(condition: (NotesListState.Shown) -> Boolean = { true }): NotesListState.Shown =
        state.await { it is NotesListState.Shown && condition(it) } as NotesListState.Shown

    @Test
    fun theListHasItsSectionsAndEachRowItsTitleTextAndFiles() {
        val trip = phone.note("Trip", "- [ ] Passport")
        val home = phone.note("", "# Home\nKeys")
        runBlocking { repository.setPinned(home, shownPinned = false) }
        val list = list()

        val shown = list.shown { it.pinned.size == 1 }

        assertEquals(listOf(home), shown.pinned.map { it.note.id })
        assertEquals(listOf(trip), shown.others.map { it.note.id })
        assertEquals("Home", shown.pinned.single().title)
        assertEquals("Home Keys", shown.pinned.single().preview)
        assertEquals("Passport", shown.others.single().preview)
        assertEquals(0, shown.others.single().fileCount)
        assertFalse(shown.noNotes)
    }

    @Test
    fun anEmptyListSaysSo() {
        assertTrue(list().shown().noNotes)
    }

    @Test
    fun theSearchFiltersThreeHundredMillisecondsAfterTheLastKey() {
        phone.note("Trip", "Pay the rent")
        phone.note("Home", "Keys")
        val list = list()
        list.shown { it.others.size == 2 }

        list.search("RENT")

        eventually { pauses == listOf(300L) }
        assertEquals("Nothing filters before the pause ends", 2, list.shown().others.size)
        endPause.trySend(Unit)
        val found = list.shown { it.query == "RENT" }
        assertEquals(listOf("Trip"), found.others.map { it.title })
        assertEquals("Pay the rent", found.others.single().match?.line?.line)

        list.search("nothing")
        endPause.trySend(Unit)
        assertTrue(list.shown { it.query == "nothing" }.noMatch)

        assertTrue("Back with text clears it", list.clearSearch())
        assertEquals("At once, with no pause", 2, list.shown { it.query == "" }.others.size)
        assertFalse("Back with no text does nothing here", list.clearSearch())
    }

    @Test
    fun newNoteReservesANoteToOpenAndAtFiveThousandSaysThatNotesIsFull() {
        val list = list()
        list.newNote()
        list.newNote()
        val first = list.newNote.await { it != null }
        list.newNoteOpened()
        assertTrue(repository.isNewNote(checkNotNull(first)))
        assertEquals(TestIdSource.idNumber(1), first)
        list.newNote()
        assertEquals("Pressed twice, the first press reserved one note", TestIdSource.idNumber(2), list.newNote.await { it != null })
        list.newNoteOpened()
        assertEquals("A new note writes nothing", 0, runBlocking { repository.shownCount() })

        runBlocking {
            val writer = RecordWriter(phone.database, phone.database.notes(), phone.clock, phone.ids)
            phone.database.withWriteTransaction {
                repeat(NoteLimits.MOST_NOTES) { writer.create { fields, number -> NoteEntity(fields, number, "n$it", "", false, 0) } }
            }
        }
        list.newNote()

        assertEquals(NotesMessage.NotesFull, snackbars.current.await { it != null })
        assertNull(list.newNote.value)
    }

    @Test
    fun aChangeIsSavedOneSecondAfterTheLastAndAtLeastEveryTenSeconds() {
        val id = phone.note("Trip", "")
        val note = open(id)
        note.state.await { !it.loading }

        note.onBodyChange(TextEdit("P", 1))
        eventually { pauses.size == 1 }
        assertEquals(1_000L, pauses.last())
        elapsed = 9_500
        note.onBodyChange(TextEdit("Pa", 2))
        eventually { pauses.size == 2 }
        assertEquals("Ten seconds after the first change", 500L, pauses.last())
        assertEquals("Nothing is saved before the pause ends", "", stored(id)?.body)

        endPause.trySend(Unit)
        eventually { stored(id)?.body == "Pa" }
        // Waits for the save that runs to end: one save at a time.
        assertTrue(runBlocking { note.saveNow() })
        elapsed = 20_000
        note.onBodyChange(TextEdit("Pas", 3))
        eventually { pauses.size == 3 }
        assertEquals("A new count after the save", 1_000L, pauses.last())
    }

    @Test
    fun aChangePastALimitIsRefusedAndTheFieldKeepsWhatItHad() {
        val note = open(phone.note("Trip", "Passport"))
        note.state.await { !it.loading }

        note.onTitleChange("x".repeat(201))
        assertEquals(FieldProblem.TITLE_TOO_LONG, note.state.value.problem)
        assertEquals("Trip", note.state.value.title)

        note.onBodyChange(TextEdit("y".repeat(100_001), 100_001))
        assertEquals(FieldProblem.TEXT_TOO_LONG, note.state.value.problem)
        assertEquals("Passport", note.state.value.body.text)

        note.onTitleChange("Trip to Kutaisi")
        assertNull("The words go at the next change", note.state.value.problem)
        assertEquals("Trip to Kutaisi", note.state.value.title)
    }

    @Test
    fun whatIsTypedIsCleanedAndEnterStartsTheNextItem() {
        val note = open(phone.note("Trip", "- Passport"))
        note.state.await { !it.loading }

        note.onTitleChange("Trip\nto\u0007 Kutaisi")
        // The cursor moves to the end of the text, then Enter.
        note.onBodyChange(TextEdit("- Passport", 10))
        note.onBodyChange(TextEdit("- Passport\n", 11))

        assertEquals("Trip to Kutaisi", note.state.value.title)
        assertEquals(TextEdit("- Passport\n- ", 13), note.state.value.body)
        note.onBodyChange(TextEdit("- Passport\n- Tickets", 20))
        note.onBodyChange(TextEdit("- Passport\n- Tickets\n", 21))
        assertEquals(TextEdit("- Passport\n- Tickets\n- ", 23), note.state.value.body)
        note.checklist()
        assertEquals("- Passport\n- Tickets\n- [ ] ", note.state.value.body.text)

        note.onBodyChange(TextEdit("Pasted\r\nlines\u0000", 15))
        assertEquals("A paste keeps its line breaks as \\n, and its cursor", TextEdit("Pasted\nlines", 12), note.state.value.body)
    }

    @Test
    fun closingSavesFirstAndAnEmptyNoteIsDeletedAndWiped() {
        val id = phone.note("Trip", "Passport")
        val note = open(id)
        note.state.await { !it.loading }
        note.onTitleChange("")
        note.onBodyChange(TextEdit("", 0))

        note.close()

        note.state.await { it.closed }
        assertNotNull(stored(id)?.record?.deletedAt)
        assertTrue(NoteRules.isWiped(checkNotNull(stored(id))))
        assertNull("No snackbar: nothing is lost", snackbars.current.value)
    }

    @Test
    fun aNewNoteThatClosesWithNothingInItWritesNothing() {
        val id = repository.reserveNoteId()
        val note = open(id)
        note.state.await { !it.loading }

        note.close()

        note.state.await { it.closed }
        assertNull(stored(id))
        assertFalse(repository.isNewNote(id))
    }

    @Test
    fun aNewNoteIsMadeAtItsFirstSave() {
        val id = repository.reserveNoteId()
        val note = open(id)
        note.state.await { !it.loading }

        note.onTitleChange("  Trip  ")
        note.close()

        note.state.await { it.closed }
        assertEquals("Spaces at both ends go when it is saved", "Trip", stored(id)?.title)
    }

    @Test
    fun aSaveThatFailsShowsTheLineAndClosingAsksFirst() {
        val id = phone.note("Trip", "Passport")
        val note = open(id)
        note.state.await { !it.loading }
        phone.database.refuseWritesTo("note")

        note.onBodyChange(TextEdit("Passport and tickets", 20))
        endPause.trySend(Unit)
        note.state.await { it.saveFailed }
        note.close()
        note.state.await { it.askUnsaved }

        phone.database.acceptWritesTo("note")
        note.tryAgain()
        note.state.await { it.closed }
        assertEquals("Passport and tickets", stored(id)?.body)
    }

    @Test
    fun discardChangesClosesWithWhatWasSavedLast() {
        val id = phone.note("Trip", "Passport")
        val note = open(id)
        note.state.await { !it.loading }
        phone.database.refuseWritesTo("note")
        note.onBodyChange(TextEdit("Lost", 4))
        note.close()
        note.state.await { it.askUnsaved }

        note.discard()

        note.state.await { it.closed }
        phone.database.acceptWritesTo("note")
        assertEquals("Passport", stored(id)?.body)
    }

    @Test
    fun deleteSavesFirstClosesAndOffersUndoWhichBringsBackWhatWasTyped() {
        val id = phone.note("Trip", "Passport")
        val note = open(id)
        note.state.await { !it.loading }
        note.onBodyChange(TextEdit("Passport and tickets", 20))

        note.delete()
        note.delete()

        note.state.await { it.closed }
        val message = snackbars.current.await { it is NotesMessage.NoteDeleted }
        assertNotNull(stored(id)?.record?.deletedAt)
        snackbars.undo()
        snackbars.undo()
        eventually { stored(id)?.record?.deletedAt == null }
        assertEquals("Passport and tickets", stored(id)?.body)
        eventually { keyMoves.size == 1 }
        assertNull(snackbars.current.value)
        assertNotNull(message)
    }

    @Test
    fun anotherSnackbarEndsTheUndoAndTheDeletedNoteIsWiped() {
        val id = phone.note("Trip", "Secret")
        val note = open(id)
        note.state.await { !it.loading }
        note.delete()
        snackbars.current.await { it is NotesMessage.NoteDeleted }

        snackbars.show(NotesMessage.CouldNotChange)

        eventually { stored(id)?.let(NoteRules::isWiped) == true }
        eventually { keyMoves.size == 1 }
    }

    @Test
    fun leavingTheScreenEndsTheUndo() {
        val id = phone.note("Trip", "Secret")
        val undo = checkNotNull(runBlocking { repository.deleteNote(id) })
        snackbars.show(NotesMessage.NoteDeleted(undo))
        assertEquals(setOf(id), snackbars.openUndoIds)

        snackbars.endUndo()

        assertNull(snackbars.current.value)
        eventually { stored(id)?.let(NoteRules::isWiped) == true }
    }

    @Test
    fun aNoteThatARestoreDeletesWhileItIsOpenCloses() {
        val id = phone.note("Trip", "Passport")
        val note = open(id)
        note.state.await { !it.loading }

        runBlocking { RecordWriter(phone.database, phone.database.notes(), phone.clock, phone.ids).markDeleted(id) }

        note.state.await { it.closed }
    }

    @Test
    fun pinFollowsThePressAndTheStoredNote() {
        val id = phone.note("Trip", "")
        val note = open(id)
        note.state.await { !it.loading }

        note.setPinned(shownPinned = false)

        note.state.await { it.pinned }
        assertEquals(true, stored(id)?.pinned)
    }

    @Test
    fun aFileAddedToTheNoteShowsAsARowAndRemoveOffersUndo() {
        val id = phone.note("Trip", "")
        val note = open(id)
        note.state.await { !it.loading }

        note.addFiles(listOf(TestPick()))

        val row = note.state.await { it.files.size == 1 && it.files.single().state != null }.files.single()
        assertEquals("ticket.jpg", row.file.name)
        assertEquals(FileState.READY, row.state)
        note.removeFile(row.file)
        assertTrue(snackbars.current.await { it is NotesMessage.FileRemoved } is NotesMessage.FileRemoved)
        note.state.await { it.files.isEmpty() }
    }

    @Test
    fun saveACopyShowsItsResultInTheSnackbar() {
        val id = phone.note("Trip", "")
        val note = open(id)
        note.state.await { !it.loading }
        note.addFiles(listOf(TestPick()))
        val file = note.state.await { it.files.size == 1 }.files.single().file
        val target = TestTarget()

        note.saveCopy(file, target)

        assertEquals(NotesMessage.Copy(CopyResult.SAVED), snackbars.current.await { it is NotesMessage.Copy })
        assertEquals(2_400, target.written.size())
        assertNull(note.state.value.copying)
    }
}
