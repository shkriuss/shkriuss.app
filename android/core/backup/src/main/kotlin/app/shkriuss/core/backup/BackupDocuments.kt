package app.shkriuss.core.backup

import android.app.Activity
import android.content.Intent
import android.net.Uri
import app.shkriuss.core.crypto.AppName
import java.time.Instant
import java.time.ZoneId

/**
 * The system file picker for backups. Files enter and leave an app only
 * through it, so the app needs no storage permission.
 *
 * A screen starts one of the two intents for a result, and gives the
 * result to [uriOf]. The URI it gets is what [Backups] takes.
 */
object BackupDocuments {
    /** The ending of the suggested file name. A reader never looks at the name. */
    const val FILE_ENDING = ".shkbackup"

    /** A backup is no known type of file, so it is offered as plain bytes. */
    private const val NEW_DOCUMENT_TYPE = "application/octet-stream"

    /** Storage apps name the type of an unknown ending differently, so every file is offered. */
    private const val ANY_TYPE = "*/*"

    /**
     * The name suggested for a new backup: the app name, the date in
     * [zone] at [nowMillis], and [FILE_ENDING]. For example
     * `water-2026-11-12.shkbackup`. The user may change it.
     */
    fun fileName(appName: AppName, nowMillis: Long, zone: ZoneId): String {
        val date = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate()
        return "${appName.value}-$date$FILE_ENDING"
    }

    /** Opens Android's "create document" screen, where the user picks the place and the name of a new backup. */
    fun createIntent(fileName: String): Intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType(NEW_DOCUMENT_TYPE)
        .putExtra(Intent.EXTRA_TITLE, fileName)

    /** Opens Android's "open document" screen, where the user picks the backup to check or restore. */
    fun openIntent(): Intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType(ANY_TYPE)

    /** The document the user picked, or null if the user left the screen without picking one. */
    fun uriOf(resultCode: Int, data: Intent?): Uri? = if (resultCode == Activity.RESULT_OK) data?.data else null
}
