package app.shkriuss.feature.notes

import android.os.Looper
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import app.shkriuss.feature.notes.data.NoteEntity
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * Which note is open, and the image view in its place
 * (docs/apps/notes/spec.md, "Notes", point 4, "Saving", point 1, and "The
 * image view"), on a real database in memory: another note opens only once
 * the open one has closed after its save; a refused save asks first, and
 * keeping the note open gives up a new note that waited; an empty new note
 * is gone when it closes.
 */
@RunWith(RobolectricTestRunner::class)
class OpenNoteViewModelTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val folder by lazy { temporary.newFolder() }
    private val phone by lazy { Phone(folder) }
    private val crypto by lazy { cryptoIn(File(folder, "shk-keys")).crypto }
    private val repository get() = phone.repository
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val givenUp = CopyOnWriteArrayList<String>()

    private val snackbars by lazy { NotesSnackbars(repository, {}, scope, Dispatchers.IO) }
    private val adds by lazy { FileAdds(repository, crypto.files, MutableStateFlow(true), Mutex(), {}, scope, Dispatchers.IO) }
    private val reader by lazy { FileReader(repository, crypto.files, { false }, Dispatchers.IO) }
    private val store = ViewModelStore()

    /** The saved state of the screen, which Android keeps when it stops Notes. */
    private val saved = SavedStateHandle()

    private val model: OpenNoteViewModel by lazy { makeModel(store) }

    private fun makeModel(
        owner: ViewModelStore,
        isStored: suspend (String) -> Boolean = { id -> repository.findNote(id) != null },
    ): OpenNoteViewModel = ViewModelProvider(
        owner,
        viewModelFactory {
            initializer {
                OpenNoteViewModel(
                    make = { id -> NoteViewModel(repository, adds, reader, snackbars, id, scope, Dispatchers.IO, wait = {}) },
                    giveUp = { id ->
                        givenUp += id
                        repository.giveUpNewNote(id)
                    },
                    saved = saved,
                    reserveNew = { repository.reserveNewNote() },
                    isStored = isStored,
                )
            }
        },
    )[OpenNoteViewModel::class.java]

    @After
    fun close() {
        store.clear()
        scope.cancel()
        phone.close()
    }

    @Test
    fun anotherNoteOpensOnceTheOpenOneHasClosedAfterItsSave() {
        val trip = phone.note("Trip", "Passport")
        val shopping = phone.note("Shopping", "Bread")
        model.open(trip)
        val first = openModel(trip)
        first.state.await { !it.loading }
        first.onTitleChange("Trip to Batumi")

        model.open(shopping)

        openModel(shopping)
        assertEquals("Trip to Batumi", repository.notesNow().single { it.id == trip }.title)
    }

    @Test
    fun anEmptyNewNoteIsGoneWhenItCloses() {
        val id = runBlocking { checkNotNull(repository.reserveNewNote()) }
        model.open(id, isNew = true)
        openModel(id)
        assertTrue(checkNotNull(model.open.value).isNew)

        model.close()

        eventually {
            idle()
            model.open.value == null
        }
        assertTrue(repository.notesNow().isEmpty())
        assertTrue("A closed new note no longer counts towards 5,000", !repository.isNewNote(id))
    }

    @Test
    fun aRefusedSaveAsksFirstAndKeepingTheNoteOpenGivesUpTheNewNoteThatWaited() {
        val trip = phone.note("Trip", "Passport")
        model.open(trip)
        val first = openModel(trip)
        first.state.await { !it.loading }
        runBlocking {
            phone.database.useWriterConnection {
                it.executeSQL("CREATE TRIGGER refuse BEFORE UPDATE ON ${NoteEntity.TABLE} BEGIN SELECT RAISE(ABORT, 'refused'); END")
            }
        }
        first.onTitleChange("Trip to Batumi")
        first.state.await { it.saveFailed }
        val waiting = runBlocking { checkNotNull(repository.reserveNewNote()) }

        model.open(waiting, isNew = true)
        first.state.await { it.askUnsaved }
        model.keepEditing()

        first.state.await { !it.askUnsaved }
        assertEquals(trip, model.open.value?.model?.noteId)
        assertEquals(listOf(waiting), givenUp)
        assertEquals("Trip to Batumi", first.state.value.title)
    }

    @Test
    fun afterAndroidStoppedNotesTheNoteAndItsImageViewOpenAgain() {
        val trip = phone.note("Trip", "Passport")
        model.open(trip)
        openModel(trip)
        model.openImage("file")

        // Android stopped Notes: the ViewModels are gone, and the saved state comes back.
        val again = ViewModelStore()
        try {
            val restored = makeModel(again)
            eventually {
                idle()
                restored.open.value?.model?.noteId == trip
            }
            assertEquals("file", restored.open.value?.imageId)
            assertTrue("A note that opens again is not new", restored.open.value?.isNew == false)
        } finally {
            again.clear()
        }
    }

    @Test
    fun aNewNoteThatWasNotStoredWhenAndroidStoppedNotesGetsANewReservationInTheSamePane() {
        val lost = runBlocking { checkNotNull(repository.reserveNewNote()) }
        model.open(lost, isNew = true)
        openModel(lost)
        // Android stops Notes: the reservation goes with it, and the saved state stays.
        repository.giveUpNewNote(lost)

        val again = ViewModelStore()
        try {
            val restored = makeModel(again)
            eventually {
                idle()
                restored.open.value != null
            }
            val open = checkNotNull(restored.open.value)
            assertTrue("Another note takes its place", open.model.noteId != lost)
            assertTrue(open.isNew)
            assertTrue("It is reserved, so its first file makes it", repository.isNewNote(open.model.noteId))
            assertEquals("In the same pane, with the launchers of its pickers", lost, open.paneKey)
        } finally {
            again.clear()
        }
    }

    @Test
    fun aNoteTappedWhileANewNoteIsRestoredStaysOpen() {
        val lost = runBlocking { checkNotNull(repository.reserveNewNote()) }
        model.open(lost, isNew = true)
        openModel(lost)
        repository.giveUpNewNote(lost)
        val trip = phone.note("Trip", "Passport")
        val answer = CompletableDeferred<Unit>()

        val again = ViewModelStore()
        try {
            val restored = makeModel(again) { id ->
                answer.await()
                repository.findNote(id) != null
            }
            idle()
            assertNull("Still finding out whether the new note is stored", restored.open.value)
            restored.open(trip)
            answer.complete(Unit)

            eventually {
                idle()
                givenUp.isNotEmpty()
            }
            assertEquals("The last tap wins", trip, restored.open.value?.model?.noteId)
            assertTrue("The note reserved in vain is given up", givenUp.single() != lost)
        } finally {
            again.clear()
        }
    }

    @Test
    fun aNewNoteThatWasStoredOpensAgainAsItWas() {
        val id = runBlocking { checkNotNull(repository.reserveNewNote()) }
        model.open(id, isNew = true)
        val first = openModel(id)
        first.state.await { !it.loading }
        first.onTitleChange("Trip")
        first.state.await { it.stored }

        val again = ViewModelStore()
        try {
            val restored = makeModel(again)
            eventually {
                idle()
                restored.open.value?.model?.noteId == id
            }
            assertTrue(restored.open.value?.isNew == false)
        } finally {
            again.clear()
        }
    }

    @Test
    fun aNewNoteThatWasStoredOpensAgainWithItsImageView() {
        val id = runBlocking { checkNotNull(repository.reserveNewNote()) }
        model.open(id, isNew = true)
        val first = openModel(id)
        first.state.await { !it.loading }
        first.onTitleChange("Trip")
        first.state.await { it.stored }
        model.openImage("file")

        val again = ViewModelStore()
        try {
            val restored = makeModel(again)
            eventually {
                idle()
                restored.open.value?.model?.noteId == id
            }
            assertEquals("file", restored.open.value?.imageId)
        } finally {
            again.clear()
        }
    }

    @Test
    fun aTapOnTheOpenNoteWhileItClosesForAnotherOneOpensItAgainAfter() {
        val trip = phone.note("Trip", "Passport")
        val shopping = phone.note("Shopping", "Bread")
        model.open(trip)
        val first = openModel(trip)
        first.state.await { !it.loading }
        runBlocking {
            phone.database.useWriterConnection {
                it.executeSQL("CREATE TRIGGER refuse BEFORE UPDATE ON ${NoteEntity.TABLE} BEGIN SELECT RAISE(ABORT, 'refused'); END")
            }
        }
        first.onTitleChange("Trip to Batumi")
        first.state.await { it.saveFailed }
        model.open(shopping)
        first.state.await { it.askUnsaved }

        model.open(trip)
        first.discard()

        eventually {
            idle()
            model.open.value?.model.let { it != null && it !== first }
        }
        assertEquals("The last tap wins", trip, model.open.value?.model?.noteId)
    }

    @Test
    fun theImageViewTakesThePlaceOfTheNoteAndTheNoteShowsAgain() {
        val trip = phone.note("Trip", "Passport")
        model.open(trip)
        openModel(trip)

        model.openImage("file")
        assertEquals("file", model.open.value?.imageId)
        model.open(trip)
        assertNull("Opening the open note shows the note", model.open.value?.imageId)
        model.openImage("file")
        model.closeImage()
        assertNull(model.open.value?.imageId)
    }

    /** Waits until the note [id] is open, and gives its ViewModel. */
    private fun openModel(id: String): NoteViewModel {
        eventually {
            idle()
            model.open.value?.model?.noteId == id
        }
        return checkNotNull(model.open.value).model
    }

    /** Runs what waits on the main thread, where the ViewModel watches the open note close. */
    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    private fun NotesRepository.notesNow(): List<Note> = runBlocking { notes().first() }
}
