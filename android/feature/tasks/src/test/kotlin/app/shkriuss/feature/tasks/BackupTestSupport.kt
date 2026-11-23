package app.shkriuss.feature.tasks

import android.net.Uri
import app.shkriuss.core.backup.BackupContent
import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.backup.BackupSink
import app.shkriuss.core.backup.Backups
import app.shkriuss.core.backup.CheckedBackup
import app.shkriuss.core.backup.ExportResult
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestDocuments
import java.io.File
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.robolectric.Robolectric

/** Sets up the documents of the test's file picker, as files in [folder] (`TestDocuments` of `core/testing`). */
internal fun pickerDocumentsIn(folder: File) {
    TestDocuments.folder = folder
    TestDocuments.onOpen = {}
    Robolectric.setupContentProvider(TestDocuments::class.java, TestDocuments.AUTHORITY)
}

/**
 * Another phone with Tasks, set up with the keys of [crypto], on a
 * database of its own and the same [clock] in [zone]. Its records have
 * other IDs than those of the test's phone. Close it at the end of the
 * test.
 */
internal class AnotherPhone(private val crypto: ShkCrypto, private val clock: TestClock, zone: ZoneId) : AutoCloseable {
    private val database = memoryDatabase()

    /** The lists and tasks of the other phone. */
    val repository = TasksRepository(
        database,
        clock,
        IdSource.RandomUuid,
        TasksTime(clock) { zone },
        emptyBook("another-phone"),
        work = Dispatchers.Unconfined,
    )

    /** Adds a task as its form does. */
    fun add(title: String, due: Due?, listId: String = INBOX): Task = checkNotNull(runBlocking { repository.addTask(NewTask(title, listId, due)) })

    /** Adds a list as **New list** does. */
    fun addList(name: String): TaskList = checkNotNull(runBlocking { repository.addList(name) })

    /** Writes a backup of everything it has into the document [to]. */
    fun writeBackup(to: Uri) =
        writeBackup(crypto, TasksServices.APP_NAME, TasksBackupContent(database, clock, IdSource.RandomUuid), clock, to)

    override fun close() = database.close()
}

/** Writes a backup of [content] into [to], with the backup keys of [crypto] for the app [appName]. */
internal fun writeBackup(crypto: ShkCrypto, appName: AppName, content: BackupContent, clock: TestClock, to: Uri) {
    val staging = File(context.cacheDir, "staging-of-another-phone").apply { mkdirs() }
    val written = runBlocking {
        Backups(context.contentResolver, crypto.backups, appName, content, staging, clock, Dispatchers.Unconfined).export(to)
    }
    assertTrue("the other phone wrote its backup: $written", written is ExportResult.Written)
}

/** What an app lists into a backup that Tasks does not know: [records] of its own types, with data version [dataVersion]. */
internal class OtherContent(override val dataVersion: Int, private val records: List<BackupRecord>) : BackupContent {
    override suspend fun list(into: BackupSink) = records.forEach { into.record(it) }

    override suspend fun restore(from: CheckedBackup) = error("Only written, never restored")
}

/** A record of the type [type] that is not deleted, with the ID of record [number]. */
internal fun otherRecord(type: String, number: Long): BackupRecord =
    BackupRecord(type, RecordFields("00000000-0000-4000-8000-%012x".format(0xabc000 + number), 1_000, 2_000, null), ByteArray(4))
