package app.shkriuss.feature.notes

import android.app.Activity
import android.content.Intent
import android.net.Uri

/**
 * The two screens of Android's file picker that Notes opens: "open
 * document" for **Add a file**, and "create document" for **Save a copy**
 * (docs/apps/notes/spec.md, "Adding a file", point 1, and "Showing an
 * image, and saving a copy", point 2). Files enter and leave Notes only
 * through them. Notes asks for no lasting permission.
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

    /** The files the "open document" screen gave, in the order it gave them: none if the user went back. */
    fun pickedOf(resultCode: Int, data: Intent?): List<Uri> {
        if (resultCode != Activity.RESULT_OK || data == null) return emptyList()
        val clip = data.clipData
        if (clip != null) return List(clip.itemCount) { clip.getItemAt(it).uri }.filterNotNull()
        return listOfNotNull(data.data)
    }

    /** The document the "create document" screen made, or null if the user went back. */
    fun chosenOf(resultCode: Int, data: Intent?): Uri? = if (resultCode == Activity.RESULT_OK) data?.data else null

    private const val ANY_TYPE = "*/*"
}
