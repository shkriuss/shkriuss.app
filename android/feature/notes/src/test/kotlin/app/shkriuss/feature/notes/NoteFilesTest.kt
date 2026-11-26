package app.shkriuss.feature.notes

import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.feature.notes.data.AttachmentEntity
import java.io.File
import java.io.FileInputStream
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
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

    private val adds by lazy { FileAdds(repository, crypto.files, canStart, fileKeys, { problems += it }, { "File" }, scope, Dispatchers.IO) }
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

        val all = runBlocking { phone.database.attachments().every() }
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
    fun aNewNoteClosedWhileItsFilesWaitIsGivenUpWhenTheLastAddFailsAndKeptWhenOneMakesIt() {
        val failing = repository.reserveNoteId()
        val made = repository.reserveNoteId()
        canStart.value = false
        adds.add(failing, listOf(LongPick(25_000_001, "film.mp4")))
        adds.add(made, listOf(TestPick()))

        // Both notes' screens close while their files wait: the adds decide.
        adds.giveUpNewNoteAfterAdds(failing)
        adds.giveUpNewNoteAfterAdds(made)
        assertTrue(repository.isNewNote(failing))
        canStart.value = true
        adds.adding.await { it.isEmpty() }

        assertFalse("It no longer counts towards 5,000", repository.isNewNote(failing))
        assertNull(runBlocking { repository.findNote(failing) })
        assertNotNull("The note that its first file made is kept", runBlocking { repository.findNote(made) })
        assertEquals(1, files(made).size)
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
    fun aPickerThatGivesThousandsOfFilesQueuesOneMoreThanANoteHoldsAndCountsTheRest() {
        val id = phone.note()
        canStart.value = false

        adds.add(id, List(5_000) { TestPick("f$it.jpg", bytes = ByteArray(10)) })

        assertEquals("One more than a note holds waits, not 5,000", 21, adds.adding.value.size)
        canStart.value = true
        adds.adding.await { it.isEmpty() }
        assertEquals(20, files(id).size)
        assertEquals(listOf<AddProblem>(AddProblem.NoteFull(4_980)), problems)
    }

    @Test
    fun aPickWhoseFilesAllFailTriesAtMost42AndTellsTheRestAsNotAdded() {
        val id = phone.note()
        val opened = AtomicInteger()
        val failing = List(5_000) {
            object : PickedFile by TestPick("f$it.jpg", bytes = ByteArray(10), failOpen = true) {
                override fun open(): InputStream {
                    opened.incrementAndGet()
                    throw IOException("The provider stopped")
                }
            }
        }

        add(id, *failing.toTypedArray())
        // The files never tried are told once the last file of the batch has ended, just after its row goes.
        eventually { problems.lastOrNull() is AddProblem.NoteFull }

        assertEquals("Twice the 21 that may wait at a time", 42, opened.get())
        assertEquals(42, problems.count { it is AddProblem.CouldNotRead })
        assertEquals(AddProblem.NoteFull(4_958), problems.last())
        assertEquals(0, files(id).size)
    }

    @Test
    fun aPickLongerThanWhatIsTriedCountsTheFilesPastItWithThoseNotLookedAt() {
        val id = phone.note()

        adds.add(id, List(50) { TestPick("f$it.jpg", bytes = ByteArray(10)) }, notTried = 7)
        adds.adding.await { it.isEmpty() }

        assertEquals(20, files(id).size)
        assertEquals(listOf<AddProblem>(AddProblem.NoteFull(37)), problems)
    }

    @Test
    fun aFileOfALargeBatchThatFailsLetsTheNextOneIn() {
        val id = phone.note()
        val broken = Array(2) { TestPick("broken$it.jpg", bytes = ByteArray(10), failOpen = true) }

        add(id, *broken, *Array(20) { TestPick("f$it.jpg", bytes = ByteArray(10)) })

        assertEquals("Two could not be read, and the 20 after them fill the note", 20, files(id).size)
        assertEquals(listOf<AddProblem>(AddProblem.CouldNotRead("broken0.jpg"), AddProblem.CouldNotRead("broken1.jpg")), problems)
    }

    @Test
    fun theFilesOfALargeBatchKeepTheirOrderBeforeTheFilesPickedAfterThem() {
        val trip = phone.note("Trip")
        val home = phone.note("Home")
        val opened = CopyOnWriteArrayList<String>()
        fun logged(pick: TestPick, name: String) = object : PickedFile by pick {
            override fun open(): java.io.InputStream {
                opened += name
                return pick.open()
            }
        }
        val batch = List(2) { logged(TestPick("b$it.jpg", bytes = ByteArray(10), failOpen = true), "b$it") } +
            List(20) { logged(TestPick("f$it.jpg", bytes = ByteArray(10)), "f$it") }
        canStart.value = false

        adds.add(trip, batch)
        adds.add(home, listOf(logged(TestPick("home.jpg", bytes = ByteArray(10)), "home")))
        canStart.value = true
        adds.adding.await { it.isEmpty() }

        assertEquals(listOf("b0", "b1") + List(20) { "f$it" } + "home", opened.toList())
        assertEquals(20, files(trip).size)
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
    fun aFileWhoseGateClosesBeforeItsKeyIsMadeWaitsForTheGateAndIsThenAdded() {
        val id = phone.note()
        // The gate closes while the add asks the provider for the name: after the add began, before the key.
        val pick = object : PickedFile by TestPick() {
            private var closed = false

            override fun name(): String? {
                if (!closed) canStart.value = false
                closed = true
                return "ticket.jpg"
            }
        }

        adds.add(id, listOf(pick))
        Thread.sleep(100)
        assertEquals("It waits, with no message", emptyList<AddProblem>(), problems)
        assertEquals(1, adds.adding.value.size)
        assertEquals(emptyList<File>(), phone.store.list())
        canStart.value = true
        adds.adding.await { it.isEmpty() }

        assertEquals(emptyList<AddProblem>(), problems)
        assertEquals(listOf("ticket.jpg"), files(id).map { it.name })
    }

    @Test
    fun aLockThatTakesTheKeysJustAfterTheLastLookAtTheGateLetsTheFileWait() {
        val id = phone.note()
        add(id, TestPick(name = "first.jpg"))
        val gate = MutableStateFlow(true)
        val looks = AtomicInteger()
        // The second look at the gate is the one just before the key. The app locks right after it: the keys go, then the
        // gate closes, as the app lock does. A look ends at its first value, so the lock comes before that value is given.
        val seen = flow {
            if (looks.incrementAndGet() == 2) {
                val open = gate.value
                crypto.appLock.lock()
                keys.keystoreFails = true
                gate.value = false
                emit(open)
            } else {
                emitAll(gate)
            }
        }
        val lockedAdds = FileAdds(repository, crypto.files, seen, fileKeys, { problems += it }, { "File" }, scope, Dispatchers.IO)

        lockedAdds.add(id, listOf(TestPick()))
        // The third look comes after the key failed; at the fourth the file waits for the gate again.
        eventually { looks.get() >= 4 }
        assertEquals("It waits, with no message", emptyList<AddProblem>(), problems)
        assertEquals(1, lockedAdds.adding.value.size)
        keys.keystoreFails = false
        gate.value = true
        lockedAdds.adding.await { it.isEmpty() }

        assertEquals(emptyList<AddProblem>(), problems)
        assertEquals(2, files(id).size)
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
    fun aPickedFileThatFailsOnlyWhenItClosesIsAdded() {
        val id = phone.note()
        val bytes = ByteArray(5_000) { 3 }
        val closingBadly = object : PickedFile {
            override fun name(): String = "late.bin"

            override fun type(): String = "application/octet-stream"

            override fun reportedSize(): Long = bytes.size.toLong()

            override fun open(): InputStream = object : java.io.ByteArrayInputStream(bytes) {
                override fun close() = throw java.io.IOException("The provider fails as it closes")
            }
        }

        add(id, closingBadly)

        assertEquals(emptyList<AddProblem>(), problems)
        assertEquals(listOf("late.bin"), files(id).map { it.name })
        assertArrayEquals(bytes, read(shown(id).single()))
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
    fun aFileWithNoNameGetsTheWordTheAddsAreHanded() {
        val id = phone.note()
        // Another word than the app's, so that only the word handed in can be the one that is stored and told.
        val named = FileAdds(repository, crypto.files, canStart, fileKeys, { problems += it }, { "Datei" }, scope, Dispatchers.IO)

        named.add(id, listOf(TestPick(name = null), TestPick(name = "  ", failOpen = true)))
        named.adding.await { it.isEmpty() }

        assertEquals(listOf("Datei"), files(id).map { it.name })
        assertEquals(listOf<AddProblem>(AddProblem.CouldNotRead("Datei")), problems)
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
    fun aDocumentThatFailsItsOwnWayAsItClosesFailsTheCopy() = runBlocking {
        val id = phone.note()
        add(id, TestPick())
        val closing = object : CopyTarget {
            var deleted = false

            override fun open(): java.io.OutputStream = object : java.io.OutputStream() {
                override fun write(byte: Int) = Unit

                override fun close() = throw SecurityException("The permission ended")
            }

            override fun delete(): Boolean = true.also { deleted = true }
        }

        assertEquals(CopyResult.FAILED, reader.saveCopy(shown(id).single(), closing))
        assertTrue("It tried to delete the document", closing.deleted)
        assertEquals("The next copy is not busy", CopyResult.SAVED, reader.saveCopy(shown(id).single(), TestTarget()))
    }

    @Test
    fun aStreamThatFailsOnlyAsItClosesStillGivesTheCopyItsResult() = runBlocking {
        val id = phone.note()
        val pick = TestPick(bytes = ByteArray(1_500_000) { (it % 7).toByte() })
        add(id, pick)
        val failingClose = FileReader(repository, crypto.files, { false }, Dispatchers.IO) { file ->
            object : FilterInputStream(FileInputStream(file)) {
                override fun close() {
                    super.close()
                    throw IOException("The stream file did not close")
                }
            }
        }
        val target = TestTarget()

        assertEquals(CopyResult.SAVED, failingClose.saveCopy(shown(id).single(), target))
        assertArrayEquals(pick.bytes, target.written.toByteArray())
        assertEquals("The next copy is not busy", CopyResult.SAVED, failingClose.saveCopy(shown(id).single(), TestTarget()))
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
    fun theMoveOfTheFileKeysFindsMoreKeysThanAreReadAtATimeAndLeavesAnOpenUndoAlone() = runBlocking {
        val id = phone.note()
        repeat(520) { number ->
            val fileId = repository.reserveFileId()
            val key = NoteLimits.WRAPPED_KEY_START + ByteArray(NoteLimits.WRAPPED_KEY_LENGTH.first - NoteLimits.WRAPPED_KEY_START.size)
            assertEquals(FileAdded.ADDED, repository.addFile(id, fileId, "film$number.mp4", "video/mp4", 1_000, key))
            repository.releaseFileId(fileId)
        }
        val all = phone.database.attachments().every().map { it.record.id }

        val found = repository.filesToSealAgain(emptySet()) { true }

        assertEquals("Each file once", 520, found.size)
        assertEquals(all.toSet(), found.toSet())
        val open = setOf(all[3], all[510])
        assertEquals("The records of an open Undo are left alone", all.toSet() - open, repository.filesToSealAgain(open) { true }.toSet())
        assertEquals("A key that needs no new seal is not found", emptyList<String>(), repository.filesToSealAgain(emptySet()) { false })
    }

    @Test
    fun theKeysOfFilesAddedBeforeTheRecoveryKeyMoveToItWithUpdatedAtAsItWas() = runBlocking {
        val id = phone.note()
        add(id, TestPick("a.jpg"), TestPick("b.jpg"))
        checkNotNull(repository.removeFile(shown(id).last().id))
        val before = phone.database.attachments().every().filter { it.wrappedKey.isNotEmpty() }.associateBy { it.record.id }
        crypto.getRecoveryKey()
        assertTrue(crypto.setup.fileKeyMoveIsPending())
        phone.clock.advanceBy(60_000)

        assertTrue(keyMove.run())

        assertFalse(crypto.setup.fileKeyMoveIsPending())
        val after = phone.database.attachments().every().filter { it.wrappedKey.isNotEmpty() }.associateBy { it.record.id }
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

    @Test
    fun atOneGigabyteOfFilesNoAddStartsAndTheRestOfThePickGoesWithIt() {
        val full = phone.note("Films")
        seedFiles(full, NoteLimits.MOST_ALL_FILE_BYTES)
        val id = phone.note("Trip")
        val opened = AtomicInteger()
        val picks = List(2) {
            object : PickedFile by TestPick("f$it.jpg", bytes = ByteArray(10)) {
                override fun open(): InputStream = TestPick(bytes = ByteArray(10)).open().also { opened.incrementAndGet() }
            }
        }

        add(id, *picks.toTypedArray())

        assertEquals("Told once, for the whole pick", listOf<AddProblem>(AddProblem.AllFull), problems)
        assertEquals("No file is read", 0, opened.get())
        assertEquals(emptyList<AttachmentEntity>(), files(id))
        assertEquals(emptyList<File>(), phone.store.list())
    }

    @Test
    fun anAddThatWouldTakeAllFilesPastOneGigabyteStopsAndItsPartIsDeleted() {
        val full = phone.note("Films")
        seedFiles(full, NoteLimits.MOST_ALL_FILE_BYTES - 100)
        val id = phone.note("Trip")

        add(id, TestPick("large.jpg", bytes = ByteArray(101)))

        assertEquals("The count of the bytes read takes all files past 1 GB", listOf<AddProblem>(AddProblem.AllFull), problems)
        assertEquals(emptyList<AttachmentEntity>(), files(id))
        assertEquals("Its part is deleted", emptyList<File>(), phone.store.list())

        add(id, TestPick("fits.jpg", bytes = ByteArray(100)))

        assertEquals("A file that takes them to 1 GB exactly is added", listOf("fits.jpg"), files(id).map { it.name })
        assertEquals(NoteLimits.MOST_ALL_FILE_BYTES, runBlocking { repository.shownBytes() })
    }

    @Test
    fun aRemovedFileCountsNoMoreTowardsOneGigabyte() {
        val full = phone.note("Films")
        seedFiles(full, NoteLimits.MOST_ALL_FILE_BYTES)
        val id = phone.note("Trip")
        runBlocking { checkNotNull(repository.removeFile(files(full).first().record.id)) }

        add(id, TestPick())

        assertEquals("Also while its Undo is open", emptyList<AddProblem>(), problems)
        assertEquals(1, files(id).size)
    }

    @Test
    fun aFileWhoseKeysCannotBeUsedNowSaysSoAndOneWhoseKeyWasGivenUpCanNoLongerBeOpened() = runBlocking {
        val id = phone.note()
        add(id, TestPick())
        val file = shown(id).single()
        // The app gets its recovery key: the key of the file stays sealed by the key of before, until it has moved.
        crypto.getRecoveryKey()
        assertEquals(FileState.READY, reader.stateOf(file))

        // The Keystore fails for a moment, and the keys in memory are gone, as after a lock.
        keys.keystoreFails = true
        crypto.appLock.lock()
        assertEquals("The keys cannot be used now", FileState.KEYS_NOT_USABLE, reader.stateOf(file))
        keys.keystoreFails = false
        assertEquals(FileState.READY, reader.stateOf(file))

        // The keyset of before is damaged on the disk: it counts as absent, and the security screen offers to give the files up.
        val old = File(folder, "shk-keys/file-key-old")
        old.writeBytes(old.readBytes().also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() })
        crypto.appLock.lock()
        assertTrue(crypto.status().filesCanBeGivenUp)
        assertEquals("A keyset file is damaged: the recovery key screen is the way", FileState.KEYS_NOT_USABLE, reader.stateOf(file))
        assertFalse("Notes never ends the move by itself", keyMove.run())

        crypto.setup.giveUpDamagedFileKeys()

        assertEquals("Its key was given up", FileState.NO_LONGER_OPENS, reader.stateOf(file))
        assertEquals("Such a file counts in the limits until it is removed", file.size, repository.shownBytes())
        repository.wipe(checkNotNull(repository.removeFile(file.id)))
        assertEquals(0L, repository.shownBytes())
    }

    /**
     * Writes the records of files that hold [bytes] together into the note
     * [noteId], with no streams: what the limit of all files counts.
     */
    private fun seedFiles(noteId: String, bytes: Long) = runBlocking {
        var left = bytes
        var number = 0
        while (left > 0) {
            val size = minOf(left, NoteLimits.MOST_FILE_BYTES)
            val fileId = repository.reserveFileId()
            val key = NoteLimits.WRAPPED_KEY_START + ByteArray(NoteLimits.WRAPPED_KEY_LENGTH.first - NoteLimits.WRAPPED_KEY_START.size)
            assertEquals(FileAdded.ADDED, repository.addFile(noteId, fileId, "film${number++}.mp4", "video/mp4", size, key))
            repository.releaseFileId(fileId)
            left -= size
        }
    }
}

/** Writes a wrapped key into a file's record, as a damaged one would be, through the one write that may change it. */
private class RecordWriterForTests(private val phone: Phone) {
    fun sealKey(id: String, key: ByteArray) = runBlocking {
        app.shkriuss.core.data.RecordWriter(phone.database, phone.database.attachments(), phone.clock, phone.ids)
            .sealFileKeyAgain(id) { it.copy(wrappedKey = key) }
    }
}
