package app.shkriuss.feature.notes

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * The two screens of Android's file picker that Notes opens: "open
 * document" for **Add a file**, and "create document" for **Save a copy**
 * (docs/apps/notes/spec.md, "Adding a file", point 1, and "Showing an
 * image, and saving a copy", point 2). Files enter and leave Notes only
 * through them. Notes asks for no lasting permission.
 *
 * The answer of a picker comes from another app, so Notes takes only a
 * document of another app's content provider ([isSafe]): never a `file:`
 * path, which Notes would open as itself, and never a provider of Notes'
 * own. So an app that poses as the picker cannot make Notes read or
 * overwrite its own files, such as its database or its keys.
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
     * The files the "open document" screen gave, in the order it gave them,
     * that are [isSafe] for [context]: none if the user went back.
     */
    fun pickedOf(resultCode: Int, data: Intent?, context: Context): List<Uri> {
        if (resultCode != Activity.RESULT_OK || data == null) return emptyList()
        val clip = data.clipData
        val given = if (clip != null) List(clip.itemCount) { clip.getItemAt(it).uri }.filterNotNull() else listOfNotNull(data.data)
        return given.filter { isSafe(it, context) }
    }

    /** The document the "create document" screen made, if it [isSafe] for [context], or null, as when the user went back. */
    fun chosenOf(resultCode: Int, data: Intent?, context: Context): Uri? =
        data?.data?.takeIf { resultCode == Activity.RESULT_OK && isSafe(it, context) }

    /**
     * True if [uri] is a document of another app's content provider: a
     * `content:` URI whose provider is not one of [context]'s own app.
     */
    fun isSafe(uri: Uri, context: Context): Boolean {
        if (uri.scheme != ContentResolver.SCHEME_CONTENT) return false
        val authority = uri.authority ?: return false
        val provider = try {
            context.packageManager.resolveContentProvider(authority, 0)
        } catch (_: RuntimeException) {
            // A package manager that cannot answer: the document is not taken.
            return false
        }
        return provider?.packageName != context.packageName
    }

    private const val ANY_TYPE = "*/*"
}
