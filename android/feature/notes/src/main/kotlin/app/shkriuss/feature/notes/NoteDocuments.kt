package app.shkriuss.feature.notes

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import app.shkriuss.core.backup.BackupDocuments

/**
 * The two screens of Android's file picker that Notes opens: "open
 * document" for **Add a file**, and "create document" for **Save a copy**
 * (docs/apps/notes/spec.md, "Adding a file", point 1, and "Showing an
 * image, and saving a copy", point 2). Files enter and leave Notes only
 * through them. Notes asks for no lasting permission.
 *
 * The answer of a picker comes from another app, so Notes takes only a
 * document of another app's content provider, with the check that every
 * backup uses (`BackupDocuments.isFromAnotherApp`): never a `file:` path,
 * which Notes would open as itself, and never a provider of Notes' own.
 * So an app that poses as the picker cannot make Notes read or overwrite
 * its own files, such as its database or its keys.
 */
object NoteDocuments {
    /** The "open document" screen for any type, several files allowed. */
    fun addIntent(): Intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType(ANY_TYPE)
        .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)

    /** The "create document" screen, with the file's [name] and [type]. */
    fun copyIntent(name: String, type: String): Intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType(type)
        .putExtra(Intent.EXTRA_TITLE, name)

    /**
     * What the "open document" screen gave: none if the user went back.
     * Only its first [NoteLimits.MOST_FILES_TRIED_PER_PICK] files are
     * looked at, in the order it gave them, and those that are documents
     * of another app than [context]'s are taken, each provider looked up
     * once, by its name without a user before it. So an answer with
     * thousands of files takes a few look-ups, not thousands. The files
     * past them are counted, to be told as not added (decided by the
     * owner).
     */
    fun pickedOf(resultCode: Int, data: Intent?, context: Context): Picked {
        if (resultCode != Activity.RESULT_OK || data == null) return Picked(emptyList(), notLookedAt = 0)
        val clip = data.clipData
        val count = clip?.itemCount ?: if (data.data == null) 0 else 1
        val looked = minOf(count, NoteLimits.MOST_FILES_TRIED_PER_PICK)
        val given = if (clip != null) List(looked) { clip.getItemAt(it).uri }.filterNotNull() else listOfNotNull(data.data)
        val ofAnotherApp = HashMap<String, Boolean>()
        val taken = given.filter { uri ->
            ofAnotherApp.getOrPut("${uri.scheme}://${uri.authority?.substringAfterLast('@')}") { BackupDocuments.isFromAnotherApp(uri, context) }
        }
        return Picked(taken, notLookedAt = count - looked)
    }

    /**
     * The answer of the "open document" screen: the [documents] taken, in
     * their order, and how many files past them were [notLookedAt].
     */
    data class Picked(val documents: List<Uri>, val notLookedAt: Int)

    /**
     * The document the "create document" screen made, if it is a document
     * of another app than [context]'s, or null, as when the user went back.
     */
    fun chosenOf(resultCode: Int, data: Intent?, context: Context): Uri? =
        data?.data?.takeIf { resultCode == Activity.RESULT_OK && BackupDocuments.isFromAnotherApp(it, context) }

    private const val ANY_TYPE = "*/*"
}
