package app.shkriuss.core.backup

import android.content.ContentResolver
import android.net.Uri
import android.provider.DocumentsContract
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.BackupCrypto
import app.shkriuss.core.data.Clock
import java.io.File
import java.io.IOException
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.withContext

/**
 * Backup and restore of one app. An app builds one, at start, from its
 * own [BackupContent] and the [BackupCrypto] of its `ShkCrypto`.
 *
 * A backup enters and leaves the app only through the system file picker:
 * every function here takes the `content:` URI the picker gave
 * ([BackupDocuments]), and nothing else. The app needs no permission.
 *
 * The format, the checks and their order are in
 * docs/architecture/backup-format.md.
 *
 * [appName] is the name the app's `ShkCrypto` was made with.
 * [stagingFolder] is a folder inside the app's private storage that only
 * this class uses, and not the cache folder. [io] is where the reading and
 * writing runs, for example `Dispatchers.IO`.
 */
class Backups(
    private val resolver: ContentResolver,
    crypto: BackupCrypto,
    appName: AppName,
    content: BackupContent,
    stagingFolder: File,
    clock: Clock,
    private val io: CoroutineContext,
) {
    private val staging = BackupStaging(stagingFolder)
    private val engine = BackupEngine(crypto, appName, content, staging, clock)

    /**
     * Call once when the app starts, beside `ShkCrypto.start()`. It
     * deletes what a restore left in the staging folder when the app
     * stopped in the middle of it.
     */
    fun start() = staging.clear()

    /**
     * Writes a backup of the app into the document [to]. Old content of
     * the document is cut off.
     *
     * If no backup is made, by a result or by a failure, the document is
     * deleted where Android allows it. A document that stays is never
     * taken for a backup. A write that fails throws its [IOException].
     */
    suspend fun export(to: Uri): ExportResult = withContext(io) {
        requireFromPicker(to)
        var opened = false
        val result = try {
            engine.write {
                opened = true
                resolver.openOutputStream(to, WRITE_AND_CUT) ?: throw IOException("The document cannot be opened for writing")
            }
        } catch (failed: Throwable) {
            if (opened) deleteQuietly(to)
            throw failed
        }
        if (opened && result !is ExportResult.Written) deleteQuietly(to)
        result
    }

    /**
     * Reads the backup in the document [from] to its end and checks
     * everything a restore checks. It stores nothing, changes nothing and
     * never calls the app's [BackupContent]. So a backup that cannot be
     * restored is found on the day it is made.
     */
    suspend fun check(from: Uri): CheckResult = withContext(io) {
        requireFromPicker(from)
        open(from).use { engine.check(it) }
    }

    /**
     * Restores the backup in the document [from]. Nothing in the app
     * changes until the whole document was read and checked.
     *
     * A read of the document that fails throws its [IOException]. Staging
     * that cannot be written throws [BackupStagingException]. What the
     * app's own [BackupContent.restore] throws passes through.
     */
    suspend fun restore(from: Uri): RestoreResult = withContext(io) {
        requireFromPicker(from)
        open(from).use { engine.restore(it) }
    }

    private fun open(document: Uri) =
        (resolver.openInputStream(document) ?: throw IOException("The document cannot be opened for reading")).buffered()

    private fun requireFromPicker(document: Uri) {
        require(document.scheme == ContentResolver.SCHEME_CONTENT) {
            "A backup is read and written only through a content URI of the system file picker"
        }
    }

    /** Removes a document that holds no backup. Not every place lets an app delete, so a failure is let go. */
    private fun deleteQuietly(document: Uri) {
        try {
            DocumentsContract.deleteDocument(resolver, document)
        } catch (_: Exception) {
            // The document stays. It has no End entry, so it never passes a check.
        }
    }

    private companion object {
        /** Write, and cut off what the document held before. Without it a longer old file would keep its end. */
        const val WRITE_AND_CUT = "wt"
    }
}
