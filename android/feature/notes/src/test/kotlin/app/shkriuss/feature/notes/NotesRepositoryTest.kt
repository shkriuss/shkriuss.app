package app.shkriuss.feature.notes

import android.database.SQLException
import androidx.room3.withWriteTransaction
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.feature.notes.data.AttachmentEntity
import app.shkriuss.feature.notes.data.NoteEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The writes of [NotesRepository] on a real database in memory and a real
 * folder of streams: saving, **Pin**, **Delete note**, **Remove**,
 * **Undo**, the wipe when an Undo ends, an empty note that closes, and the
 * sweep at start (docs/apps/notes/spec.md, "Saving", "Data", "Removing a
 * file, and the wipe", "When things go wrong"). The records of files are
 * written here with a stand-in key; the adds with real keys are in
 * `FileAddsTest`.
 */
@RunWith(RobolectricTestRunner::class)
class NotesRepositoryTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val phone by lazy { Phone(temporary.newFolder()) }
    private val repository get() = phone.repository
    private val key = NoteLimits.WRAPPED_KEY_START + ByteArray(168) { 1 }

    @After
    fun close() = phone.close()

    private fun stored(id: String): NoteEntity? = runBlocking { phone.database.notes().find(id) }

    private fun storedFile(id: String): AttachmentEntity? = runBlocking { phone.database.attachments().find(id) }

    /** Adds the record of a file to [noteId], with a stream on the phone, as an add does once its copy is written. */
    private fun file(noteId: String, name: String = "ticket.jpg", size: Long = 10): String = runBlocking {
        val id = repository.reserveFileId()
        phone.store.folder.mkdirs()
        phone.store.stream(id).writeBytes(ByteArray(StreamLength.of(size).toInt()))
        check(repository.addFile(noteId, id, name, "image/jpeg", size, key) == FileAdded.ADDED)
        repository.releaseFileId(id)
        id
    }

    @Test
    fun aNewNoteWritesNothingUntilItHasATitleOrAText() = runBlocking {
        val id = repository.reserveNoteId()

        assertEquals(Saved.NOTHING, repository.save(id, "", ""))
        assertNull(stored(id))
        assertTrue(repository.isNewNote(id))

        assertEquals(Saved.WRITTEN, repository.save(id, "", "Passport"))
        assertEquals("Passport", stored(id)?.body)
        assertFalse("Made: no longer reserved", repository.isNewNote(id))
        assertEquals(false, stored(id)?.pinned)
    }

    @Test
    fun aSaveWithNoChangeWritesNothing() = runBlocking {
        val id = phone.note("Trip", "Passport")
        val before = stored(id)
        phone.clock.advanceBy(1_000)

        assertEquals(Saved.NOTHING, repository.save(id, "Trip", "Passport"))
        assertEquals(before, stored(id))

        assertEquals(Saved.WRITTEN, repository.save(id, "Trip", "Passport and tickets"))
        assertEquals(phone.clock.nowMillis, stored(id)?.record?.updatedAt)
    }

    @Test
    fun aSaveOfADeletedOrGivenUpNoteWritesNothing() = runBlocking {
        val id = phone.note()
        checkNotNull(repository.deleteNote(id))
        val givenUp = repository.reserveNoteId().also(repository::giveUpNewNote)

        assertEquals(Saved.GONE, repository.save(id, "Trip", "More"))
        assertEquals(Saved.GONE, repository.save(givenUp, "Trip", "More"))
        assertEquals("Trip", stored(id)?.title)
        assertNull(stored(givenUp))
    }

    @Test
    fun aPressCarriesTheStateItShowed() = runBlocking {
        val id = phone.note()

        assertTrue(repository.setPinned(id, shownPinned = false))
        assertEquals(true, stored(id)?.pinned)
        assertFalse("Pin on a pinned note does nothing", repository.setPinned(id, shownPinned = false))
        assertTrue(repository.setPinned(id, shownPinned = true))
        assertEquals(false, stored(id)?.pinned)
    }

    @Test
    fun deletingANoteMarksItAndItsFilesDeletedAndUndoBringsBothBack() = runBlocking {
        val id = phone.note("Trip", "Passport")
        val ticket = file(id)
        val passport = file(id, "passport.pdf")
        val removedBefore = file(id, "old.jpg").also { checkNotNull(repository.removeFile(it)) }

        val undo = checkNotNull(repository.deleteNote(id))

        assertNotNull(stored(id)?.record?.deletedAt)
        assertNotNull(storedFile(ticket)?.record?.deletedAt)
        assertNotNull(storedFile(passport)?.record?.deletedAt)
        assertEquals("The content stays until the Undo ends", "Passport", stored(id)?.body)
        assertEquals(setOf(id, ticket, passport), undo.ids)
        assertNull("Deleted twice: one delete", repository.deleteNote(id))

        assertTrue(repository.undo(undo))

        assertNull(stored(id)?.record?.deletedAt)
        assertNull(storedFile(ticket)?.record?.deletedAt)
        assertNull(storedFile(passport)?.record?.deletedAt)
        assertNotNull("A file removed before stays removed", storedFile(removedBefore)?.record?.deletedAt)
        assertFalse("Undo twice: once", repository.undo(undo))
    }

    @Test
    fun undoActsOnlyOnRecordsThatDidNotChangeSince() = runBlocking {
        val id = phone.note()
        val ticket = file(id)
        val undo = checkNotNull(repository.deleteNote(id))
        // A restore brings the note back meanwhile, with a later edit: its change number moves.
        RecordWriter(phone.database, phone.database.notes(), phone.clock, phone.ids).restore(id)
        RecordWriter(phone.database, phone.database.notes(), phone.clock, phone.ids).markDeleted(id)

        assertFalse(repository.undo(undo))

        assertNotNull("The note stays as it is", stored(id)?.record?.deletedAt)
        assertNotNull("A file comes back only while its note is shown", storedFile(ticket)?.record?.deletedAt)
    }

    @Test
    fun removingAFileAndItsUndoEachRaiseTheNotesFileChanges() = runBlocking {
        val id = phone.note()
        val ticket = file(id)
        assertEquals(1, stored(id)?.fileChanges)
        phone.clock.advanceBy(1_000)

        val undo = checkNotNull(repository.removeFile(ticket))
        assertEquals(2, stored(id)?.fileChanges)
        assertEquals("The note's last change moves with its file", phone.clock.nowMillis, stored(id)?.record?.updatedAt)
        assertNotNull(storedFile(ticket)?.record?.deletedAt)
        assertTrue("The stream stays until the Undo ends", phone.store.has(ticket))

        // The note is edited meanwhile: the Undo of a removed file checks only the file's change number.
        repository.save(id, "Trip", "Edited")
        phone.clock.advanceBy(1_000)
        assertTrue(repository.undo(undo))

        assertNull(storedFile(ticket)?.record?.deletedAt)
        assertEquals(3, stored(id)?.fileChanges)
        assertEquals(phone.clock.nowMillis, stored(id)?.record?.updatedAt)
    }

    @Test
    fun whenAnUndoEndsTheRecordsThatAreStillDeletedAreWipedAndTheirStreamsRemoved() = runBlocking {
        val id = phone.note("Trip", "Passport")
        val ticket = file(id)
        repository.setPinned(id, shownPinned = false)
        val undo = checkNotNull(repository.deleteNote(id))
        val deleted = checkNotNull(stored(id))

        repository.wipe(undo)

        val note = checkNotNull(stored(id))
        assertEquals(NoteRules.wiped(deleted).copy(changeNumber = note.changeNumber), note)
        assertEquals("The four record fields stay as they were", deleted.record, note.record)
        assertTrue(NoteRules.isWiped(checkNotNull(storedFile(ticket))))
        assertEquals(id, storedFile(ticket)?.noteId)
        assertFalse(phone.store.has(ticket))
        assertFalse("A wiped note is never brought back", repository.undo(undo))
    }

    @Test
    fun theWipeOfAnUndoLeavesAFileThatWasRemovedAgainToItsNewUndo() = runBlocking {
        val id = phone.note("Trip", "Passport")
        val ticket = file(id)
        val first = checkNotNull(repository.removeFile(ticket))
        assertTrue(repository.undo(first))
        val second = checkNotNull(repository.removeFile(ticket))

        repository.wipe(first)

        assertEquals("ticket.jpg", storedFile(ticket)?.name)
        assertTrue(phone.store.has(ticket))
        assertTrue("The new Undo still brings it back", repository.undo(second))
    }

    @Test
    fun aRecordThatAnUndoBroughtBackIsNotWiped() = runBlocking {
        val id = phone.note("Trip", "Passport")
        val ticket = file(id)
        val undo = checkNotNull(repository.removeFile(ticket))
        repository.undo(undo)

        repository.wipe(undo)

        assertEquals("ticket.jpg", storedFile(ticket)?.name)
        assertTrue(phone.store.has(ticket))
    }

    @Test
    fun anEmptyNoteIsDeletedAndWipedWhenItCloses() = runBlocking {
        val empty = phone.note("Trip").also { repository.save(it, "", "") }
        repository.setPinned(empty, shownPinned = false)
        val withText = phone.note("", "Passport")
        val withFile = phone.note("Trip").also { file(it) }.also { repository.save(it, "", "") }

        assertTrue(repository.deleteIfEmpty(empty))
        assertFalse(repository.deleteIfEmpty(withText))
        assertFalse("A note with a file is not empty", repository.deleteIfEmpty(withFile))

        assertNotNull(stored(empty)?.record?.deletedAt)
        assertTrue(NoteRules.isWiped(checkNotNull(stored(empty))))
        assertNull(stored(withText)?.record?.deletedAt)
        assertNull(stored(withFile)?.record?.deletedAt)
    }

    @Test
    fun aNoteWhoseRemovedFileIsNotWipedYetIsNotEmpty() = runBlocking {
        val id = phone.note("Trip").also { repository.save(it, "", "") }
        val ticket = file(id)
        val undo = checkNotNull(repository.removeFile(ticket))

        assertFalse("The Undo of the file is still open", repository.deleteIfEmpty(id))
        assertTrue(repository.undo(undo))
        assertNull(storedFile(ticket)?.record?.deletedAt)

        repository.wipe(checkNotNull(repository.removeFile(ticket)))
        assertTrue("Once the file is wiped, the note is empty", repository.deleteIfEmpty(id))
    }

    @Test
    fun aFileOfANoteThatWasDeletedWhileItWasCopiedIsNotWritten() = runBlocking {
        val id = phone.note()
        checkNotNull(repository.deleteNote(id))
        val givenUp = repository.reserveNoteId().also(repository::giveUpNewNote)

        val fileId = repository.reserveFileId()
        assertEquals(FileAdded.NOTE_DELETED, repository.addFile(id, fileId, "ticket.jpg", "image/jpeg", 10, key))
        assertEquals(FileAdded.NOTE_DELETED, repository.addFile(givenUp, fileId, "ticket.jpg", "image/jpeg", 10, key))
        assertNull(storedFile(fileId))
        assertEquals(0, stored(id)?.fileChanges)
    }

    @Test
    fun theFirstFileOfANewNoteMakesTheNote() = runBlocking {
        val id = repository.reserveNoteId()

        val ticket = file(id)

        assertEquals(1, stored(id)?.fileChanges)
        assertEquals("", stored(id)?.title)
        assertEquals(id, storedFile(ticket)?.noteId)
        assertArrayEquals(key, storedFile(ticket)?.wrappedKey)
        assertFalse(repository.isNewNote(id))
    }

    @Test
    fun theSweepMarksDeletedTheFilesOfDeletedNotesWipesAndRemovesTheStreamsNoFileNeeds() = runBlocking {
        val shown = phone.note("Kept", "Kept")
        val kept = file(shown)
        val gone = phone.note("Gone", "Secret")
        val ofGone = file(gone)
        // Notes stopped between the delete of the note and the wipe: the files of a note that a restore
        // deleted stay shown, and the note keeps its content.
        RecordWriter(phone.database, phone.database.notes(), phone.clock, phone.ids).markDeleted(gone)
        val stray = phone.store.stream("00000000-0000-4000-8000-0000000000ff").apply { writeBytes(ByteArray(3)) }
        val part = phone.store.part("00000000-0000-4000-8000-0000000000fe").apply { writeBytes(ByteArray(3)) }

        assertTrue(repository.sweep(NoUndo))

        assertTrue(NoteRules.isWiped(checkNotNull(stored(gone))))
        assertNotNull(storedFile(ofGone)?.record?.deletedAt)
        assertTrue(NoteRules.isWiped(checkNotNull(storedFile(ofGone))))
        assertFalse(phone.store.has(ofGone))
        assertFalse(stray.exists())
        assertFalse(part.exists())
        assertTrue(phone.store.has(kept))
        assertEquals("Kept", stored(shown)?.body)
        assertTrue("A second sweep finds nothing to do", repository.sweep(NoUndo))
    }

    @Test
    fun theSweepLeavesAloneTheRecordsOfTheUndoThatIsOpen() = runBlocking {
        val id = phone.note("Trip", "Secret")
        val ticket = file(id)
        val undo = checkNotNull(repository.deleteNote(id))
        val open = object : UndoTurns {
            override suspend fun <T> inTurn(action: suspend (openUndo: Set<String>) -> T): T = action(undo.ids)
        }

        repository.sweep(open)

        assertEquals("Secret", stored(id)?.body)
        assertTrue(phone.store.has(ticket))
        assertTrue("Its Undo still counts", repository.undo(undo))
    }

    @Test
    fun aCheckpointThatCannotFinishIsTriedAgainShortlyWithoutKeepingTheCallerWaiting() = runBlocking {
        val results = ArrayDeque(listOf(false, false, true))
        val pauses = mutableListOf<Long>()
        val background = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined)
        val retrying = NotesRepository(
            phone.database,
            phone.clock,
            phone.ids,
            phone.store,
            background,
            checkpoint = { results.removeFirst() },
            wait = { pauses += it },
        )
        val id = phone.note()

        assertFalse("The first try did not finish", retrying.sweep(NoUndo))

        assertEquals(listOf(1_000L, 5_000L), pauses)
        assertTrue("It finished at the third try", results.isEmpty())
        assertNotNull(stored(id))
    }

    @Test
    fun newNoteCountsTheNewNotesThatAreNotMadeYet() = runBlocking {
        val writer = RecordWriter(phone.database, phone.database.notes(), phone.clock, phone.ids)
        phone.database.withWriteTransaction {
            repeat(NoteLimits.MOST_NOTES - 2) { writer.create { fields, number -> NoteEntity(fields, number, "n$it", "", false, 0) } }
        }

        val first = checkNotNull(repository.reserveNewNote())
        assertNotNull(repository.reserveNewNote())
        assertNull("Two reserved and 4,998 shown make 5,000", repository.reserveNewNote())

        repository.giveUpNewNote(first)
        assertNotNull(repository.reserveNewNote())
    }

    @Test
    fun theSweepLeavesAloneThePartAndTheStreamOfAnAddThatRuns() = runBlocking {
        val running = repository.reserveFileId()
        phone.store.folder.mkdirs()
        val part = phone.store.part(running).apply { writeBytes(ByteArray(3)) }
        val stream = phone.store.stream(running).apply { writeBytes(ByteArray(3)) }

        repository.sweep(NoUndo)

        assertTrue(part.exists())
        assertTrue(stream.exists())
        repository.releaseFileId(running)
        repository.sweep(NoUndo)
        assertFalse(stream.exists())
    }

    @Test
    fun aWriteTheDatabaseRefusesChangesNothing() = runBlocking {
        val id = phone.note("Trip", "Passport")
        val ticket = file(id)
        phone.database.refuseWritesTo("note")

        assertThrows(SQLException::class.java) { runBlocking { repository.save(id, "Trip", "Changed") } }
        assertThrows(SQLException::class.java) { runBlocking { repository.deleteNote(id) } }
        assertThrows(SQLException::class.java) { runBlocking { repository.removeFile(ticket) } }

        phone.database.acceptWritesTo("note")
        assertEquals("Passport", stored(id)?.body)
        assertNull(stored(id)?.record?.deletedAt)
        assertNull("The remove rolled back with its note", storedFile(ticket)?.record?.deletedAt)
    }

    @Test
    fun theReadsLeaveDeletedRecordsOut() = runBlocking {
        val shown = phone.note("Shown")
        val gone = phone.note("Gone").also { checkNotNull(repository.deleteNote(it)) }
        val ticket = file(shown)
        file(shown, "old.jpg").also { checkNotNull(repository.removeFile(it)) }

        assertEquals(listOf(shown), repository.noteMarks().first().map { it.id })
        assertEquals(listOf(ticket), repository.filesOf(shown).first().map { it.id })
        assertNull(repository.note(gone).first())
        assertEquals(1, repository.totals().first().count)
        assertEquals(10L, repository.totals().first().bytes)
        assertEquals(10L, repository.shownBytes())
    }

    @Test
    fun undoBringsBackWhatItsActionDeletedAlsoWhenACountThenPassesItsLimit() = runBlocking {
        val id = phone.note("Trip")
        val files = List(NoteLimits.MOST_FILES_PER_NOTE) { file(id, "f$it.jpg") }
        val undo = checkNotNull(repository.removeFile(files.first()))
        // A file added meanwhile fills the note again.
        file(id, "later.jpg")
        assertEquals(NoteLimits.MOST_FILES_PER_NOTE, repository.shownFileCount(id))

        assertTrue(repository.undo(undo))

        assertEquals("A count stops only Add a file", NoteLimits.MOST_FILES_PER_NOTE + 1, repository.shownFileCount(id))
        assertNull(storedFile(files.first())?.record?.deletedAt)
    }

    @Test
    fun undoAndPinAreOneTransactionEachSoARefusedWriteLeavesNothingHalfDone() = runBlocking {
        val id = phone.note("Trip", "Passport")
        val ticket = file(id)
        val undo = checkNotNull(repository.deleteNote(id))
        val deleted = stored(id) to storedFile(ticket)
        // The note comes back first, then its file: the database refuses the file.
        phone.database.refuseWritesTo("attachment")

        assertThrows(SQLException::class.java) { runBlocking { repository.undo(undo) } }

        assertEquals("The note did not come back alone", deleted, stored(id) to storedFile(ticket))
        phone.database.acceptWritesTo("attachment")
        assertTrue("The Undo still counts", repository.undo(undo))
        assertNull(stored(id)?.record?.deletedAt)
        assertNull(storedFile(ticket)?.record?.deletedAt)

        phone.database.refuseWritesTo("note")
        assertThrows(SQLException::class.java) { runBlocking { repository.setPinned(id, shownPinned = false) } }
        phone.database.acceptWritesTo("note")
        assertEquals(false, stored(id)?.pinned)
    }
}
