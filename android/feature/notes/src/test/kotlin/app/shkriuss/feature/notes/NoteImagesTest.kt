package app.shkriuss.feature.notes

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.app.Activity
import android.content.ClipData
import java.io.ByteArrayOutputStream
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * The images of files, decoded in memory from their encrypted streams
 * (docs/apps/notes/spec.md, "Showing an image, and saving a copy", point
 * 1), and the intents of the two screens of the file picker
 * ("Adding a file", point 1, and "Showing an image", point 2).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NoteImagesTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val folder by lazy { temporary.newFolder() }
    private val phone by lazy { Phone(folder) }
    private val crypto by lazy { cryptoIn(File(folder, "shk-keys")).crypto }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val adds by lazy { FileAdds(phone.repository, crypto.files, MutableStateFlow(true), Mutex(), {}, scope, Dispatchers.IO) }
    private val images by lazy { NoteImages(FileReader(phone.repository, crypto.files, { false }, Dispatchers.IO), Dispatchers.IO) }

    @After
    fun close() {
        scope.cancel()
        phone.close()
    }

    @Test
    fun anImageIsDecodedScaledDownToTheSizeItShowsAt() {
        val file = add(TestPick(name = "ticket.png", type = "image/png", bytes = png(400, 200)))

        val shown = checkNotNull(runBlocking { images.decode(file, 100) })

        assertEquals(100, shown.width)
        assertEquals(50, shown.height)
    }

    @Test
    fun theSmallImageOfARowCoversItsSquare() {
        val file = add(TestPick(name = "ticket.png", type = "image/png", bytes = png(400, 200)))

        val shown = checkNotNull(runBlocking { images.decode(file, 100, cover = true) })

        assertEquals(200, shown.width)
        assertEquals(100, shown.height)
    }

    @Test
    fun anImageLessThanTwiceItsPlaceIsScaledDownToFitIt() {
        val file = add(TestPick(name = "ticket.png", type = "image/png", bytes = png(190, 100)))

        val shown = checkNotNull(runBlocking { images.decode(file, 100) })

        assertEquals(100, shown.width)
        assertEquals(53, shown.height)
    }

    @Test
    fun anImageSmallerThanItsPlaceKeepsItsSize() {
        val file = add(TestPick(name = "ticket.png", type = "image/png", bytes = png(40, 20)))

        val shown = checkNotNull(runBlocking { images.decode(file, 100) })

        assertEquals(40, shown.width)
    }

    @Test
    fun aFileThatIsNoImageOrWhoseBytesAreNotOneIsNotShown() {
        val pdf = add(TestPick(name = "plan.pdf", type = "application/pdf", bytes = png(40, 20)))
        val broken = add(TestPick(name = "scan.jpg", type = "image/jpeg", bytes = ByteArray(2_000) { it.toByte() }))

        assertNull(runBlocking { images.decode(pdf, 100) })
        assertNull(runBlocking { images.decode(broken, 100) })
    }

    @Test
    fun imagesAreDecodedOneAtATime() {
        val open = java.util.concurrent.atomic.AtomicInteger()
        val most = java.util.concurrent.atomic.AtomicInteger()
        val counting = NoteImages(
            FileReader(phone.repository, crypto.files, { false }, Dispatchers.IO) { stream ->
                most.accumulateAndGet(open.incrementAndGet(), ::maxOf)
                Thread.sleep(50)
                object : java.io.FilterInputStream(java.io.FileInputStream(stream)) {
                    override fun close() {
                        open.decrementAndGet()
                        super.close()
                    }
                }
            },
            Dispatchers.IO,
        )
        val files = List(4) { add(TestPick(name = "photo$it.png", type = "image/png", bytes = png(40, 20))) }

        val shown = runBlocking { files.map { file -> async(Dispatchers.IO) { counting.decode(file, 100) } }.awaitAll() }

        assertTrue(shown.all { it != null })
        assertEquals("One stream open at a time", 1, most.get())
    }

    @Test
    fun aFileWhoseStreamIsGoneIsNotShown() {
        val file = add(TestPick(name = "ticket.png", type = "image/png", bytes = png(40, 20)))
        phone.repository.store.remove(file.id)

        assertNull(runBlocking { images.decode(file, 100) })
    }

    @Test
    fun addAFileAsksForAnyTypeAndSeveralFilesAndSaveACopyForTheNameAndTheType() {
        val add = NoteDocuments.addIntent()
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, add.action)
        assertEquals("*/*", add.type)
        assertTrue(add.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false))
        assertTrue(add.hasCategory(Intent.CATEGORY_OPENABLE))

        val copy = NoteDocuments.copyIntent("ticket.jpg", "image/jpeg")
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, copy.action)
        assertEquals("image/jpeg", copy.type)
        assertEquals("ticket.jpg", copy.getStringExtra(Intent.EXTRA_TITLE))
    }

    @Test
    fun thePickedFilesComeInTheirOrderAndNoneWhenTheUserWentBack() {
        val one = Uri.parse("content://documents/one")
        val two = Uri.parse("content://documents/two")
        val several = Intent().apply { clipData = ClipData.newRawUri(null, one).also { it.addItem(ClipData.Item(two)) } }

        assertEquals(listOf(one, two), NoteDocuments.pickedOf(Activity.RESULT_OK, several))
        assertEquals(listOf(one), NoteDocuments.pickedOf(Activity.RESULT_OK, Intent().setData(one)))
        assertEquals(emptyList<Uri>(), NoteDocuments.pickedOf(Activity.RESULT_CANCELED, Intent().setData(one)))
        assertEquals(one, NoteDocuments.chosenOf(Activity.RESULT_OK, Intent().setData(one)))
        assertNull(NoteDocuments.chosenOf(Activity.RESULT_CANCELED, null))
    }

    /** Adds [pick] to a new note, as Add a file does, and gives the file. */
    private fun add(pick: PickedFile): NoteFile {
        val note = phone.note("Trip")
        val before = runBlocking { phone.repository.shownFileCount(note) }
        adds.add(note, listOf(pick))
        eventually { runBlocking { phone.repository.shownFileCount(note) } > before }
        return runBlocking { phone.repository.filesOf(note).first().last() }
    }

    private fun png(width: Int, height: Int): ByteArray {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.BLUE)
        return ByteArrayOutputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            it.toByteArray()
        }
    }
}
