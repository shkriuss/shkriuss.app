package app.shkriuss.feature.notes

import android.database.SQLException
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import app.shkriuss.core.crypto.BlobException
import java.io.IOException
import java.nio.ByteBuffer
import kotlin.coroutines.CoroutineContext
import kotlin.math.max
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
    /**
     * The image of [file], scaled down to fit a square of [side] pixels
     * when it is larger, or null when it cannot be shown: its type is not
     * an image, its stream cannot be read or is damaged, or `ImageDecoder`
     * refuses it. A read that meets damage marks the file damaged
     * ([FileReader.open]).
     */
    suspend fun decode(file: NoteFile, side: Int): Bitmap? = withContext(work) {
        if (!file.maybeImage || side <= 0) return@withContext null
        val bytes = try {
            reader.open(file).use { it.readBytes() }
        } catch (_: IOException) {
            return@withContext null
        } catch (_: BlobException) {
            return@withContext null
        } catch (_: SQLException) {
            return@withContext null
        }
        try {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ ->
                // In memory the screens draw from, and never larger than it shows.
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                val largest = max(info.size.width, info.size.height)
                if (largest > side) decoder.setTargetSampleSize(largest / side)
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
}
