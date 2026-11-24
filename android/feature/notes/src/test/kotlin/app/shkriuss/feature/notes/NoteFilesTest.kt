package app.shkriuss.feature.notes

import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.feature.notes.data.AttachmentEntity
import java.io.File
import java.io.InputStream
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import org.junit.After
import org.junit.Assert.assertArrayEquals
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
 * Adding files with real keys, reading them back, **Save a copy**, the
 * state of each row, and the move of the file keys to the recovery key
 * (docs/apps/notes/spec.md, "Files"). The keys are software keys on the
 * real code of `core/crypto`.
 */
@RunWith(RobolectricTestRunner::class)
class NoteFilesTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val folder by lazy { temporary.newFolder() }
    private val phone by lazy { Phone(folder) }
    private val keys: SoftwareKeysApp by lazy { cryptoIn(File(folder, "shk-keys")) }
    private val crypto get() = keys.crypto
    private val repository get() = phone.repository
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val canStart = MutableStateFlow(true)
    private val problems = CopyOnWriteArrayList<AddProblem>()
    private val fileKeys = Mutex()
    private var openUndo: Set<String> = emptySet()

    private val adds by lazy { FileAdds(repository, crypto.files, canStart, fileKeys, { problems += it }, scope, Dispatchers.IO) }
    private val reader by lazy { FileReader(repository, crypto.files, { crypto.status().let { it.needsRepair || it.filesCanBeGivenUp } }, Dispatchers.IO) }
    /** The open Undo as the move asks for it, record by record; [asked] counts the questions. */
    private var asked = 0
    private val undoTurns = object : UndoTurns {
        override suspend fun <T> inTurn(action: suspend (openUndo: Set<String>) -> T): T {
            asked++
            return action(openUndo)
        }
    }
    private val keyMove by lazy { FileKeyMove(repository, crypto, fileKeys, undoTurns, Dispatchers.IO) }

    @After
    fun close() {
        scope.cancel()
        phone.close()
    }

    private fun files(noteId: String): List<AttachmentEntity> =
        runBlocking { phone.database.attachments().shownOf(noteId) }.sortedBy { it.record.createdAt }

    /** Adds [picked] to [noteId] and waits until every add ended. */
    private fun add(noteId: String, vararg picked: PickedFile) {
        adds.add(noteId, picked.toList())
        adds.adding.await { it.isEmpty() }
    }

    private fun read(file: NoteFile): ByteArray = runBlocking { reader.open(file).use { it.readBytes() } }

    private fun shown(noteId: String): List<NoteFile> = files(noteId).map(::fileOf)

    @Test
    fun anAddedFileIsEncryptedIntoItsStreamAndReadsBackByteForByte() {
        val id = phone.note()
        val pick = TestPick(bytes = ByteArray(2_400_000) { (it % 251).toByte() })

        add(id, pick)

        val row = files(id).single()
        assertEquals("ticket.jpg", row.name)
        assertEquals("image/jpeg", row.mimeType)
        assertEquals(2_400_000L, row.size)
        assertTrue(NoteRules.isStored(row))
        assertTrue("The stream has the length of its size", phone.store.isWhole(row.record.id, row.size))
        assertFalse("No part is left", phone.store.part(row.record.id).exists())
        assertFalse("The stream is not the file", phone.store.stream(row.record.id).readBytes().contentEquals(pick.bytes))
        assertArrayEquals(pick.bytes, read(fileOf(row)))
        assertEquals(FileState.READY, runBlocking { reader.stateOf(fileOf(row)) })
        assertEquals(emptyList<AddProblem>(), problems)
    }

    @Test
    fun theLengthOfAStreamFollowsTheRuleOfCryptoDesign() {
        val id = phone.note()
        val sizes = listOf(0L, 1L, 1_048_520L, 1_048_521L, 1_048_520L + 1_048_560L, 1_048_520L + 1_048_561L)

        sizes.forEach { size -> add(id, LongPick(size, "f$size")) }

        files(id).forEach { row ->
            assertEquals("A file of ${row.size} bytes", StreamLength.of(row.size), phone.store.stream(row.record.id).length())
        }
        assertEquals(sizes.size, files(id).size)
    }

    @Test
    fun addsRunOneAtATimeInTheOrderTheFilesWerePickedAlsoAcrossNotes() {
        val trip = phone.note("Trip")
        val home = phone.note("Home")
        canStart.value = false

        adds.add(trip, listOf(TestPick("a.jpg"), TestPick("b.jpg")))
        adds.add(home, listOf(TestPick("c.jpg")))
        assertEquals("They wait while Notes may make no key", 3, adds.adding.value.size)
        assertTrue(adds.isAddingTo(home))
        Thread.sleep(50)
        assertEquals(emptyList<AttachmentEntity>(), files(trip))
        canStart.value = true
        adds.adding.await { it.isEmpty() }

        val all = runBlocking { phone.database.attachments().observeShown().first() }
        assertEquals(listOf("a.jpg", "b.jpg", "c.jpg"), all.sortedBy { it.changeNumber }.map { it.name })
        assertFalse(adds.isAddingTo(home))
    }

    @Test
    fun theFirstFileOfANewNoteMakesTheNoteAndAGivenUpNoteGetsNoFile() {
        val fresh = repository.reserveNoteId()
        add(fresh, TestPick())
        assertEquals(1, files(fresh).size)
        assertNotNull(runBlocking { repository.findNote(fresh) })

        val givenUp = repository.reserveNoteId().also(repository::giveUpNewNote)
        add(givenUp, TestPick())
        assertEquals(listOf<AddProblem>(AddProblem.NoteDeleted), problems)
        assertEquals(emptyList<AttachmentEntity>(), files(givenUp))
    }

    @Test
    fun aNoteDeletedWhileTheFileIsCopiedGetsNoFileAndNoStream() {
        val id = phone.note()
        canStart.value = false
        adds.add(id, listOf(TestPick()))
        runBlocking { checkNotNull(repository.deleteNote(id)) }
        canStart.value = true
        adds.adding.await { it.isEmpty() }

        assertEquals(listOf<AddProblem>(AddProblem.NoteDeleted), problems)
        assertEquals(emptyList<File>(), phone.store.list())
    }

    @Test
    fun aNoteHoldsAtMostTwentyFilesAndTheRestOfTheBatchIsNotAdded() {
        val id = phone.note()
        add(id, *Array(18) { TestPick("f$it.jpg", bytes = ByteArray(10)) })

        add(id, *Array(5) { TestPick("g$it.jpg", bytes = ByteArray(10)) })

        assertEquals(20, files(id).size)
        assertEquals(listOf<AddProblem>(AddProblem.NoteFull(3)), problems)
    }

    @Test
    fun aFileLargerThan25MbIsNotAddedAndItsPartIsDeleted() {
        val id = phone.note()

        add(id, LongPick(25_000_001, "film.mp4"))
        add(id, LongPick(25_000_000, "fits.mp4"))

        assertEquals(listOf<AddProblem>(AddProblem.TooLarge("film.mp4")), problems)
        assertEquals(listOf("fits.mp4"), files(id).map { it.name })
        assertEquals(1, phone.store.list().size)
    }

    @Test
    fun theCountOfTheBytesReadIsTheTruthNotTheSizeThePickerReports() {
        val id = phone.note()

        add(id, TestPick(bytes = ByteArray(300), size = 10))

        assertEquals(300L, files(id).single().size)
    }

    @Test
    fun aFileThatCannotBeReadIsNotAdded() {
        val id = phone.note()

        add(id, TestPick(name = "ticket.jpg", failOpen = true), TestPick(name = "half.jpg", failRead = 100))

        assertEquals(listOf<AddProblem>(AddProblem.CouldNotRead("ticket.jpg"), AddProblem.CouldNotRead("half.jpg")), problems)
        assertEquals(emptyList<AttachmentEntity>(), files(id))
        assertEquals(emptyList<File>(), phone.store.list())
    }

    @Test
    fun withNoKeyThatCanBeMadeNowTheFileIsNotAdded() {
        val id = phone.note()
        keys.phoneLocked = true

        add(id, TestPick())

        assertEquals(listOf<AddProblem>(AddProblem.KeysNotUsable), problems)
        assertEquals(emptyList<AttachmentEntity>(), files(id))
        assertEquals(emptyList<File>(), phone.store.list())
    }

    @Test
    fun anyOtherFailureOfAnAddEndsInItsSnackbarAndTheNextFileStillComes() {
        val id = phone.note()
        val failing = object : PickedFile {
            override fun name(): String = "odd.bin"

            override fun type(): String = "application/octet-stream"

            override fun reportedSize(): Long? = null

            override fun open(): InputStream = throw IllegalStateException("A provider that fails in its own way")
        }

        add(id, failing, TestPick("next.jpg"))

        assertEquals(listOf<AddProblem>(AddProblem.CouldNotAdd("odd.bin")), problems)
        assertEquals(listOf("next.jpg"), files(id).map { it.name })
        assertEquals(1, phone.store.list().size)
    }

    @Test
    fun aProviderThatFailsInItsOwnWayWhileItIsReadLeavesNoPart() {
        val id = phone.note()
        val failing = object : PickedFile {
            override fun name(): String = "odd.bin"

            override fun type(): String = "application/octet-stream"

            override fun reportedSize(): Long? = null

            override fun open(): InputStream = object : InputStream() {
                private var read = 0

                override fun read(): Int = if (read++ < 70_000) 1 else throw SecurityException("The permission ended")
            }
        }

        add(id, failing)

        assertEquals(listOf<AddProblem>(AddProblem.CouldNotRead("odd.bin")), problems)
        assertEquals(emptyList<File>(), phone.store.list())
    }

    @Test
    fun theStateOfARowLetsAFailedReadOfTheDatabaseThrough() = runBlocking {
        val id = phone.note()
        add(id, TestPick())
        val file = shown(id).single()
        phone.database.refuseReadsOf("attachment")

        val failure = runCatching { reader.stateOf(file) }.exceptionOrNull()

        assertTrue("Not a state of the keys: $failure", failure is android.database.SQLException)
    }

    @Test
    fun aFailureOfTheStorageWhileTheMoveRunsLeavesItPending() = runBlocking {
        val id = phone.note()
        add(id, TestPick())
        crypto.getRecoveryKey()
        val failing = object : UndoTurns {
            override suspend fun <T> inTurn(action: suspend (openUndo: Set<String>) -> T): T = throw java.io.IOException("The disk is full")
        }

        assertFalse(FileKeyMove(repository, crypto, fileKeys, failing, Dispatchers.IO).run())

        assertTrue(crypto.setup.fileKeyMoveIsPending())
        assertTrue("It goes on later", keyMove.run())
    }

    @Test
    fun aRecordTheDatabaseRefusesLeavesNoStream() {
        val id = phone.note()
        phone.database.refuseWritesTo("attachment")

        add(id, TestPick())

        phone.database.acceptWritesTo("attachment")
        assertEquals(listOf<AddProblem>(AddProblem.CouldNotAdd("ticket.jpg")), problems)
        assertEquals(emptyList<File>(), phone.store.list())
        assertEquals(0, runBlocking { phone.database.notes().find(id) }?.fileChanges)
    }

    @Test
    fun theNameAndTypeComeFromThePickerCutToTheirLimits() {
        val id = phone.note()

        add(id, TestPick(name = null, type = "image/JPEG"), TestPick(name = "a\nb.pdf", type = null))

        assertEquals(listOf("File" to NoteLimits.UNKNOWN_TYPE, "a b.pdf" to NoteLimits.UNKNOWN_TYPE), files(id).map { it.name to it.mimeType })
    }

    @Test
    fun theStateOfARowSaysWhyAFileCannotBeOpened() = runBlocking {
        val id = phone.note()
        add(id, TestPick("missing.jpg"), TestPick("cut.jpg"), TestPick("key.jpg"))
        val (missing, cut, damagedKey) = shown(id)
        phone.store.stream(missing.id).delete()
        phone.store.stream(cut.id).writeBytes(phone.store.stream(cut.id).readBytes().copyOf(100))
        val row = checkNotNull(phone.database.attachments().find(damagedKey.id))
        RecordWriterForTests(phone).sealKey(damagedKey.id, row.wrappedKey.copyOf().also { it[60] = (it[60] + 1).toByte() })

        assertEquals(FileState.NOT_ON_PHONE, reader.stateOf(missing))
        assertEquals(FileState.DAMAGED, reader.stateOf(cut))
        assertEquals(FileState.DAMAGED, reader.stateOf(damagedKey))
    }

    @Test
    fun aCopyIsTheFileByteForByteAndADamagedStreamSavesNoCopy() = runBlocking {
        val id = phone.note()
        val pick = TestPick(bytes = ByteArray(1_500_000) { (it % 7).toByte() })
        add(id, pick, TestPick("damaged.jpg", bytes = ByteArray(1_500_000)))
        val (good, damaged) = shown(id)
        val stream = phone.store.stream(damaged.id)
        stream.writeBytes(stream.readBytes().also { it[1_200_000] = (it[1_200_000] + 1).toByte() })

        val target = TestTarget()
        assertEquals(CopyResult.SAVED, reader.saveCopy(good, target))
        assertArrayEquals(pick.bytes, target.written.toByteArray())

        val spoiled = TestTarget()
        assertEquals(CopyResult.DAMAGED, reader.saveCopy(damaged, spoiled))
        assertTrue("It tried to delete the document", spoiled.deleted)
        assertEquals(CopyResult.DAMAGED_PART_LEFT, reader.saveCopy(damaged, TestTarget(canDelete = false)))
        assertEquals(CopyResult.FAILED, reader.saveCopy(good, TestTarget(failWrite = true)))
        assertEquals(CopyResult.FAILED_PART_LEFT, reader.saveCopy(good, TestTarget(failWrite = true, canDelete = false)))

        val refusing = object : CopyTarget {
            var deleted = false

            override fun open(): java.io.OutputStream = object : java.io.OutputStream() {
                override fun write(byte: Int) = throw SecurityException("The permission ended")
            }

            override fun delete(): Boolean = true.also { deleted = true }
        }
        assertEquals("A provider that fails in its own way", CopyResult.FAILED, reader.saveCopy(good, refusing))
        assertTrue(refusing.deleted)
    }

    @Test
    fun aStreamThatACopyFoundDamagedShowsAsDamagedFromThen() = runBlocking {
        val id = phone.note()
        add(id, TestPick("damaged.jpg", bytes = ByteArray(1_500_000)))
        val damaged = shown(id).single()
        val stream = phone.store.stream(damaged.id)
        stream.writeBytes(stream.readBytes().also { it[1_200_000] = (it[1_200_000] + 1).toByte() })
        assertEquals("The length is right, and no segment was read yet", FileState.READY, reader.stateOf(damaged))

        assertEquals(CopyResult.DAMAGED, reader.saveCopy(damaged, TestTarget()))

        assertEquals(FileState.DAMAGED, reader.stateOf(damaged))
    }

    @Test
    fun aReadThatMeetsDamageMarksTheFileDamaged() = runBlocking {
        val id = phone.note()
        add(id, TestPick("damaged.jpg", bytes = ByteArray(1_500_000)))
        val damaged = shown(id).single()
        val stream = phone.store.stream(damaged.id)
        stream.writeBytes(stream.readBytes().also { it[100] = (it[100] + 1).toByte() })

        val failure = runCatching { read(damaged) }.exceptionOrNull()

        assertTrue(failure is app.shkriuss.core.crypto.BlobException)
        assertEquals(FileState.DAMAGED, reader.stateOf(damaged))
    }

    @Test
    fun theKeysOfFilesAddedBeforeTheRecoveryKeyMoveToItWithUpdatedAtAsItWas() = runBlocking {
        val id = phone.note()
        add(id, TestPick("a.jpg"), TestPick("b.jpg"))
        checkNotNull(repository.removeFile(shown(id).last().id))
        val before = phone.database.attachments().withKeys().associateBy { it.record.id }
        crypto.getRecoveryKey()
        assertTrue(crypto.setup.fileKeyMoveIsPending())
        phone.clock.advanceBy(60_000)

        assertTrue(keyMove.run())

        assertFalse(crypto.setup.fileKeyMoveIsPending())
        val after = phone.database.attachments().withKeys().associateBy { it.record.id }
        assertEquals("A deleted file that is not wiped moves too", before.keys, after.keys)
        after.values.forEach { row ->
            assertEquals(before.getValue(row.record.id).record, row.record)
            assertTrue(crypto.files.isSealedByCurrentKey(row.wrappedKey))
        }
        assertEquals(FileState.READY, reader.stateOf(shown(id).single()))
    }

    @Test
    fun theMoveLeavesAloneTheRecordsOfAnOpenUndoAndWaitsForIt() = runBlocking {
        val id = phone.note()
        add(id, TestPick())
        val undo = checkNotNull(repository.removeFile(shown(id).single().id))
        openUndo = undo.ids
        crypto.getRecoveryKey()

        assertFalse(keyMove.run())
        assertTrue(crypto.setup.fileKeyMoveIsPending())
        assertTrue("The Undo still counts", repository.undo(undo))

        openUndo = emptySet()
        assertTrue(keyMove.run())
        assertFalse(crypto.setup.fileKeyMoveIsPending())
    }

    @Test
    fun anUndoMadeWhileTheMoveRunsKeepsItsChangeNumbers() = runBlocking {
        val id = phone.note()
        add(id, TestPick("a.jpg"), TestPick("b.jpg"))
        val (first, second) = shown(id)
        crypto.getRecoveryKey()
        // The note is deleted once the move has sealed its first file: the move asks again for the second one.
        val deleting = object : UndoTurns {
            var undo: Undo? = null

            override suspend fun <T> inTurn(action: suspend (openUndo: Set<String>) -> T): T {
                val done = action(undo?.ids.orEmpty())
                if (undo == null) undo = repository.deleteNote(first.noteId)
                return done
            }
        }

        assertFalse(FileKeyMove(repository, crypto, fileKeys, deleting, Dispatchers.IO).run())

        assertTrue("The Undo still counts for both files", repository.undo(checkNotNull(deleting.undo)))
        assertEquals(setOf(first.id, second.id), shown(id).map { it.id }.toSet())
        assertTrue(crypto.setup.fileKeyMoveIsPending())
        assertTrue(keyMove.run())
    }

    @Test
    fun theMoveAsksForTheOpenUndoForEachRecord() = runBlocking {
        val id = phone.note()
        add(id, TestPick("a.jpg"), TestPick("b.jpg"), TestPick("c.jpg"))
        crypto.getRecoveryKey()

        assertTrue(keyMove.run())

        assertEquals(3, asked)
    }

    @Test
    fun aKeyThatCannotBeSealedAgainKeepsTheMovePendingUntilItsFileIsRemovedAndWiped() = runBlocking {
        val id = phone.note()
        add(id, TestPick("good.jpg"), TestPick("damaged.jpg"))
        val damaged = shown(id).last()
        val row = checkNotNull(phone.database.attachments().find(damaged.id))
        RecordWriterForTests(phone).sealKey(damaged.id, row.wrappedKey.copyOf().also { it[60] = (it[60] + 1).toByte() })
        crypto.getRecoveryKey()

        assertFalse(keyMove.run())
        assertTrue("Notes never ends the move by itself", crypto.setup.fileKeyMoveIsPending())

        repository.wipe(checkNotNull(repository.removeFile(damaged.id)))
        assertTrue(keyMove.run())
        assertFalse(crypto.setup.fileKeyMoveIsPending())
        assertEquals(FileState.READY, reader.stateOf(shown(id).single()))
    }

    @Test
    fun withNoRecoveryKeyThereIsNoMoveAndFilesWorkFromTheFirstStart() = runBlocking {
        val id = phone.note()
        add(id, TestPick())

        assertTrue(keyMove.run())
        assertEquals(FileState.READY, reader.stateOf(shown(id).single()))
    }
}

/** Writes a wrapped key into a file's record, as a damaged one would be, through the one write that may change it. */
private class RecordWriterForTests(private val phone: Phone) {
    fun sealKey(id: String, key: ByteArray) = runBlocking {
        app.shkriuss.core.data.RecordWriter(phone.database, phone.database.attachments(), phone.clock, phone.ids)
            .sealFileKeyAgain(id) { it.copy(wrappedKey = key) }
    }
}
