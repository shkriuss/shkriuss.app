package app.shkriuss.core.testing

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File

/**
 * Documents of the system file picker for unit tests: files in a folder of
 * the test, behind a content provider. A test of backup and restore gives
 * a screen or `Backups` the `content:` URI of one, as the picker would.
 *
 * A test sets [folder], registers the provider with Robolectric
 * (`Robolectric.setupContentProvider(TestDocuments::class.java, TestDocuments.AUTHORITY)`)
 * and names a document with [uri]. [onOpen] runs before a document is
 * opened: a test can wait there, to keep a progress dialog on screen, or
 * throw, as a storage app that fails.
 */
class TestDocuments : ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        onOpen(mode)
        return ParcelFileDescriptor.open(File(folder, checkNotNull(uri.lastPathSegment)), ParcelFileDescriptor.parseMode(mode))
    }

    override fun getType(uri: Uri): String? = null

    override fun query(uri: Uri, columns: Array<String>?, where: String?, arguments: Array<String>?, order: String?): Cursor? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, where: String?, arguments: Array<String>?): Int = 0

    override fun update(uri: Uri, values: ContentValues?, where: String?, arguments: Array<String>?): Int = 0

    companion object {
        /** The authority the provider is registered with. */
        const val AUTHORITY: String = "app.shkriuss.core.testing.documents"

        /** The folder that holds the documents. A test sets it, to a folder of its own. */
        lateinit var folder: File

        /** Runs before a document is opened, with the mode it is opened in: `r` to read, `wt` to write. A test sets it back. */
        @Volatile
        var onOpen: (mode: String) -> Unit = {}

        /** The URI of the document [name], as the picker would give it. */
        fun uri(name: String): Uri = Uri.parse("content://$AUTHORITY/$name")

        /** The file behind the document [name]. */
        fun file(name: String): File = File(folder, name)
    }
}
