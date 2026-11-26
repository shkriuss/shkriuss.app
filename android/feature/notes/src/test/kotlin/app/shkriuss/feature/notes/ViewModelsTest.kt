package app.shkriuss.feature.notes

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import androidx.room3.withWriteTransaction
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.notes.data.AttachmentEntity
import app.shkriuss.feature.notes.data.NoteEntity
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.OutputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
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

    private val snackbars: NotesSnackbars by lazy {
        NotesSnackbars(repository, { keyMoves += Unit }, scope, Dispatchers.IO, isAdding = { adds.isAddingTo(it) })
    }
    private val adds: FileAdds by lazy {
        FileAdds(repository, crypto.files, MutableStateFlow(true), Mutex(), { problems += it }, { "File" }, scope, Dispatchers.IO, afterLastAdd = { snackbars.lookAgain(it) })
    }
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

    /** The phones of the tests that hold the work of their database. */
    private val heldPhones = mutableListOf<Phone>()

    @After
    fun close() {
        scope.cancel()
        phone.close()
        heldPhones.forEach { it.close() }
    }

    /**
     * A phone whose database does its work on [writes]. While the test
     * holds [writes], a write waits, so the test can act between a press
     * and the end of its write.
     */
    private fun phoneOn(writes: HoldableWork): Phone = Phone(temporary.newFolder(), memoryDatabaseOn(writes)).also { heldPhones += it }

    private fun list() = NotesListViewModel(repository, snackbars, Dispatchers.IO, wait)

    private fun open(id: String) = NoteViewModel(repository, adds, reader, snackbars, id, scope, Dispatchers.IO, wait) { elapsed }

    private fun stored(id: String, of: Phone = phone): NoteEntity? = runBlocking { of.database.notes().find(id) }

    /** A stored note with no title, text or file, as one that closed empty while it was kept. */
    private fun emptyNote(): String {
        val id = phone.note("Trip", "")
        assertEquals(Saved.WRITTEN, runBlocking { repository.save(id, "", "") })
        return id
    }

    private fun NotesListViewModel.shown(condition: (NotesListState.Shown) -> Boolean = { true }): NotesListState.Shown =
        state.await { screen -> (screen.list as? NotesListState.Shown)?.let(condition) == true }.list as NotesListState.Shown

    /** The `id` of the new note that **New note** made room for, once it has. */
    private fun NotesListViewModel.reserved(): String = checkNotNull(state.await { it.newNote != null }.newNote)

    @Test
    fun theListHasItsSectionsAndEachRowItsTitleTextAndFiles() {
        val trip = phone.note("Trip", "- [ ] Passport")
        val home = phone.note("", "# Home\nKeys")
        runBlocking { repository.setPinned(home, shownPinned = false) }
        val list = list()

        val shown = list.shown { it.pinned.size == 1 }

        assertEquals(listOf(home), shown.pinned.map { it.id })
        assertEquals(listOf(trip), shown.others.map { it.id })
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
    fun aSearchWithNoNoteAtAllSaysThatNoNoteMatches() {
        val list = list()
        list.search("rent")
        endPause.trySend(Unit)

        val shown = list.shown { it.query == "rent" }

        assertTrue(shown.noMatch)
    }

    @Test
    fun aNewNoteThatWasNeverOpenedIsGivenUpWhenTheListGoes() {
        val store = ViewModelStore()
        val list = ViewModelProvider.create(store, viewModelFactory { initializer { list() } })[NotesListViewModel::class]
        list.newNote()
        val reserved = list.reserved()

        store.clear()

        assertFalse(repository.isNewNote(reserved))
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
    fun aRowKeepsAThousandCharactersOfANoteOfAHundredThousand() {
        // One line of 100,000 characters, with the word of the search at its far end.
        phone.note("", "word ".repeat(19_999) + "rent ")
        val list = list()

        val row = list.shown { it.others.size == 1 }.others.single()

        assertEquals(1_000, row.preview.length)
        assertEquals("With no title, the first line is the title: 1,000 characters of it", 1_000, row.title.length)
        assertFalse(row.hasTitle)
        list.search("rent")
        endPause.trySend(Unit)
        val line = checkNotNull(list.shown { it.query == "rent" }.others.single().match?.line)
        assertTrue("The line of the match is kept as the row shows it", line.line.length <= 1_000)
        assertEquals("rent", line.line.substring(line.ranges.single()))
    }

    @Test
    fun theListShowsMoreNotesThanAreReadAtATimeInOrderAndASearchFindsThemInEveryGroup() {
        val ids = (1..45).map { number ->
            phone.clock.advanceBy(1_000)
            phone.note("Note $number", if (number % 9 == 0) "Pay the rent" else "Text")
        }
        val rent = ids.filterIndexed { index, _ -> (index + 1) % 9 == 0 }
        runBlocking { listOf(ids[0], ids[20], ids[44]).forEach { repository.setPinned(it, shownPinned = false) } }
        // More notes with a file than are asked for their names at a time. The last of them matches by that name only.
        val withFile = ids[40]
        ids.subList(10, 34).forEach { adds.add(it, listOf(TestPick(name = "ticket.jpg"))) }
        adds.add(withFile, listOf(TestPick(name = "rent-contract.pdf")))
        adds.adding.await { it.isEmpty() }
        val expected = NoteOrder.sections(runBlocking { repository.shownNotes(ids) })
        val list = list()

        val shown = list.shown { rows -> rows.pinned.size == 3 && rows.others.size == 42 && (rows.pinned + rows.others).count { it.fileCount == 1 } == 25 }

        assertEquals(expected.pinned.map { it.id }, shown.pinned.map { it.id })
        assertEquals(expected.others.map { it.id }, shown.others.map { it.id })
        list.search("rent")
        endPause.trySend(Unit)
        val found = list.shown { it.query == "rent" }
        val matching = (rent + withFile).toSet()
        assertEquals("The pinned note of the five keeps its section", expected.pinned.map { it.id }.filter { it in matching }, found.pinned.map { it.id })
        assertEquals("The others keep their order", expected.others.map { it.id }.filter { it in matching }, found.others.map { it.id })
        assertEquals(6, found.pinned.size + found.others.size)
        assertEquals("rent-contract.pdf", found.others.single { it.id == withFile }.match?.fileName)
    }

    @Test
    fun theListReadsTheNotesInGroupsAndANoteAgainOnlyWhenItChangedOrASearchNeedsIt() {
        val ids = (1..45).map { phone.note("Note $it", "Text $it") }
        val reads = CopyOnWriteArrayList<List<String>>()
        val rows = KeptRows { group ->
            reads += group
            repository.shownNotes(group)
        }
        fun marks() = runBlocking { repository.noteMarks().first() }

        val first = runBlocking { rows.of(marks(), "") }

        assertEquals(45, first.size)
        assertEquals("Twenty notes at a time", listOf(20, 20, 5), reads.map { it.size })
        reads.clear()
        assertEquals(Saved.WRITTEN, runBlocking { repository.save(ids[7], "Note 8", "Changed") })
        val second = runBlocking { rows.of(marks(), "") }
        assertEquals("Only the note that changed is read again", listOf(listOf(ids[7])), reads.toList())
        assertEquals("Changed", second.single { it.id == ids[7] }.preview)
        reads.clear()
        val found = runBlocking { rows.of(marks(), "text 4") }
        assertEquals("A search reads every text", 45, reads.sumOf { it.size })
        assertEquals("Text 4, and Text 40 to Text 45", 7, found.count { it.match != null })
        reads.clear()
        runBlocking { rows.of(marks(), "text 4") }
        assertTrue("The same search again reads nothing", reads.isEmpty())
        val cleared = runBlocking { rows.of(marks(), "") }
        assertTrue("Clearing the search reads nothing", reads.isEmpty())
        assertTrue("And no row keeps its match", cleared.all { it.match == null })
        runBlocking { repository.deleteNote(ids[0]) }
        assertEquals("A deleted note has no row", 44, runBlocking { rows.of(marks(), "") }.size)
    }

    @Test
    fun aSearchReadsTheNamesOfANoteWithMoreFilesThanOnePageAndShowsTheFirstThatMatches() {
        // A restore can give one note any number of files: here 520, more than are read at a time.
        val id = phone.note("Trip", "Passport")
        fun addRecord(name: String) = runBlocking {
            val fileId = repository.reserveFileId()
            val key = NoteLimits.WRAPPED_KEY_START + ByteArray(NoteLimits.WRAPPED_KEY_LENGTH.first - NoteLimits.WRAPPED_KEY_START.size)
            assertEquals(FileAdded.ADDED, repository.addFile(id, fileId, name, "application/pdf", 1_000, key))
            repository.releaseFileId(fileId)
        }
        phone.clock.advanceBy(10_000)
        repeat(260) { addRecord("film$it.mp4") }
        addRecord("rent-later.pdf")
        repeat(258) { addRecord("photo$it.jpg") }
        // The last record has the highest id, so it is read on the second page. But it is the oldest file of the note.
        phone.clock.advanceBy(-5_000)
        addRecord("rent-first.pdf")
        val list = list()
        list.shown { it.others.singleOrNull()?.fileCount == 520 }

        list.search("rent")
        endPause.trySend(Unit)

        val found = list.shown { it.query == "rent" }.others.single()
        assertEquals("The first file in the note's order that matches", "rent-first.pdf", found.match?.fileName)
        assertEquals(listOf(0..3), found.match?.inFileName)
    }

    @Test
    fun aSearchKeepsTheOrderAndTheSectionsAndOnlyTheNamesOfShownFilesMatch() {
        val trip = phone.note("Trip", "Buy a ticket")
        phone.clock.advanceBy(1_000)
        val home = phone.note("Home", "Keys")
        phone.clock.advanceBy(1_000)
        val work = phone.note("Work", "ticket for the train")
        runBlocking { repository.setPinned(trip, shownPinned = false) }
        adds.add(home, listOf(TestPick("ticket.jpg"), TestPick("plan.pdf")))
        adds.adding.await { it.isEmpty() }
        val list = list()
        list.shown { it.pinned.size == 1 && it.others.size == 2 }

        list.search("ticket")
        endPause.trySend(Unit)

        val found = list.shown { it.query == "ticket" }
        assertEquals("The pinned note stays in its section", listOf(trip), found.pinned.map { it.id })
        assertEquals("The others stay newest first: a file was added to Home last", listOf(home, work), found.others.map { it.id })
        assertEquals("ticket.jpg", found.others.first().match?.fileName)
        assertEquals("Each row still counts its files", 2, found.others.first().fileCount)

        // The file is removed: its name matches no more, also while its Undo is open.
        val ticket = runBlocking { phone.database.attachments().shownOf(home) }.single { it.name == "ticket.jpg" }.record.id
        runBlocking { checkNotNull(repository.removeFile(ticket)) }

        val after = list.shown { rows -> rows.query == "ticket" && rows.others.none { it.id == home } }
        assertEquals(listOf(work), after.others.map { it.id })
    }

    @Test
    fun newNoteReservesANoteToOpenAndAtFiveThousandSaysThatNotesIsFull() {
        val list = list()
        list.newNote()
        list.newNote()
        val first = list.reserved()
        list.newNoteOpened()
        assertTrue(repository.isNewNote(first))
        assertEquals(TestIdSource.idNumber(1), first)
        list.newNote()
        assertEquals("Pressed twice, the first press reserved one note", TestIdSource.idNumber(2), list.reserved())
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
        assertNull(list.state.value.newNote)
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
    fun aChangeAfterTheNoteBeganToCloseIsNotTakenSoNothingItShowsIsLost() {
        val id = phone.note("Trip", "Passport")
        val note = open(id)
        note.state.await { !it.loading }
        note.onTitleChange("Trip to Batumi")

        note.close()
        // On a tablet the note shows beside the list until it has closed, with the keyboard still open.
        note.onTitleChange("Trip to Batumi and Kutaisi")
        note.onBodyChange(TextEdit("Passport and tickets", 20))
        note.bold()

        note.state.await { it.closed }
        assertEquals("Trip to Batumi", note.state.value.title)
        assertEquals("Passport", note.state.value.body.text)
        assertEquals("What it showed is what is stored", "Trip to Batumi", stored(id)?.title)
        assertEquals("Passport", stored(id)?.body)
    }

    @Test
    fun aNoteKeptOpenAfterItsSaveFailedTakesChangesAgain() {
        val id = phone.note("Trip", "Passport")
        val note = open(id)
        note.state.await { !it.loading }
        phone.database.refuseWritesTo("note")
        note.onBodyChange(TextEdit("Passport and tickets", 20))
        note.close()
        note.state.await { it.askUnsaved }

        note.keepEditing()
        note.onTitleChange("Trip to Batumi")

        assertEquals("Trip to Batumi", note.state.value.title)
        assertFalse(note.state.value.closed)
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
    fun aNewNoteCanBePinnedOnlyOnceItIsStored() {
        val id = repository.reserveNoteId()
        val note = open(id)
        assertTrue("Pin is off while the new note is not stored", !note.state.await { !it.loading }.stored)

        note.onTitleChange("Trip")
        endPause.trySend(Unit)

        note.state.await { it.stored }
        note.setPinned(shownPinned = false)
        note.state.await { it.pinned }
        assertEquals(true, stored(id)?.pinned)
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
    fun deleteDoesNothingWhenWhatIsTypedCannotBeSaved() {
        val id = phone.note("Trip", "Passport")
        val note = open(id)
        note.state.await { !it.loading }
        // The database refuses a new text, and would take the delete, which leaves the text as it is.
        runBlocking {
            phone.database.useWriterConnection { connection ->
                connection.executeSQL(
                    "CREATE TRIGGER refuse_text BEFORE UPDATE ON note WHEN NEW.body != OLD.body BEGIN SELECT RAISE(ABORT, 'refused'); END",
                )
            }
        }
        note.onBodyChange(TextEdit("Passport and tickets", 20))

        note.delete()

        assertEquals(NotesMessage.CouldNotChange, snackbars.current.await { it != null })
        note.state.await { it.saveFailed }
        assertFalse(note.state.value.closed)
        assertNull(stored(id)?.record?.deletedAt)
        assertEquals("Passport and tickets", note.state.value.body.text)
    }

    @Test
    fun aNoteWhoseFilesCannotBeReadShowsThatNotesCannotBeOpened() {
        val id = phone.note("Trip", "")
        phone.database.refuseReadsOf("attachment")

        val note = open(id)

        note.state.await { it.failed }
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
    fun aSnackbarWhoseTimeRanOutEndsItsUndo() {
        val id = phone.note("Trip", "Secret")
        val message = NotesMessage.NoteDeleted(checkNotNull(runBlocking { repository.deleteNote(id) }))
        snackbars.show(message)

        snackbars.gone(NotesMessage.CouldNotChange)
        assertEquals("Another snackbar's time says nothing about this one", message, snackbars.current.value)
        snackbars.gone(message)

        assertNull(snackbars.current.value)
        eventually { stored(id)?.let(NoteRules::isWiped) == true }
        eventually { keyMoves.size == 1 }
    }

    @Test
    fun anUndoPressedAfterAnotherSnackbarTookItsPlaceCountsForNothing() {
        val id = phone.note("Trip", "Secret")
        val message = NotesMessage.NoteDeleted(checkNotNull(runBlocking { repository.deleteNote(id) }))
        snackbars.show(message)

        snackbars.show(NotesMessage.CouldNotChange)
        snackbars.undo()

        eventually { stored(id)?.let(NoteRules::isWiped) == true }
        assertNotNull(stored(id)?.record?.deletedAt)
        assertEquals(NotesMessage.CouldNotChange, snackbars.current.value)
    }

    @Test
    fun anUndoThatTheDatabaseRefusesKeepsItsUndoAndWipesNothing() {
        val id = phone.note("Trip", "Secret")
        val undo = checkNotNull(runBlocking { repository.deleteNote(id) })
        snackbars.show(NotesMessage.NoteDeleted(undo))
        // The database refuses to bring the note back, and would take its wipe.
        refuseBringingBack(NoteEntity.TABLE)

        snackbars.undo()

        assertEquals("It says so, and keeps Undo", NotesMessage.UndoFailed(undo), snackbars.current.await { it is NotesMessage.UndoFailed })
        // A wipe would have run by now: it follows the end of an Undo at once.
        Thread.sleep(200)
        assertEquals("Nothing is wiped", "Secret", stored(id)?.body)
        assertNotNull(stored(id)?.record?.deletedAt)
        assertEquals("Its records still count as open", setOf(id), snackbars.openUndoIds)
        assertEquals("The Undo has not ended", 0, keyMoves.size)

        allowBringingBack(NoteEntity.TABLE)
        snackbars.undo()

        eventually { stored(id)?.record?.deletedAt == null }
        assertEquals("Secret", stored(id)?.body)
        eventually { keyMoves.size == 1 }
        assertNull(snackbars.current.value)
    }

    @Test
    fun aFailedUndoEndsWhenItsSnackbarGoesAndTheNoteIsThenWiped() {
        val id = phone.note("Trip", "Secret")
        val undo = checkNotNull(runBlocking { repository.deleteNote(id) })
        snackbars.show(NotesMessage.NoteDeleted(undo))
        refuseBringingBack(NoteEntity.TABLE)
        snackbars.undo()
        val failed = checkNotNull(snackbars.current.await { it is NotesMessage.UndoFailed })

        snackbars.gone(failed)

        assertNull(snackbars.current.value)
        eventually { stored(id)?.let(NoteRules::isWiped) == true }
        eventually { keyMoves.size == 1 }
    }

    @Test
    fun aLeaveWhileARefusedUndoIsWrittenEndsTheUndoAsEveryLeaveDoes() {
        val writes = HoldableWork()
        val held = Held()
        val heldPhone = phoneOn(writes)
        val id = heldPhone.note("Trip", "Secret")
        val heldSnackbars = NotesSnackbars(heldPhone.repository, {}, scope, held.dispatcher)
        val undo = checkNotNull(runBlocking { heldPhone.repository.deleteNote(id) })
        heldSnackbars.show(NotesMessage.NoteDeleted(undo))
        refuseBringingBack(NoteEntity.TABLE, heldPhone)

        // The work of the database waits from here: the write of the press cannot be back before the leave.
        writes.hold()
        heldSnackbars.undo()
        // The press took its snackbar away, and its write waits.
        held.runUntil { heldSnackbars.current.value == null }
        // Notes leaves the screen meanwhile: no snackbar shows, so the leave finds no Undo to end.
        heldSnackbars.endUndo()
        writes.letGo()

        held.runUntil { heldSnackbars.current.value != null }
        assertEquals("No snackbar with Undo shows after the leave", NotesMessage.CouldNotChange, heldSnackbars.current.value)
        held.runUntil { stored(id, heldPhone)?.let(NoteRules::isWiped) == true }
        held.runUntil { heldSnackbars.openUndoIds.isEmpty() }
    }

    @Test
    fun aMessageAboutAnAddWaitsWhileAnUndoShowsAndShowsWhenItsSnackbarGoes() {
        val id = phone.note("Trip", "Secret")
        val deleted = NotesMessage.NoteDeleted(checkNotNull(runBlocking { repository.deleteNote(id) }))
        snackbars.show(deleted)
        val notAdded = NotesMessage.NotAdded(AddProblem.NoteDeleted)

        snackbars.tell(notAdded)

        assertEquals("The Undo keeps its snackbar", deleted, snackbars.current.value)
        assertEquals("Its records still count as open", setOf(id), snackbars.openUndoIds)
        assertEquals("Nothing is wiped", "Secret", stored(id)?.body)
        assertEquals("The Undo has not ended", 0, keyMoves.size)

        snackbars.gone(deleted)

        assertEquals("The message that waited shows", notAdded, snackbars.current.value)
        eventually { stored(id)?.let(NoteRules::isWiped) == true }
        snackbars.gone(notAdded)
        assertNull("It shows once", snackbars.current.value)
    }

    @Test
    fun aPressedUndoBringsTheNoteBackAndThenTheMessageThatWaitedShows() {
        val id = phone.note("Trip", "Secret")
        snackbars.show(NotesMessage.NoteDeleted(checkNotNull(runBlocking { repository.deleteNote(id) })))
        val notAdded = NotesMessage.NotAdded(AddProblem.NoteDeleted)
        snackbars.tell(notAdded)

        snackbars.undo()

        assertEquals(notAdded, snackbars.current.await { it == notAdded })
        assertNull("The note was back before the message showed", stored(id)?.record?.deletedAt)
        assertEquals("Secret", stored(id)?.body)
    }

    @Test
    fun aLeaveEndsTheUndoAndThenTheMessageThatWaitedShows() {
        val id = phone.note("Trip", "Secret")
        snackbars.show(NotesMessage.NoteDeleted(checkNotNull(runBlocking { repository.deleteNote(id) })))
        val notAdded = NotesMessage.NotAdded(AddProblem.NoteDeleted)
        snackbars.tell(notAdded)

        snackbars.endUndo()

        assertEquals(notAdded, snackbars.current.value)
        eventually { stored(id)?.let(NoteRules::isWiped) == true }
    }

    @Test
    fun ofTheMessagesThatWaitTheLastShowsAndWithNoUndoAMessageShowsAtOnce() {
        val tooLarge = NotesMessage.NotAdded(AddProblem.TooLarge("film.mp4"))
        val notRead = NotesMessage.NotAdded(AddProblem.CouldNotRead("ticket.jpg"))
        snackbars.tell(tooLarge)
        assertEquals("With no Undo it shows at once", tooLarge, snackbars.current.value)
        snackbars.tell(notRead)
        assertEquals("And it takes the place of an older message", notRead, snackbars.current.value)
        val id = phone.note("Trip", "Secret")
        val deleted = NotesMessage.NoteDeleted(checkNotNull(runBlocking { repository.deleteNote(id) }))
        snackbars.show(deleted)

        snackbars.tell(tooLarge)
        snackbars.tell(notRead)

        assertEquals(deleted, snackbars.current.value)
        snackbars.gone(deleted)
        assertEquals("Only the last one that waited shows", notRead, snackbars.current.value)
        snackbars.gone(notRead)
        assertNull(snackbars.current.value)
    }

    @Test
    fun aMessageFromAPressStillEndsTheUndoAndTheMessageThatWaitedShowsAfterIt() {
        val id = phone.note("Trip", "Secret")
        snackbars.show(NotesMessage.NoteDeleted(checkNotNull(runBlocking { repository.deleteNote(id) })))
        val notAdded = NotesMessage.NotAdded(AddProblem.NoteDeleted)
        snackbars.tell(notAdded)

        snackbars.show(NotesMessage.CouldNotChange)

        assertEquals(NotesMessage.CouldNotChange, snackbars.current.value)
        eventually { stored(id)?.let(NoteRules::isWiped) == true }
        snackbars.gone(NotesMessage.CouldNotChange)
        assertEquals(notAdded, snackbars.current.value)
    }

    @Test
    fun aMessageToldWhileARefusedUndoIsWrittenWaitsBehindTheSnackbarThatKeepsTheUndo() {
        val writes = HoldableWork()
        val held = Held()
        val heldPhone = phoneOn(writes)
        val id = heldPhone.note("Trip", "Secret")
        val heldSnackbars = NotesSnackbars(heldPhone.repository, {}, scope, held.dispatcher)
        val undo = checkNotNull(runBlocking { heldPhone.repository.deleteNote(id) })
        heldSnackbars.show(NotesMessage.NoteDeleted(undo))
        refuseBringingBack(NoteEntity.TABLE, heldPhone)
        val notAdded = NotesMessage.NotAdded(AddProblem.NoteDeleted)

        // The work of the database waits from here: the write of the press cannot be back before the message is told.
        writes.hold()
        heldSnackbars.undo()
        // The press took its snackbar away, and its write waits.
        held.runUntil { heldSnackbars.current.value == null }
        heldSnackbars.tell(notAdded)

        assertNull("It does not show while the Undo is written", heldSnackbars.current.value)
        writes.letGo()
        held.runUntil { heldSnackbars.current.value != null }
        val failed = NotesMessage.UndoFailed(undo)
        assertEquals("The refused Undo keeps its snackbar", failed, heldSnackbars.current.value)
        assertEquals("Nothing is wiped", "Secret", stored(id, heldPhone)?.body)
        assertEquals(setOf(id), heldSnackbars.openUndoIds)

        heldSnackbars.gone(failed)

        assertEquals("The message shows when the Undo is over", notAdded, heldSnackbars.current.value)
        held.runUntil { stored(id, heldPhone)?.let(NoteRules::isWiped) == true }
    }

    @Test
    fun aNoteDeletedWhileAFileWaitsForItKeepsItsUndoAndUndoBringsItBack() {
        val id = phone.note("Trip", "Secret")
        val gate = MutableStateFlow(false)
        val waitingAdds =
            FileAdds(repository, crypto.files, gate, Mutex(), { snackbars.tell(NotesMessage.NotAdded(it)) }, { "File" }, scope, Dispatchers.IO)
        waitingAdds.add(id, listOf(TestPick()))
        val deleted = runBlocking { snackbars.offer { repository.deleteNote(id)?.let(NotesMessage::NoteDeleted) } }

        // The file's turn comes: its add finds the note deleted, and says so.
        gate.value = true
        eventually { !waitingAdds.isAddingTo(id) }

        assertEquals("Note deleted keeps its snackbar", deleted, snackbars.current.value)
        assertEquals("Nothing is wiped", "Secret", stored(id)?.body)
        snackbars.undo()
        val notAdded = NotesMessage.NotAdded(AddProblem.NoteDeleted)
        assertEquals(notAdded, snackbars.current.await { it == notAdded })
        assertNull("The note is back", stored(id)?.record?.deletedAt)
        assertEquals("Secret", stored(id)?.body)
    }

    @Test
    fun aRemovedFilesUndoThatTheDatabaseRefusesKeepsTheFileAndItsStream() {
        val id = phone.note("Trip", "")
        adds.add(id, listOf(TestPick()))
        adds.adding.await { it.isEmpty() }
        val file = runBlocking { phone.database.attachments().shownOf(id) }.single().record.id
        val undo = checkNotNull(runBlocking { repository.removeFile(file) })
        snackbars.show(NotesMessage.FileRemoved(undo))
        refuseBringingBack(AttachmentEntity.TABLE)

        snackbars.undo()

        assertEquals(NotesMessage.UndoFailed(undo), snackbars.current.await { it is NotesMessage.UndoFailed })
        Thread.sleep(200)
        assertEquals("Its record is not wiped", "ticket.jpg", runBlocking { phone.database.attachments().find(file) }?.name)
        assertTrue("Its stream stays", phone.store.has(file))

        allowBringingBack(AttachmentEntity.TABLE)
        snackbars.undo()

        eventually { runBlocking { phone.database.attachments().shownOf(id) }.map { it.record.id } == listOf(file) }
        assertTrue(phone.store.has(file))
    }

    @Test
    fun aPinThatTheDatabaseRefusesSaysSoAndChangesNothing() {
        val id = phone.note("Trip", "")
        val note = open(id)
        note.state.await { !it.loading }
        phone.database.refuseWritesTo(NoteEntity.TABLE)

        note.setPinned(shownPinned = false)

        assertEquals(NotesMessage.CouldNotChange, snackbars.current.await { it != null })
        phone.database.acceptWritesTo(NoteEntity.TABLE)
        assertEquals(false, stored(id)?.pinned)
        assertFalse(note.state.value.pinned)
    }

    /** The database of [on] refuses to bring a deleted row of [table] back, and takes every other write, a wipe too. */
    private fun refuseBringingBack(table: String, on: Phone = phone) = runBlocking {
        on.database.useWriterConnection { connection ->
            connection.executeSQL(
                "CREATE TRIGGER refuse_back_$table BEFORE UPDATE ON $table WHEN OLD.deletedAt IS NOT NULL AND NEW.deletedAt IS NULL " +
                    "BEGIN SELECT RAISE(ABORT, 'refused'); END",
            )
        }
    }

    /** The database brings deleted rows of [table] back again. */
    private fun allowBringingBack(table: String) = runBlocking {
        phone.database.useWriterConnection { connection -> connection.executeSQL("DROP TRIGGER refuse_back_$table") }
    }

    @Test
    fun theSameWordsShownAgainAreAShowingOfTheirOwn() {
        snackbars.show(NotesMessage.CouldNotChange)
        val first = checkNotNull(snackbars.showing.value)

        snackbars.show(NotesMessage.CouldNotChange)

        val second = checkNotNull(snackbars.showing.value)
        assertEquals(NotesMessage.CouldNotChange, second.message)
        assertTrue("The second showing is not the first", second != first)
        snackbars.gone(NotesMessage.CouldNotChange)
        assertNull(snackbars.showing.value)
    }

    @Test
    fun anUndoActsOnlyOnTheSnackbarWhoseButtonWasPressed() {
        val trip = phone.note("Trip", "Secret")
        val shopping = phone.note("Shopping", "Bread")
        val pressed = NotesMessage.NoteDeleted(checkNotNull(runBlocking { repository.deleteNote(trip) }))
        snackbars.show(pressed)
        // Another Undo snackbar takes its place between the press and its arrival.
        val later = NotesMessage.NoteDeleted(checkNotNull(runBlocking { repository.deleteNote(shopping) }))
        snackbars.show(later)

        snackbars.undo(pressed)

        eventually { stored(trip)?.let(NoteRules::isWiped) == true }
        assertNotNull("The later deletion is not undone", stored(shopping)?.record?.deletedAt)
        assertEquals(later, snackbars.current.value)
    }

    @Test
    fun removingAFileThenClosingTheEmptyNoteKeepsTheNoteSoThatUndoBringsTheFileBack() {
        val id = phone.note("Photo", "")
        val note = open(id)
        note.state.await { !it.loading }
        note.addFiles(listOf(TestPick()))
        val file = note.state.await { it.files.size == 1 }.files.single().file
        note.onTitleChange("")

        note.removeFile(file)
        snackbars.current.await { it is NotesMessage.FileRemoved }
        note.close()
        note.state.await { it.closed }
        snackbars.undo()

        eventually { runBlocking { repository.filesOf(id).first() }.size == 1 }
        assertNull(stored(id)?.record?.deletedAt)
        assertEquals("", stored(id)?.title)
    }

    @Test
    fun anEmptyNoteKeptForTheUndoOfItsFileIsDeletedWhenThatUndoEnds() {
        val id = phone.note("Photo", "")
        val note = open(id)
        note.state.await { !it.loading }
        note.addFiles(listOf(TestPick()))
        val file = note.state.await { it.files.size == 1 }.files.single().file
        note.onTitleChange("")
        note.removeFile(file)
        val removed = checkNotNull(snackbars.current.await { it is NotesMessage.FileRemoved })
        note.close()
        note.state.await { it.closed }
        assertNull("Kept while Undo may bring the file back", stored(id)?.record?.deletedAt)

        snackbars.gone(removed)

        eventually { stored(id)?.let(NoteRules::isWiped) == true }
    }

    @Test
    fun aNoteOpenedAgainBeforeTheUndoOfItsFileEndsIsNotDeletedUnderIt() {
        val id = phone.note("Photo", "")
        val note = open(id)
        note.state.await { !it.loading }
        note.addFiles(listOf(TestPick()))
        val file = note.state.await { it.files.size == 1 }.files.single().file
        note.onTitleChange("")
        note.removeFile(file)
        val removed = checkNotNull(snackbars.current.await { it is NotesMessage.FileRemoved })
        note.close()
        note.state.await { it.closed }
        open(id).state.await { !it.loading }

        snackbars.gone(removed)

        eventually { snackbars.openUndoIds.isEmpty() }
        assertNull("The open note stays", stored(id)?.record?.deletedAt)
    }

    @Test
    fun aStoredNoteClosedEmptyWhileItsAddRunsIsDeletedWhenTheAddFails() {
        val id = phone.note("Trip", "")
        val note = open(id)
        note.state.await { !it.loading }
        val release = CountDownLatch(1)
        // A file whose provider answers slowly, then cannot be read.
        val slow = object : PickedFile by TestPick("ticket.jpg", failOpen = true) {
            override fun name(): String? {
                release.await()
                return "ticket.jpg"
            }
        }
        note.onTitleChange("")
        note.addFiles(listOf(slow))
        note.close()
        note.state.await { it.closed }
        assertNull("Kept while its add runs", stored(id)?.record?.deletedAt)

        release.countDown()

        eventually { stored(id)?.let(NoteRules::isWiped) == true }
    }

    @Test
    fun aStoredNoteClosedWhileItsAddRunsIsKeptWhenTheAddGivesItAFile() {
        val id = phone.note("Trip", "")
        val note = open(id)
        note.state.await { !it.loading }
        val release = CountDownLatch(1)
        val slow = object : PickedFile by TestPick("ticket.jpg") {
            override fun name(): String? {
                release.await()
                return "ticket.jpg"
            }
        }
        note.onTitleChange("")
        note.addFiles(listOf(slow))
        note.close()
        note.state.await { it.closed }

        release.countDown()

        eventually { runBlocking { repository.filesOf(id).first() }.size == 1 }
        eventually { adds.adding.value.isEmpty() }
        assertNull("A note with a file stays", stored(id)?.record?.deletedAt)
    }

    @Test
    fun aNoteThatOpensWhileItIsLookedAtAgainIsNotDeletedUnderIt() {
        val id = emptyNote()
        snackbars.closedKept(id)
        val reading = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val opening = scope.async { snackbars.opening(id) { reading.complete(Unit); release.await() } }
        runBlocking { reading.await() }

        val look = scope.async { snackbars.lookAgain(id) }
        release.complete(Unit)

        runBlocking {
            opening.await()
            look.await()
        }
        assertNull("The note opened first, so the look leaves it", stored(id)?.record?.deletedAt)
    }

    @Test
    fun aNoteThatIsLookedAtAgainBeforeItOpensIsGoneWhenItIsRead() {
        val id = emptyNote()
        snackbars.closedKept(id)

        runBlocking { snackbars.lookAgain(id) }

        assertTrue(runBlocking { snackbars.opening(id) { stored(id)?.record?.deletedAt != null } })
    }

    @Test
    fun aRemovedFilesUndoThatEndsWhileAnotherFileIsAddedLeavesTheNote() {
        val id = phone.note("Photo", "")
        val note = open(id)
        note.state.await { !it.loading }
        note.addFiles(listOf(TestPick()))
        val file = note.state.await { it.files.size == 1 }.files.single().file
        note.onTitleChange("")
        note.removeFile(file)
        val removed = checkNotNull(snackbars.current.await { it is NotesMessage.FileRemoved })
        val release = CountDownLatch(1)
        val slow = object : PickedFile by TestPick("map.jpg") {
            override fun name(): String? {
                release.await()
                return "map.jpg"
            }
        }
        note.addFiles(listOf(slow))
        note.close()
        note.state.await { it.closed }

        snackbars.gone(removed)
        eventually { snackbars.openUndoIds.isEmpty() }
        assertNull("Files are still being added to it", stored(id)?.record?.deletedAt)
        release.countDown()

        eventually { runBlocking { repository.filesOf(id).first() }.size == 1 }
        eventually { adds.adding.value.isEmpty() }
        assertNull(stored(id)?.record?.deletedAt)
    }

    @Test
    fun leavingTheScreenSavesWhatIsTyped() {
        val id = phone.note("Trip", "")
        val note = open(id)
        note.state.await { !it.loading }
        note.onBodyChange(TextEdit("Passport", 8))

        note.leftScreen()

        eventually { stored(id)?.body == "Passport" }
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
    fun anUndoWhoseWriteEndsAfterNotesLeftEndsAtOnce() {
        val id = phone.note("Trip", "Secret")

        val message = runBlocking {
            snackbars.offer {
                val undo = checkNotNull(repository.deleteNote(id))
                // Notes leaves the screen while the write runs.
                snackbars.endUndo()
                NotesMessage.NoteDeleted(undo)
            }
        }

        assertNotNull("The note is deleted", message)
        assertNull("No snackbar shows after the leave", snackbars.current.value)
        eventually { stored(id)?.let(NoteRules::isWiped) == true }
    }

    @Test
    fun anUndoThatEndedCountsAsOpenUntilItsWipeIsDone() {
        val id = phone.note("Trip", "Secret")
        val held = Held()
        val heldSnackbars = NotesSnackbars(repository, {}, scope, held.dispatcher)
        val message = NotesMessage.NoteDeleted(checkNotNull(runBlocking { repository.deleteNote(id) }))
        heldSnackbars.show(message)

        heldSnackbars.gone(message)

        // The wipe has not run yet. The move of the file keys must still leave the note alone: a new change number would
        // make the wipe pass it over. (The move gets these ids in its turn; the test reads them without the turn, which
        // the held work may hold.)
        assertEquals(setOf(id), heldSnackbars.openUndoIds)
        held.runUntil { stored(id)?.let(NoteRules::isWiped) == true }
        held.runUntil { heldSnackbars.openUndoIds.isEmpty() }
    }

    @Test
    fun theSaveWhenNotesLeavesTheScreenGoesOnWhenTheScreenGoes() {
        val id = repository.reserveNoteId()
        assertNull("A new note writes nothing before its first save", stored(id))
        val held = Held()
        val store = ViewModelStore()
        val note = ViewModelProvider.create(
            store,
            viewModelFactory { initializer { NoteViewModel(repository, adds, reader, snackbars, id, scope, held.dispatcher, wait) { elapsed } } },
        )[NoteViewModel::class]
        held.runUntil { !note.state.value.loading }
        note.onTitleChange("Trip")

        note.leftScreen()
        // The screen goes before the save could start.
        store.clear()

        held.runUntil { stored(id) != null && !repository.isNewNote(id) }
        assertEquals("Trip", stored(id)?.title)
    }

    @Test
    fun whatIsTypedIsSavedWhenTheScreenGoesBeforeItsSave() {
        val id = repository.reserveNoteId()
        assertNull("A new note writes nothing before its first save", stored(id))
        val store = ViewModelStore()
        val note = ViewModelProvider.create(store, viewModelFactory { initializer { open(id) } })[NoteViewModel::class]
        note.state.await { !it.loading }
        note.onBodyChange(TextEdit("Passport", 8))
        eventually { pauses.isNotEmpty() }

        store.clear()

        eventually { stored(id)?.body == "Passport" }
        eventually { !repository.isNewNote(id) }
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
    fun theStatesOfTheFilesAreReadOnlyWhileTheGateIsOpenAndAgainEachTimeItOpens() {
        val id = phone.note("Trip", "")
        val adding = open(id)
        adding.state.await { !it.loading }
        adding.addFiles(listOf(TestPick()))
        adding.state.await { it.files.size == 1 }
        val gate = MutableStateFlow(false)

        val note = NoteViewModel(repository, adds, reader, snackbars, id, scope, Dispatchers.IO, wait, gate) { elapsed }

        note.state.await { !it.loading }
        assertFalse("Locked, the states are not read", note.state.value.filesLoaded)
        gate.value = true
        assertEquals(FileState.READY, note.state.await { it.filesLoaded }.files.single().state)
    }

    @Test
    fun saveACopyByTheFilesIdFindsTheFileAlsoBeforeTheRowsAreRead() {
        val id = phone.note("Trip", "")
        val adding = open(id)
        adding.state.await { !it.loading }
        adding.addFiles(listOf(TestPick()))
        val file = adding.state.await { it.files.size == 1 }.files.single().file
        val note = NoteViewModel(repository, adds, reader, snackbars, id, scope, Dispatchers.IO, wait, MutableStateFlow(false)) { elapsed }
        val target = TestTarget()

        note.saveCopyOf(file.id, target)

        assertEquals(NotesMessage.Copy(CopyResult.SAVED), snackbars.current.await { it is NotesMessage.Copy })
        assertEquals(2_400, target.written.size())
    }

    @Test
    fun saveACopyOfAFileThatIsGoneDeletesTheEmptyDocument() {
        val id = phone.note("Trip", "")
        val note = open(id)
        note.state.await { !it.loading }
        val target = TestTarget()

        note.saveCopyOf("7c9e6679-7425-40de-944b-e07fc1f90ae7", target)

        assertEquals(NotesMessage.Copy(CopyResult.FAILED), snackbars.current.await { it is NotesMessage.Copy })
        assertTrue(target.deleted)
    }

    @Test
    fun aSecondCopyWhileOneIsSavedIsRefusedAndItsDocumentDeleted() {
        val id = phone.note("Trip", "")
        val note = open(id)
        note.state.await { !it.loading }
        note.addFiles(listOf(TestPick()))
        val file = note.state.await { it.files.size == 1 }.files.single().file
        val release = CountDownLatch(1)
        val written = ByteArrayOutputStream()
        val first = object : CopyTarget {
            override fun open(): OutputStream {
                release.await()
                return written
            }

            override fun delete(): Boolean = true
        }
        val second = TestTarget()

        note.saveCopyOf(file.id, first)
        assertEquals("The dialog shows at once, before the file is looked up", 0f, note.state.value.copying)
        note.saveCopyOf(file.id, second)

        assertEquals(NotesMessage.Copy(CopyResult.FAILED), snackbars.current.await { it is NotesMessage.Copy })
        assertTrue("Its document is not left empty", second.deleted)
        release.countDown()
        snackbars.current.await { it == NotesMessage.Copy(CopyResult.SAVED) }
        assertEquals(2_400, written.size())
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
