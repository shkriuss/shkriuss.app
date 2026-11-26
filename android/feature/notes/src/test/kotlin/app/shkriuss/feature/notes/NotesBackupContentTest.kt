package app.shkriuss.feature.notes

import android.net.Uri
import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.backup.BackupSink
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.data.isDeleted
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.feature.notes.data.AttachmentEntity
import app.shkriuss.feature.notes.data.NoteEntity
import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Notes' records and files in a backup and out of one
 * (docs/apps/notes/spec.md, "Backup contents"): the bytes of each record,
 * a backup that comes back on another phone byte for byte, the files that
 * are left out, the wipe before a backup, everything a restore refuses,
 * and which streams move in after it. Every backup here goes through
 * `Backups` of `core/backup`, with real keys, to a document of a test
 * file picker.
 */
@RunWith(RobolectricTestRunner::class)
class NotesBackupContentTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val clock = TestClock(THE_TIME)
    private val phones = mutableListOf<NotesPhone>()
    private val document = TestDocuments.uri("notes-2026-11-24.shkbackup")

    @Before
    fun aFilePickerWithAFolder() = pickerDocumentsIn(temporary.newFolder())

    @After
    fun closeTheDatabases() = phones.forEach { it.close() }

    /** A phone with Notes on the same clock as every other phone of the test. */
    private fun phone(): NotesPhone = NotesPhone(temporary.newFolder(), clock).also { phones += it }

    /** Two phones with the same recovery key. */
    private fun twoPhones(): Pair<NotesPhone, NotesPhone> {
        val first = phone()
        val second = phone()
        second.giveKeys(first.giveKeys())
        return first to second
    }

    private fun backUp(phone: NotesPhone, to: Uri = document): BackupStep = runBlocking { phone.services.backups.write(to) {} }

    /** Restores [from] on [phone] as Settings does: the check and its question first. */
    private fun restore(phone: NotesPhone, from: Uri = document): BackupStep = runBlocking {
        when (val question = phone.services.backups.look(from) {}) {
            is BackupStep.Question -> phone.services.backups.restore(from, question) {}
            else -> question
        }
    }

    private fun later() = clock.advanceBy(60_000)

    // The content of each record.

    @Test
    fun theContentOfEachRecordIsAsTheSpecSays() {
        val note = NoteEntity(fieldsOf(TRIP), 0, title = "Trip", body = "- [ ] Passport\n- [x] **Tickets**", pinned = true, fileChanges = 1)
        val key = byteArrayOf(0x53, 0x48, 0x4B, 0x01, 0x04, 0x01) + ByteArray(167) { it.toByte() }
        val file = AttachmentEntity(fieldsOf(TICKET), 0, TRIP, "ticket.jpg", "image/jpeg", 2_400_000, key)

        val noteContent = NotesBackupCodec.encode(note)
        val fileContent = NotesBackupCodec.encode(file)

        assertEquals("note", noteContent.type)
        assertEquals(
            "01" + "00000001" + "0004" + "54726970" + "00000020" + "2d205b205d2050617373706f72740a2d205b785d202a2a5469636b6574732a2a",
            noteContent.content.toHex(),
        )
        assertEquals("attachment", fileContent.type)
        assertEquals(
            "7c9e6679742540de944be07fc1f90ae7" + "0000000000249f00" + "0a" + "696d6167652f6a706567" + "000a" + "7469636b65742e6a7067" +
                "00ad" + key.toHex(),
            fileContent.content.toHex(),
        )
        assertEquals(29 + 10 + 10 + 173, fileContent.content.size)
        assertEquals(note, NotesBackupCodec.decodeNote(noteContent))
        assertEquals(file, NotesBackupCodec.decodeFile(fileContent))
    }

    @Test
    fun theWipedFormsAreAsTheSpecSays() {
        val deleted = fieldsOf(TRIP, deletedAt = THE_TIME)
        val note = NoteRules.wiped(NoteEntity(deleted, 0, title = "Trip", body = "Passport", pinned = true, fileChanges = 3))
        val file = NoteRules.wiped(AttachmentEntity(deleted.copy(id = TICKET), 0, TRIP, "ticket.jpg", "image/jpeg", 2_400_000, KEY))

        assertEquals("00" + "00000000" + "0000" + "00000000", NotesBackupCodec.encode(note).content.toHex())
        assertEquals(
            "7c9e6679742540de944be07fc1f90ae7" + "0000000000000000" + "00" + "0000" + "0000",
            NotesBackupCodec.encode(file).content.toHex(),
        )
        assertEquals(note, NotesBackupCodec.decodeNote(NotesBackupCodec.encode(note)))
        assertEquals(file, NotesBackupCodec.decodeFile(NotesBackupCodec.encode(file)))
    }

    @Test
    fun aRecordWithAValueOutsideItsLimitsIsRefused() {
        val note = NotesBackupCodec.encode(NoteEntity(fieldsOf(TRIP), 0, title = "Trip", body = "Passport", pinned = false, fileChanges = 0))
        val file = NotesBackupCodec.encode(AttachmentEntity(fieldsOf(TICKET), 0, TRIP, "ticket.jpg", "image/jpeg", 2_400, KEY))
        val noteCases = mapOf(
            "pinned 2" to note.content.copyOf().also { it[0] = 2 },
            "fileChanges below 0" to note.content.copyOf().also { it[1] = 0x80.toByte() },
            "one byte more" to note.content + 0,
            "one byte less" to note.content.copyOf(note.content.size - 1),
            "no content" to ByteArray(0),
            "a title with a line break" to noteContent(title = "Tr\nip".toByteArray()),
            "a title with a space at its end" to noteContent(title = "Trip ".toByteArray()),
            "a title of 201 characters" to noteContent(title = "a".repeat(201).toByteArray()),
            "a title longer than 800 bytes" to noteContent(title = "😀".repeat(200).toByteArray() + "a".toByteArray()),
            "a title that is not UTF-8" to noteContent(title = byteArrayOf(0xC3.toByte(), 0x28)),
            "a text with a control character" to noteContent(body = "Pass\u0007port".toByteArray()),
            "a text with \\r" to noteContent(body = "Pass\rport".toByteArray()),
            "a text of 100,001 characters" to noteContent(body = "a".repeat(100_001).toByteArray()),
            "a text that is not UTF-8" to noteContent(body = byteArrayOf(0xC3.toByte(), 0x28)),
        )
        val fileCases = mapOf(
            "one byte more" to file.content + 0,
            "one byte less" to file.content.copyOf(file.content.size - 1),
            "a note ID that is not version 4" to file.content.copyOf().also { it[6] = 0x10 },
            "a size above 25 MB" to fileContent(size = 25_000_001),
            "a size below 0" to fileContent(size = -1),
            "a type in upper case" to fileContent(type = "IMAGE/JPEG".toByteArray()),
            "a type that is not ASCII" to fileContent(type = "image/jpé".toByteArray()),
            "a type of 128 bytes" to fileContent(type = ("image/" + "a".repeat(122)).toByteArray()),
            "a type of 2 characters" to fileContent(type = "a/".toByteArray()),
            "no name" to fileContent(name = ByteArray(0)),
            "a name with a line break" to fileContent(name = "ticket\n.jpg".toByteArray()),
            "a name of 256 characters" to fileContent(name = "a".repeat(256).toByteArray()),
            "a name with a space at its end" to fileContent(name = "ticket.jpg ".toByteArray()),
            "a name that is not UTF-8" to fileContent(name = byteArrayOf(0xC3.toByte(), 0x28)),
            "a key that is not a wrapped file key" to fileContent(key = KEY.copyOf().also { it[4] = 2 }),
            "a key of 49 bytes" to fileContent(key = KEY.copyOf(49)),
            "a key of 1,025 bytes" to fileContent(key = KEY + ByteArray(1_025 - KEY.size)),
            "the wiped form, not deleted" to fileContent(size = 0, type = ByteArray(0), name = ByteArray(0), key = ByteArray(0)),
        )

        noteCases.forEach { (why, content) -> assertRefused(why) { NotesBackupCodec.decodeNote(BackupRecord("note", note.fields, content)) } }
        fileCases.forEach { (why, content) -> assertRefused(why) { NotesBackupCodec.decodeFile(BackupRecord("attachment", file.fields, content)) } }
        val deleted = file.fields.copy(deletedAt = THE_TIME)
        assertRefused("a deleted file that is partly wiped") {
            NotesBackupCodec.decodeFile(BackupRecord("attachment", deleted, fileContent(name = ByteArray(0), type = ByteArray(0), size = 0)))
        }
        assertRefused("a time no record can hold") {
            NotesBackupCodec.decodeNote(BackupRecord("note", note.fields.copy(updatedAt = -1), note.content))
        }
        assertRefused("another type") { NotesBackupCodec.decodeNote(BackupRecord("attachment", note.fields, note.content)) }
        assertRefused("another type") { NotesBackupCodec.decodeFile(BackupRecord("note", file.fields, file.content)) }
    }

    private fun assertRefused(why: String, decode: () -> Unit) {
        try {
            decode()
            fail("$why is taken")
        } catch (_: UnreadableBackupException) {
            // Refused, as it must be.
        }
    }

    // A backup and a restore.

    @Test
    fun aBackupComesBackOnAnotherPhoneWithEveryNoteAndFileByteForByte() {
        val (first, second) = twoPhones()
        val trip = first.note("Trip", "- [ ] Passport")
        first.add(trip, picked("ticket.jpg", 2_400), picked("map.pdf", 3 * 1_048_560, type = "application/pdf"), picked("empty.txt", 0))
        val shop = first.note("Shopping", "Milk")
        runBlocking { first.repository.setPinned(shop, shownPinned = false) }

        assertEquals(BackupStep.Written(notes = 2, files = 3, leftOut = 0), backUp(first))
        assertEquals(BackupStep.Restored, restore(second))

        assertEquals(first.notes().map { it.copy(changeNumber = 0) }.toSet(), second.notes().map { it.copy(changeNumber = 0) }.toSet())
        assertEquals(first.files().map { it.copy(changeNumber = 0) }.toSet(), second.files().map { it.copy(changeNumber = 0) }.toSet())
        first.filesOf(trip).zip(second.filesOf(trip)).forEach { (here, there) ->
            assertEquals(FileState.READY, second.stateOf(there))
            assertArrayEquals(first.read(here), second.read(there))
        }
        val before = second.notes() to second.files()
        assertEquals("restoring twice changes nothing", BackupStep.Restored, restore(second))
        assertEquals(before, second.notes() to second.files())
    }

    @Test
    fun aBackupOfMoreNotesThanAreReadAtATimeHoldsEveryOneAndComesBackWhole() {
        val (first, second) = twoPhones()
        val ids = (1..45).map { first.note("Note $it", "Text $it") }
        // A note that changed has the highest change number, so it comes last, after the notes made later.
        assertEquals(Saved.WRITTEN, runBlocking { first.repository.save(ids[2], "Note 3", "Changed") })

        assertEquals(BackupStep.Written(notes = 45, files = 0, leftOut = 0), backUp(first))
        assertEquals(BackupStep.Restored, restore(second))

        assertEquals(45, second.notes().size)
        assertEquals(first.notes().map { it.copy(changeNumber = 0) }.toSet(), second.notes().map { it.copy(changeNumber = 0) }.toSet())
    }

    @Test
    fun aFileThatIsNotOnThePhoneOrIsDamagedIsLeftOutAndItsRecordGoesIn() {
        val (first, second) = twoPhones()
        val trip = first.note("Trip")
        val (ticket, map, photo) = first.add(trip, picked("ticket.jpg", 2_400), picked("map.pdf", 5_000), picked("photo.jpg", 700))
        first.store.stream(ticket.record.id).delete()
        RandomAccessFile(first.store.stream(map.record.id), "rw").use { it.setLength(it.length() - 1) }

        assertEquals(BackupStep.Written(notes = 1, files = 1, leftOut = 2), backUp(first))
        assertEquals(BackupStep.Restored, restore(second))

        val restored = second.filesOf(trip).associateBy { it.record.id }
        assertEquals(setOf(ticket.record.id, map.record.id, photo.record.id), restored.keys)
        assertEquals(FileState.NOT_ON_PHONE, second.stateOf(restored.getValue(ticket.record.id)))
        assertEquals(FileState.NOT_ON_PHONE, second.stateOf(restored.getValue(map.record.id)))
        assertArrayEquals(first.read(photo), second.read(restored.getValue(photo.record.id)))
    }

    @Test
    fun theDeletedRecordsAreWipedBeforeABackupSoItHoldsNoDeletedContent() {
        val (first, second) = twoPhones()
        val trip = first.note("Trip", "Passport")
        val ticket = first.add(trip, picked("ticket.jpg", 2_400)).single()
        // Deleted, and the phone stopped before its Undo ended: nothing is wiped yet.
        runBlocking { first.repository.deleteNote(trip) }

        assertEquals(BackupStep.Written(notes = 0, files = 0, leftOut = 0), backUp(first))
        assertFalse("the stream went with the wipe", first.store.has(ticket.record.id))
        assertEquals(BackupStep.Restored, restore(second))

        val note = second.notes().single()
        val file = second.files().single()
        assertTrue(note.record.isDeleted && NoteRules.isWiped(note))
        assertTrue(file.record.isDeleted && NoteRules.isWiped(file))
    }

    @Test
    fun aBackupStopsWhenADeletedRecordStillHoldsItsContent() {
        val phone = phone().also { it.giveKeys() }
        val trip = phone.note("Trip", "Passport")
        runBlocking { phone.repository.deleteNote(trip) }
        val content = NotesBackupContent(phone.database, phone.repository, clock, app.shkriuss.core.data.IdSource.RandomUuid)

        val listed = runCatching { runBlocking { content.list(NoSink) } }

        assertTrue("${listed.exceptionOrNull()}", listed.exceptionOrNull() is NotWipedException)
    }

    @Test
    fun aRestoreRefusesABackupWhoseRecordsAndFilesDoNotFitAndNothingChanges() {
        val phone = phone().also { it.giveKeys() }
        val kept = phone.note("Kept")
        val stream = ByteArray(StreamLength.of(2_400).toInt())
        val trip = noteRecord(TRIP)
        val ticket = fileRecord(TICKET, TRIP, size = 2_400)
        val cases = mapOf(
            "a note ID that is there twice" to HandMadeContent(listOf(trip, trip)),
            "a file ID that is there twice" to HandMadeContent(listOf(trip, ticket, ticket)),
            "a file whose note is not in the backup" to HandMadeContent(listOf(ticket)),
            "a record ID that is not version 4" to HandMadeContent(listOf(noteRecord("7c9e6679-7425-10de-944b-e07fc1f90ae7"))),
            // A file's ID names its stream on the phone: only the form of a version 4 UUID is taken.
            "a file ID that is not version 4" to HandMadeContent(listOf(trip, fileRecord("0f1e2d3c-4b5a-1978-8695-a4b3c2d1e0ff", TRIP, size = 2_400))),
            "another record type" to HandMadeContent(listOf(trip, BackupRecord("task", fieldsOf(TICKET), ByteArray(4)))),
            "a file entry with no file record" to HandMadeContent(listOf(trip), listOf(TICKET to stream)),
            "a file entry that is there twice" to HandMadeContent(listOf(trip, ticket), listOf(TICKET to stream, TICKET to stream)),
            "a file entry of another length" to HandMadeContent(listOf(trip, ticket), listOf(TICKET to stream + 0)),
            // With its note, so that only the wiped file can be what is refused.
            "a file entry of a wiped file" to HandMadeContent(
                listOf(trip, BackupRecord("attachment", fieldsOf(TICKET, deletedAt = THE_TIME), wipedFileContent(TRIP))),
                listOf(TICKET to ByteArray(StreamLength.of(0).toInt())),
            ),
        )
        val before = phone.notes() to phone.files()

        cases.forEach { (why, content) ->
            writeBackup(phone.keys, content, clock, document)
            assertEquals(why, BackupStep.Unreadable, restore(phone))
            assertEquals("$why: nothing changes", before, phone.notes() to phone.files())
            assertFalse("$why: no stream moves in", phone.store.has(TICKET))
        }
        assertEquals("Kept", phone.notes().single { it.record.id == kept }.title)
    }

    @Test
    fun aRestoreBringsMoreFilesThanAnAddWouldLetANoteHold() {
        val phone = phone().also { it.giveKeys() }
        // 21 files of one note, each with its stream: a count stops only Add a file, never a restore.
        val ids = List(NoteLimits.MOST_FILES_PER_NOTE + 1) { "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0%02x".format(it) }
        val stream = ByteArray(StreamLength.of(2_400).toInt())
        writeBackup(
            phone.keys,
            HandMadeContent(listOf(noteRecord(TRIP)) + ids.map { fileRecord(it, TRIP, size = 2_400) }, ids.map { it to stream }),
            clock,
            document,
        )

        assertEquals(BackupStep.Restored, restore(phone))

        assertEquals(NoteLimits.MOST_FILES_PER_NOTE + 1, phone.filesOf(TRIP).size)
        assertTrue("Each stream moved in", ids.all { phone.store.isWhole(it, 2_400) })
    }

    @Test
    fun afterARestoreTheFilesOfADeletedNoteAreDeletedAndWiped() {
        val phone = phone().also { it.giveKeys() }
        // A note that another copy of Notes deleted after this phone's file of it: the file is newer, the note is deleted.
        val stream = ByteArray(StreamLength.of(2_400).toInt())
        writeBackup(
            phone.keys,
            HandMadeContent(listOf(noteRecord(TRIP, deletedAt = THE_TIME), fileRecord(TICKET, TRIP, size = 2_400)), listOf(TICKET to stream)),
            clock,
            document,
        )

        assertEquals(BackupStep.Restored, restore(phone))

        val file = phone.files().single()
        assertTrue(file.record.isDeleted)
        assertTrue(NoteRules.isWiped(file))
        assertFalse(phone.store.has(TICKET))
    }

    @Test
    fun aStreamMovesInOnlyForAFileThatIsShownAndWhoseRecordWasTakenOrTheSame() {
        val (first, second) = twoPhones()
        val trip = first.note("Trip")
        val (ticket, map, photo) = first.add(trip, picked("ticket.jpg", 2_400), picked("map.pdf", 5_000), picked("photo.jpg", 700))
        backUp(first)
        restore(second)
        // On the second phone: one stream gone, one cut, and one file removed and wiped, a newer edit than the backup's.
        second.store.stream(ticket.record.id).delete()
        RandomAccessFile(second.store.stream(map.record.id), "rw").use { it.setLength(10) }
        later()
        runBlocking { second.repository.wipe(checkNotNull(second.repository.removeFile(photo.record.id))) }

        assertEquals(BackupStep.Restored, restore(second))

        val files = second.files().associateBy { it.record.id }
        assertArrayEquals("the same record, with no stream: it moves in", first.read(ticket), second.read(files.getValue(ticket.record.id)))
        assertArrayEquals("a stream of another length is replaced", first.read(map), second.read(files.getValue(map.record.id)))
        val removed = files.getValue(photo.record.id)
        assertTrue("the newer removal stays", removed.record.isDeleted && NoteRules.isWiped(removed))
        assertFalse("its stream does not come back", second.store.has(photo.record.id))
    }

    @Test
    fun aWipedNoteComesBackWithTheNewerEditOfAnotherCopyAndOnlyItsNewerFiles() {
        val (first, second) = twoPhones()
        val trip = first.note("Trip", "Passport")
        val ticket = first.add(trip, picked("ticket.jpg", 2_400)).single()
        backUp(first)
        restore(second)
        later()
        // The second phone deletes the note, and its Undo ends: the note and its file are wiped.
        runBlocking { second.repository.wipe(checkNotNull(second.repository.deleteNote(trip))) }
        later()
        // Later, the first phone edits the note and adds a file to it.
        runBlocking { first.repository.save(trip, "Trip", "Passport, tickets") }
        val map = first.add(trip, picked("map.pdf", 5_000)).single { it.record.id != ticket.record.id }
        backUp(first)

        assertEquals(BackupStep.Restored, restore(second))

        val note = second.notes().single()
        assertFalse(note.record.isDeleted)
        assertEquals("Passport, tickets", note.body)
        val files = second.files().associateBy { it.record.id }
        assertArrayEquals("the newer file comes back", first.read(map), second.read(files.getValue(map.record.id)))
        val old = files.getValue(ticket.record.id)
        assertTrue("the file the other copy did not touch stays deleted and wiped", old.record.isDeleted && NoteRules.isWiped(old))
        assertNull(second.filesOf(trip).singleOrNull { it.record.id == ticket.record.id })
    }

    @Test
    fun aBackupAndARestoreTellHowFarTheyHaveCome() {
        val (first, second) = twoPhones()
        val trip = first.note("Trip")
        first.add(trip, picked("map.pdf", 3 * 1_048_560), picked("ticket.jpg", 2_400))
        val writing = mutableListOf<BackupStep>()
        val restoring = mutableListOf<BackupStep>()

        val written = runBlocking { first.services.backups.write(document) { writing += it } }
        val question = runBlocking { second.services.backups.look(document) { restoring += it } } as BackupStep.Question
        val restored = runBlocking { second.services.backups.restore(document, question) { restoring += it } }

        assertEquals(BackupStep.Written(notes = 1, files = 2, leftOut = 0), written)
        assertEquals(BackupStep.Restored, restored)
        val percents = writing.filterIsInstance<BackupStep.Writing>().map { it.percent }
        assertEquals("writing starts at 0 once the files are counted", 0, percents.first())
        assertEquals(100, percents.last())
        assertTrue("it only goes up", percents.zipWithNext().all { (before, after) -> after!! >= before!! })
        assertEquals("then the check, up to 100", 100, writing.filterIsInstance<BackupStep.Checking>().last().percent)
        assertEquals(100, restoring.filterIsInstance<BackupStep.Checking>().last().percent)
        assertEquals(100, restoring.filterIsInstance<BackupStep.Restoring>().last().percent)
    }

    @Test
    fun whatAStoppedRestoreLeftIsDeletedOffTheThreadThatStartsNotes() {
        val folder = temporary.newFolder()
        val leftover = File(folder, "no-backup/shk-restore/a-stopped-restore/file-0").apply {
            parentFile?.mkdirs()
            writeBytes(ByteArray(1_000))
        }
        val held = Held()
        val phone = NotesPhone(folder, clock, held.dispatcher).also { phones += it }

        phone.services.start()

        assertTrue("start() returns before anything is deleted, as on the main thread", leftover.exists())
        held.runUntil { !leftover.exists() }
    }

    @Test
    fun atEveryStartNotesWipesWhatAStopLeftRemovesStrayStreamsAndGoesOnWithTheMoveOfTheFileKeys() {
        val phone = phone()
        val trip = phone.note("Trip", "Passport")
        val kept = phone.add(trip, picked("ticket.jpg", 2_400)).single()
        val gone = phone.note("Gone", "Secret")
        val ofGone = phone.add(gone, picked("map.pdf", 5_000)).single()
        // Notes stops right after Delete note: the Undo is gone with the snackbar, and nothing is wiped yet.
        runBlocking { checkNotNull(phone.repository.deleteNote(gone)) }
        // And in the middle of an add: a part, and a stream with no record.
        val part = phone.store.part("00000000-0000-4000-8000-0000000000fe").apply { writeBytes(ByteArray(3)) }
        val stray = phone.store.stream("00000000-0000-4000-8000-0000000000ff").apply { writeBytes(ByteArray(3)) }
        // The recovery key came before the stop: the keys of the files have not moved yet.
        phone.giveKeys()
        assertTrue(phone.keys.crypto.setup.fileKeyMoveIsPending())

        phone.services.start()

        eventually { phone.notes().single { it.record.id == gone }.let(NoteRules::isWiped) }
        eventually { !phone.keys.crypto.setup.fileKeyMoveIsPending() }
        val wiped = phone.files().single { it.record.id == ofGone.record.id }
        assertTrue(wiped.record.isDeleted && NoteRules.isWiped(wiped))
        assertFalse("The stream of a wiped file is removed", phone.store.has(ofGone.record.id))
        assertFalse("Every part goes at start", part.exists())
        assertFalse("And every stream no record needs", stray.exists())
        val moved = phone.files().single { it.record.id == kept.record.id }
        assertTrue("The key of the file that stays is sealed by the key of the recovery key", phone.keys.crypto.files.isSealedByCurrentKey(moved.wrappedKey))
        assertEquals("Its record times are as they were", kept.record, moved.record)
        assertEquals(FileState.READY, phone.stateOf(moved))
        assertEquals("Passport", phone.notes().single { it.record.id == trip }.body)
    }

    /** A sink that takes everything and keeps nothing. */
    private object NoSink : BackupSink {
        override suspend fun record(record: BackupRecord) = Unit

        override suspend fun file(id: String, length: Long, content: InputStream) = Unit

        override fun filesLeftOut(count: Long) = Unit
    }

    private companion object {
        const val TRIP = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
        const val TICKET = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"

        /** A wrapped file key of 173 bytes, as `core/crypto` makes them. */
        val KEY: ByteArray = byteArrayOf(0x53, 0x48, 0x4B, 0x01, 0x04) + ByteArray(168) { (it + 1).toByte() }

        fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

        /** A note's content with [title] and [body] as bytes, as a backup could hold them. */
        fun noteContent(title: ByteArray = "Trip".toByteArray(), body: ByteArray = ByteArray(0)): ByteArray =
            java.nio.ByteBuffer.allocate(11 + title.size + body.size)
                .put(0).putInt(0).putShort(title.size.toShort()).put(title).putInt(body.size).put(body).array()

        /** A file's content with these values as bytes, as a backup could hold them. */
        fun fileContent(
            size: Long = 2_400,
            type: ByteArray = "image/jpeg".toByteArray(),
            name: ByteArray = "ticket.jpg".toByteArray(),
            key: ByteArray = KEY,
            noteId: String = TRIP,
        ): ByteArray {
            val note = java.util.UUID.fromString(noteId)
            return java.nio.ByteBuffer.allocate(29 + type.size + name.size + key.size)
                .putLong(note.mostSignificantBits).putLong(note.leastSignificantBits).putLong(size)
                .put(type.size.toByte()).put(type).putShort(name.size.toShort()).put(name).putShort(key.size.toShort()).put(key)
                .array()
        }

        /** The wiped form of a file of the note [noteId]. */
        fun wipedFileContent(noteId: String): ByteArray = fileContent(size = 0, type = ByteArray(0), name = ByteArray(0), key = ByteArray(0), noteId = noteId)

        fun noteRecord(id: String, deletedAt: Long? = null): BackupRecord =
            BackupRecord("note", fieldsOf(id, deletedAt = deletedAt), noteContent())

        fun fileRecord(id: String, noteId: String, size: Long): BackupRecord =
            BackupRecord("attachment", RecordFields(id, THE_TIME, THE_TIME + 1, null), fileContent(size = size, noteId = noteId))
    }
}
