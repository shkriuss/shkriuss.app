package app.shkriuss.core.backup

import android.app.Activity
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.os.ParcelFileDescriptor
import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.testing.TestClock
import java.io.File
import java.io.IOException
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * Backups through the documents of the system file picker: [Backups]
 * reads and writes `content:` URIs with Android's content resolver, and
 * [BackupDocuments] makes the two intents (item 10 of "What the tests
 * must cover" in backup-format.md).
 *
 * The documents here are files behind a small content provider of the
 * test, so the way a document is opened is the real one.
 */
@RunWith(RobolectricTestRunner::class)
class BackupsTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private lateinit var context: Context
    private lateinit var keys: SoftwareKeysApp
    private lateinit var app: FakeApp
    private lateinit var stagingFolder: File
    private lateinit var backups: Backups
    private val clock = TestClock()

    @Before
    fun anAppWithKeysAndAPlaceForDocuments() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        TestDocuments.folder = temporary.newFolder()
        TestDocuments.modes.clear()
        TestDocuments.deleted.clear()
        Robolectric.setupContentProvider(TestDocuments::class.java, AUTHORITY)

        keys = SoftwareKeysApp(temporary.newFolder(), WATER)
        keys.crypto.setup.storeDerivedKeys(keys.crypto.setup.createRecoveryKey())
        app = FakeApp(temporary.newFolder())
        stagingFolder = temporary.newFolder()
        backups = Backups(context.contentResolver, keys.crypto.backups, WATER, app, stagingFolder, clock, Dispatchers.IO)
    }

    private fun document(name: String): Uri = Uri.parse("content://$AUTHORITY/$name")

    private fun fileOf(name: String) = File(TestDocuments.folder, name)

    @Test
    fun aBackupIsWrittenToADocumentCheckedAndRestoredFromIt() = runBlocking {
        app.add(record(1), record(2, type = "file"))
        app.putFile(2, pattern(4_000))
        val before = app.snapshot()
        val picked = document("water-2026-11-12.shkbackup")

        val written = backups.export(picked)

        assertEquals(ExportResult.Written(records = 2, files = 1, filesLeftOut = 0), written)
        val summary = BackupSummary(dataVersion = 1, madeAt = clock.nowMillis, records = 2, files = 1)
        assertEquals(CheckResult.Good(summary), backups.check(picked))
        assertEquals("the check never calls the app", 0, app.restores)

        app.records.clear()
        fileOf("water-2026-11-12.shkbackup").let { assertTrue(it.length() > 0) }
        assertEquals(RestoreResult.Restored(summary), backups.restore(picked))
        assertEquals(before, app.snapshot())
        assertEquals(emptyList<String>(), stagingFolder.list().orEmpty().toList())
    }

    @Test
    fun writingOverALongerOldFileLeavesNothingOfIt() = runBlocking {
        val old = fileOf("old.shkbackup")
        old.writeBytes(pattern(50_000))
        app.add(record(1))

        backups.export(document("old.shkbackup"))

        assertEquals("the document is opened so that old content is cut off", listOf("wt"), TestDocuments.modes)
        assertTrue("the old end is gone", old.length() < 1_000)
        assertTrue(backups.check(document("old.shkbackup")) is CheckResult.Good)
    }

    @Test
    fun aDocumentThatIsNoBackupIsAnsweredAndNothingChanges() = runBlocking {
        fileOf("holiday.jpg").writeBytes(pattern(3_000))
        app.add(record(1))
        val before = app.snapshot()

        assertEquals(CheckResult.Refused(BackupAnswer.NotABackup), backups.check(document("holiday.jpg")))
        assertEquals(RestoreResult.Refused(BackupAnswer.NotABackup), backups.restore(document("holiday.jpg")))
        assertEquals(before, app.snapshot())
        assertEquals(0, app.restores)
    }

    @Test
    fun aBackupThatFailsIsDeletedFromThePlaceTheUserPicked() = runBlocking {
        app.add(record(1))
        val stop = IOException("The app could not list its files")
        app.failure = stop
        val picked = document("failed.shkbackup")

        val thrown = runCatching { backups.export(picked) }.exceptionOrNull()

        // On its way out of the place where the writing runs, the test's coroutines may wrap the failure in a copy of itself.
        assertTrue("$thrown", thrown === stop || thrown?.cause === stop)
        assertEquals(stop.message, thrown?.message)
        assertEquals(listOf(picked), TestDocuments.deleted)
        assertFalse(fileOf("failed.shkbackup").exists())
    }

    @Test
    fun aBackupThatCannotBeMadeOpensNoDocument() = runBlocking {
        val noKeys = SoftwareKeysApp(temporary.newFolder(), WATER)
        val refusing = Backups(context.contentResolver, noKeys.crypto.backups, WATER, app, stagingFolder, clock, Dispatchers.IO)

        val result = refusing.export(document("never.shkbackup"))

        assertEquals(ExportResult.NotReady, result)
        assertEquals(emptyList<String>(), TestDocuments.modes)
        assertFalse(fileOf("never.shkbackup").exists())
    }

    @Test
    fun onlyAContentUriFromThePickerIsTaken() = runBlocking {
        val path = Uri.fromFile(fileOf("direct.shkbackup"))
        val web = Uri.parse("https://example.org/backup")

        for (other in listOf(path, web)) {
            assertTrue(runCatching { backups.export(other) }.exceptionOrNull() is IllegalArgumentException)
            assertTrue(runCatching { backups.check(other) }.exceptionOrNull() is IllegalArgumentException)
            assertTrue(runCatching { backups.restore(other) }.exceptionOrNull() is IllegalArgumentException)
        }
        assertFalse(fileOf("direct.shkbackup").exists())
    }

    @Test
    fun aDocumentThatIsNotThereIsAFailedReadAndNotAnAnswer() = runBlocking {
        val missing = document("missing.shkbackup")

        assertTrue(runCatching { backups.check(missing) }.exceptionOrNull() is IOException)
        assertTrue(runCatching { backups.restore(missing) }.exceptionOrNull() is IOException)
    }

    @Test
    fun startDeletesWhatAStoppedRestoreLeft() {
        File(stagingFolder, "left").mkdirs()
        File(stagingFolder, "left/records").writeBytes(pattern(10))

        backups.start()

        assertEquals(emptyList<String>(), stagingFolder.list().orEmpty().toList())
    }

    @Test
    fun theSuggestedNameIsTheAppTheDateOnThePhoneAndTheEnding() {
        // 2026-11-12 at 21:00 UTC is already the 13th in Tbilisi.
        val evening = 1_794_517_200_000L

        assertEquals("water-2026-11-12.shkbackup", BackupDocuments.fileName(WATER, evening, ZoneId.of("UTC")))
        assertEquals("water-2026-11-13.shkbackup", BackupDocuments.fileName(WATER, evening, ZoneId.of("Asia/Tbilisi")))
    }

    @Test
    fun theTwoIntentsOpenTheSystemFilePicker() {
        val create = BackupDocuments.createIntent("water-2026-11-12.shkbackup")
        val open = BackupDocuments.openIntent()

        assertEquals(Intent.ACTION_CREATE_DOCUMENT, create.action)
        assertEquals(setOf(Intent.CATEGORY_OPENABLE), create.categories)
        assertEquals("application/octet-stream", create.type)
        assertEquals("water-2026-11-12.shkbackup", create.getStringExtra(Intent.EXTRA_TITLE))

        assertEquals(Intent.ACTION_OPEN_DOCUMENT, open.action)
        assertEquals(setOf(Intent.CATEGORY_OPENABLE), open.categories)
        assertEquals("*/*", open.type)
    }

    @Test
    fun theResultOfThePickerIsTheDocumentOrNothing() {
        val picked = document("picked.shkbackup")

        assertEquals(picked, BackupDocuments.uriOf(Activity.RESULT_OK, Intent().setData(picked)))
        assertNull("the user left the picker", BackupDocuments.uriOf(Activity.RESULT_CANCELED, Intent().setData(picked)))
        assertNull(BackupDocuments.uriOf(Activity.RESULT_OK, null))
        assertNull(BackupDocuments.uriOf(Activity.RESULT_OK, Intent()))
    }

    /**
     * The documents of the test: one file per URI, in a folder. It opens a
     * file in the mode it is asked for, and deletes one when Android's own
     * call for deleting a document arrives.
     */
    class TestDocuments : ContentProvider() {
        override fun onCreate(): Boolean = true

        override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
            if (mode != "r") modes += mode
            return ParcelFileDescriptor.open(fileOf(uri), ParcelFileDescriptor.parseMode(mode))
        }

        override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
            if (method == DELETE_DOCUMENT) {
                @Suppress("DEPRECATION")
                val document = extras?.getParcelable<Uri>(DOCUMENT_URI) ?: return null
                fileOf(document).delete()
                deleted += document
            }
            return null
        }

        override fun getType(uri: Uri): String? = null

        override fun query(uri: Uri, columns: Array<String>?, where: String?, arguments: Array<String>?, order: String?): Cursor? = null

        override fun insert(uri: Uri, values: ContentValues?): Uri? = null

        override fun delete(uri: Uri, where: String?, arguments: Array<String>?): Int = 0

        override fun update(uri: Uri, values: ContentValues?, where: String?, arguments: Array<String>?): Int = 0

        private fun fileOf(uri: Uri) = File(folder, uri.lastPathSegment ?: error("no name"))

        companion object {
            lateinit var folder: File

            /** The modes documents were opened for writing in. */
            val modes = mutableListOf<String>()

            /** The documents that were deleted through Android's call. */
            val deleted = mutableListOf<Uri>()

            /** How `DocumentsContract.deleteDocument` reaches a provider. */
            private const val DELETE_DOCUMENT = "android:deleteDocument"
            private const val DOCUMENT_URI = "uri"
        }
    }

    private companion object {
        const val AUTHORITY = "app.shkriuss.core.backup.test.documents"
    }
}
