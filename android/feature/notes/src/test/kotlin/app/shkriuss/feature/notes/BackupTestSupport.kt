package app.shkriuss.feature.notes

import android.content.Context
import android.content.ContextWrapper
import android.net.Uri
import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import app.shkriuss.core.backup.BackupContent
import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.backup.BackupSink
import app.shkriuss.core.backup.Backups
import app.shkriuss.core.backup.CheckedBackup
import app.shkriuss.core.backup.ExportResult
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.feature.notes.data.AttachmentEntity
import app.shkriuss.feature.notes.data.NoteEntity
import java.io.ByteArrayInputStream
import java.io.File
import java.time.ZoneOffset
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.robolectric.Robolectric

/** Sets up the documents of the test's file picker, as files in [folder] (`TestDocuments` of `core/testing`). */
internal fun pickerDocumentsIn(folder: File) {
    TestDocuments.folder = folder
    TestDocuments.onOpen = {}
    Robolectric.setupContentProvider(TestDocuments::class.java, TestDocuments.AUTHORITY)
}

/** The app's context, with a no-backup files folder of its own in [folder]: one phone's streams, keys and staging. */
private class PhoneContext(base: Context, private val folder: File) : ContextWrapper(base) {
    override fun getNoBackupFilesDir(): File = folder.apply { mkdirs() }
}

/**
 * One phone with Notes for the tests of backup and restore: the real
 * [NotesServices], on a database in memory, with software keys and its
 * own folder for its streams and its staging, so two phones in one test
 * never share a file. Notes is on the screen and its gate is open, so
 * files are added at once. [ids] are random, so two phones never make
 * the same `id`. [work] runs its work off the test's thread. Close it at
 * the end of the test.
 */
internal class NotesPhone(
    folder: File,
    val clock: TestClock = TestClock(THE_TIME),
    work: CoroutineContext = Dispatchers.IO,
) : AutoCloseable {
    /** The folder of the phone's keyset files. */
    val keysFolder = File(folder, "shk-keys")

    /** The keys of the phone, with no recovery key yet. */
    val keys: SoftwareKeysApp = cryptoIn(keysFolder)
    val database = memoryDatabase()
    val services = NotesServices(
        PhoneContext(context, File(folder, "no-backup")),
        database,
        clock,
        IdSource.RandomUuid,
        keys.crypto,
        gateOpen = flowOf(true),
        work = work,
        zone = { ZoneOffset.UTC },
    ).also { it.onScreen(true) }
    val repository get() = services.repository
    val store get() = repository.store

    /** Gives the phone its keys from [recoveryKey], or from a new one, and returns it. */
    fun giveKeys(recoveryKey: RecoveryKey = keys.crypto.setup.createRecoveryKey()): RecoveryKey {
        keys.crypto.setup.storeDerivedKeys(recoveryKey)
        return recoveryKey
    }

    /** Makes a note, as typing in a new note does, and returns its `id`. */
    fun note(title: String, body: String = ""): String = runBlocking {
        val id = repository.reserveNoteId()
        check(repository.save(id, title, body) == Saved.WRITTEN)
        id
    }

    /**
     * Adds [picked] to the note [noteId], one after the other as **Add a
     * file** does, each a millisecond after the one before, so the note
     * lists them in that order. Returns the files of the note.
     */
    fun add(noteId: String, vararg picked: PickedFile): List<AttachmentEntity> {
        picked.forEach { file ->
            services.adds.add(noteId, listOf(file))
            services.adds.adding.await { it.isEmpty() }
            clock.advanceBy(1)
        }
        return filesOf(noteId)
    }

    /** The files of the note [noteId] that are not deleted, oldest first. */
    fun filesOf(noteId: String): List<AttachmentEntity> =
        runBlocking { database.attachments().shownOf(noteId) }.sortedWith(compareBy({ it.record.createdAt }, { it.record.id }))

    /** Every note, deleted ones too. */
    fun notes(): List<NoteEntity> = runBlocking { database.notes().all() }

    /** Every file, deleted ones too. */
    fun files(): List<AttachmentEntity> = runBlocking { database.attachments().all() }

    /** The bytes of the file [row], decrypted, as **Save a copy** writes them. */
    fun read(row: AttachmentEntity): ByteArray = runBlocking { services.reader.open(fileOf(row)).use { it.readBytes() } }

    /** The state of the row of the file [row]. */
    fun stateOf(row: AttachmentEntity): FileState = runBlocking { services.reader.stateOf(fileOf(row)) }

    /** Writes the wrapped key of the file [id] as [key], past `RecordWriter`, as damage on the disk would. */
    fun damageKey(id: String, key: ByteArray) = runBlocking {
        database.useWriterConnection { connection ->
            val hex = key.joinToString("") { "%02x".format(it) }
            connection.executeSQL("UPDATE attachment SET wrappedKey = x'$hex' WHERE id = '$id'")
        }
    }

    override fun close() = database.close()
}

/** A picked file of [size] bytes with a pattern that does not repeat at any block size the code uses. */
internal fun picked(name: String, size: Int, type: String = "image/jpeg"): TestPick =
    TestPick(name = name, type = type, bytes = ByteArray(size) { (it % 251).toByte() })

/** Writes a backup of [content] into [to], with the backup keys of [keys]. */
internal fun writeBackup(keys: SoftwareKeysApp, content: BackupContent, clock: TestClock, to: Uri) {
    val staging = File(context.cacheDir, "staging-of-another-phone").apply { mkdirs() }
    val written = runBlocking {
        Backups(context.contentResolver, keys.crypto.backups, NotesServices.APP_NAME, content, staging, clock, Dispatchers.Unconfined).export(to)
    }
    assertTrue("the backup was written: $written", written is ExportResult.Written)
}

/**
 * What a backup of Notes could hold that this Notes would not write: the
 * [records] as they are, then a File entry for each of [files], with its
 * `id` and its bytes.
 */
internal class HandMadeContent(
    private val records: List<BackupRecord>,
    private val files: List<Pair<String, ByteArray>> = emptyList(),
    override val dataVersion: Int = NotesBackupContent.DATA_VERSION,
) : BackupContent {
    override suspend fun list(into: BackupSink) {
        records.forEach { into.record(it) }
        files.forEach { (id, bytes) -> into.file(id, bytes.size.toLong(), ByteArrayInputStream(bytes)) }
    }

    override suspend fun restore(from: CheckedBackup) = error("Only written, never restored")
}

/** The record fields of a record made at [THE_TIME] and changed [later] milliseconds after, with the `id` [id]. */
internal fun fieldsOf(id: String, later: Long = 0, deletedAt: Long? = null): RecordFields = RecordFields(id, THE_TIME, THE_TIME + later, deletedAt)
