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
    fun anImageFitsAPaneThatIsNotSquareAndIsNoLargerThanItShowsThere() {
        val file = add(TestPick(name = "ticket.png", type = "image/png", bytes = png(400, 200)))

        val tall = checkNotNull(runBlocking { images.decode(file, 100, 300) })
        val wide = checkNotNull(runBlocking { images.decode(file, 300, 60) })

        assertEquals("A portrait pane: as wide as the pane", 100 to 50, tall.width to tall.height)
        assertEquals("A landscape pane: as high as the pane", 120 to 60, wide.width to wide.height)
    }

    @Test
    fun theSmallImageOfARowIsTheSquareInTheMiddleOfTheImageScaledToCoverIt() {
        val file = add(TestPick(name = "ticket.png", type = "image/png", bytes = png(400, 200, middle = 200)))

        val shown = checkNotNull(runBlocking { images.decode(file, 100, cover = true) })

        assertEquals(100, shown.width)
        assertEquals(100, shown.height)
        // The middle of the image, not its red edges.
        for ((x, y) in listOf(0 to 0, 99 to 0, 0 to 99, 99 to 99, 50 to 50)) {
            assertEquals("Pixel $x, $y", android.graphics.Color.BLUE, shown.getPixel(x, y))
        }
    }

    @Test
    fun aVeryLongImageKeepsOnlyTheSquareARowShows() {
        val tall = add(TestPick(name = "receipt.png", type = "image/png", bytes = png(200, 8_000)))
        val thin = add(TestPick(name = "strip.png", type = "image/png", bytes = png(20, 2_000)))

        val shown = checkNotNull(runBlocking { images.decode(tall, 100, cover = true) })
        val small = checkNotNull(runBlocking { images.decode(thin, 100, cover = true) })

        assertEquals(100 to 100, shown.width to shown.height)
        assertEquals("Smaller than its place: not scaled, only cut", 20 to 20, small.width to small.height)
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

        assertEquals(listOf(one, two), NoteDocuments.pickedOf(Activity.RESULT_OK, several, context))
        assertEquals(listOf(one), NoteDocuments.pickedOf(Activity.RESULT_OK, Intent().setData(one), context))
        assertEquals(emptyList<Uri>(), NoteDocuments.pickedOf(Activity.RESULT_CANCELED, Intent().setData(one), context))
        assertEquals(one, NoteDocuments.chosenOf(Activity.RESULT_OK, Intent().setData(one), context))
        assertNull(NoteDocuments.chosenOf(Activity.RESULT_CANCELED, null, context))
    }

    @Test
    fun anAppPosingAsThePickerCannotHandNotesItsOwnFiles() {
        val database = Uri.fromFile(context.getDatabasePath("notes.db"))
        val ownProvider = Uri.parse("content://${context.packageName}.own/notes.db")
        val ours = android.content.pm.ProviderInfo().apply {
            authority = "${context.packageName}.own"
            packageName = context.packageName
            name = "Own"
        }
        org.robolectric.Shadows.shadowOf(context.packageManager).addOrUpdateProvider(ours)
        // The same provider of Notes, named with a user before it, as Android also reads it.
        val ownProviderOfAUser = Uri.parse("content://0@${context.packageName}.own/notes.db")
        val document = Uri.parse("content://documents/one")
        // A document of another app in another profile, such as a work profile, named with its user.
        val documentOfAProfile = Uri.parse("content://10@documents/two")

        val picked = Intent().apply {
            clipData = ClipData.newRawUri(null, database).also {
                it.addItem(ClipData.Item(ownProvider))
                it.addItem(ClipData.Item(ownProviderOfAUser))
                it.addItem(ClipData.Item(document))
                it.addItem(ClipData.Item(documentOfAProfile))
            }
        }

        assertEquals(
            "Only the documents of another app are taken",
            listOf(document, documentOfAProfile),
            NoteDocuments.pickedOf(Activity.RESULT_OK, picked, context),
        )
        assertNull("Notes' own provider named with a user is never written", NoteDocuments.chosenOf(Activity.RESULT_OK, Intent().setData(ownProviderOfAUser), context))
        assertNull("A file path is never written", NoteDocuments.chosenOf(Activity.RESULT_OK, Intent().setData(database), context))
        assertNull("Notes' own provider is never written", NoteDocuments.chosenOf(Activity.RESULT_OK, Intent().setData(ownProvider), context))
    }

    @Test
    fun anAnswerOfThousandsOfFilesTakesAFewLookUps() {
        fun answer(uris: List<Uri>) = Intent().apply {
            clipData = ClipData.newRawUri(null, uris.first()).also { clip -> uris.drop(1).forEach { clip.addItem(ClipData.Item(it)) } }
        }
        val oneProvider = List(5_000) { Uri.parse("content://$it@documents/f$it") }
        val manyProviders = List(5_000) { Uri.parse("content://p$it/f") }

        assertEquals(
            "One provider, with any user before it, is one look-up, and every file of it is taken",
            5_000,
            NoteDocuments.pickedOf(Activity.RESULT_OK, answer(oneProvider), context).size,
        )
        assertEquals(
            "At most 21 providers are looked up: one for each file a note holds, and one more",
            List(21) { Uri.parse("content://p$it/f") },
            NoteDocuments.pickedOf(Activity.RESULT_OK, answer(manyProviders), context),
        )
    }

    /** Adds [pick] to a new note, as Add a file does, and gives the file. */
    private fun add(pick: PickedFile): NoteFile {
        val note = phone.note("Trip")
        val before = runBlocking { phone.repository.shownFileCount(note) }
        adds.add(note, listOf(pick))
        eventually { runBlocking { phone.repository.shownFileCount(note) } > before }
        return runBlocking { phone.repository.filesOf(note).first().last() }
    }

    /** A blue image of [width] by [height] pixels; with [middle], blue only in a band of that width in its middle, red at both sides. */
    private fun png(width: Int, height: Int, middle: Int? = null): ByteArray {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(if (middle == null) android.graphics.Color.BLUE else android.graphics.Color.RED)
        if (middle != null) {
            val left = (width - middle) / 2
            android.graphics.Canvas(bitmap).drawRect(
                left.toFloat(), 0f, (left + middle).toFloat(), height.toFloat(),
                android.graphics.Paint().apply { color = android.graphics.Color.BLUE },
            )
        }
        return ByteArrayOutputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            it.toByteArray()
        }
    }
}
