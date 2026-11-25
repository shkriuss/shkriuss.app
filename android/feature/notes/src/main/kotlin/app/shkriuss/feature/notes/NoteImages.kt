package app.shkriuss.feature.notes

import android.database.SQLException
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.graphics.Rect
import app.shkriuss.core.crypto.BlobException
import java.io.IOException
import java.io.InputStream
import java.nio.ByteBuffer
import kotlin.coroutines.CoroutineContext
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Decodes the images of files, in memory only (docs/apps/notes/spec.md,
 * "Showing an image, and saving a copy", point 1). A file is an image when
 * its type starts with `image/` and Android's `ImageDecoder` reads it. It
 * is decoded from its stream at the size it shows at, when its row or the
 * image view shows; the screens hold the bitmap only while they show it,
 * so it goes when the note closes or Notes locks. Nothing Notes decodes
 * is written anywhere.
 */
class NoteImages(private val reader: FileReader, private val work: CoroutineContext) {
    /** One image at a time, so that the rows of a note full of large photos never hold several of them in memory at once. */
    private val decoding = Mutex()

    /**
     * The image of [file], scaled down to fit a square of [side] pixels
     * when it is larger, as the image view shows it; with [cover], scaled
     * down to cover that square and cut to the square in its middle, as
     * the small image of a row shows it, so a very long image keeps no
     * more than that square. Null when it cannot be shown: its type is not
     * an image, its stream cannot be read or is damaged, or `ImageDecoder`
     * refuses it, or it is too large to hold. A read that meets damage
     * marks the file damaged ([FileReader.open]). One image is decoded at
     * a time.
     */
    suspend fun decode(file: NoteFile, side: Int, cover: Boolean = false): Bitmap? = withContext(work) {
        if (!file.maybeImage || side <= 0 || file.size > NoteLimits.MOST_FILE_BYTES) return@withContext null
        decoding.withLock { decodeNow(file, side, cover) }
    }

    private suspend fun decodeNow(file: NoteFile, side: Int, cover: Boolean): Bitmap? {
        val bytes = try {
            reader.open(file).use { input -> readExactly(input, file.size.toInt()) } ?: return null
        } catch (_: IOException) {
            return null
        } catch (_: BlobException) {
            return null
        } catch (_: SQLException) {
            return null
        } catch (_: OutOfMemoryError) {
            // A file too large to hold now: it is not shown.
            return null
        }
        return try {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ ->
                // In memory the screens draw from, and never larger than it shows.
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                val width = info.size.width
                val height = info.size.height
                // Exactly the size it shows at: never larger, and never smaller, which would blur it.
                val scale = side.toFloat() / if (cover) min(width, height) else max(width, height)
                val shownWidth = if (scale < 1f) (width * scale).roundToInt().coerceAtLeast(1) else width
                val shownHeight = if (scale < 1f) (height * scale).roundToInt().coerceAtLeast(1) else height
                if (scale < 1f) decoder.setTargetSize(shownWidth, shownHeight)
                if (cover) decoder.crop = middleSquare(shownWidth, shownHeight)
            }
        } catch (_: IOException) {
            null
        } catch (_: RuntimeException) {
            // ImageDecoder refuses some broken images with an unchecked exception of its own.
            null
        } catch (_: OutOfMemoryError) {
            // An image too large to hold, even scaled down: it cannot be shown.
            null
        }
    }

    /** The largest square in the middle of an image of [width] by [height] pixels: what a row's small image shows of it. */
    private fun middleSquare(width: Int, height: Int): Rect {
        val square = min(width, height)
        val left = (width - square) / 2
        val top = (height - square) / 2
        return Rect(left, top, left + square, top + square)
    }

    /** The [size] bytes of [input], in one array of that size, or null when it holds fewer or more: such a file is damaged. */
    private fun readExactly(input: InputStream, size: Int): ByteArray? {
        val bytes = ByteArray(size)
        var read = 0
        while (read < size) {
            val count = input.read(bytes, read, size - read)
            if (count < 0) return null
            read += count
        }
        return if (input.read() < 0) bytes else null
    }
}
