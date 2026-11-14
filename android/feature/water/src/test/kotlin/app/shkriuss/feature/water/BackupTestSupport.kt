package app.shkriuss.feature.water

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
 * Writes a backup into the document [to], as another phone would that has
 * the keys of [crypto] and a database of its own, which [fill] writes. Its
 * records have other IDs than those of the test's phone.
 */
internal fun backupOfAnotherPhone(crypto: ShkCrypto, clock: TestClock, to: Uri, fill: suspend WaterRepository.() -> Unit) {
    val database = memoryDatabase()
    try {
        runBlocking { WaterRepository(database, clock, IdSource.RandomUuid).fill() }
        writeBackup(crypto, WaterServices.APP_NAME, WaterBackupContent(database, clock, IdSource.RandomUuid), clock, to)
    } finally {
        database.close()
    }
}

/** Writes a backup of [content] into [to], with the backup keys of [crypto] for the app [appName]. */
internal fun writeBackup(crypto: ShkCrypto, appName: AppName, content: BackupContent, clock: TestClock, to: Uri) {
    val staging = File(context.cacheDir, "staging-of-another-phone").apply { mkdirs() }
    val written = runBlocking {
        Backups(context.contentResolver, crypto.backups, appName, content, staging, clock, Dispatchers.Unconfined).export(to)
    }
    assertTrue("the other phone wrote its backup: $written", written is ExportResult.Written)
}

/** What an app lists into a backup that Water does not know: [records] of its own types, with data version [dataVersion]. */
internal class OtherContent(override val dataVersion: Int, private val records: List<BackupRecord>) : BackupContent {
    override suspend fun list(into: BackupSink) = records.forEach { into.record(it) }

    override suspend fun restore(from: CheckedBackup) = error("Only written, never restored")
}

/** A record of the type [type] that is not deleted, with the ID of record [number]. */
internal fun otherRecord(type: String, number: Long): BackupRecord =
    BackupRecord(type, RecordFields("00000000-0000-4000-8000-%012x".format(0xabc000 + number), 1_000, 2_000, null), ByteArray(4))
