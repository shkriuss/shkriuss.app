package app.shkriuss.feature.notes

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption

/**
 * The folder `attachments/` in Notes' no-backup files folder: the stream
 * of each file, named by the file's `id`, and `<id>.part` while one is
 * written (docs/apps/notes/spec.md, "On this phone only"). The database is
 * the truth: a stream is written before its record and removed after its
 * record is wiped, so a stop leaves at most a stream that no record needs.
 */
class NoteFileStore(
    /** The folder. It is made when the first file is written. */
    val folder: File,
) {
    /** The stream of the file [id]. It may not exist. */
    fun stream(id: String): File = File(folder, id)

    /** Where the stream of the file [id] is written before its rename. */
    fun part(id: String): File = File(folder, id + PART)

    /** True if the stream of the file [id] is on the phone, with the length of a stream of [size] bytes. */
    fun isWhole(id: String, size: Long): Boolean = stream(id).let { it.isFile && it.length() == StreamLength.of(size) }

    /** True if the stream of the file [id] is on the phone, of any length. */
    fun has(id: String): Boolean = stream(id).isFile

    /**
     * Opens `<id>.part` for a new stream. Write the stream into
     * [PartWriter.output], then [PartWriter.finish] it: it is flushed to
     * storage, renamed to `<id>` and the folder is flushed.
     */
    fun startPart(id: String): PartWriter {
        folder.mkdirs()
        return PartWriter(id, FileOutputStream(part(id)))
    }

    /** One stream being written as `<id>.part`. Close it with [finish] or [abandon]. */
    inner class PartWriter internal constructor(private val id: String, private val file: FileOutputStream) {
        /** Where the stream goes. Closing it does not close the file: [finish] does, after it flushed it. */
        val output: OutputStream = object : OutputStream() {
            override fun write(byte: Int) = file.write(byte)

            override fun write(bytes: ByteArray, offset: Int, length: Int) = file.write(bytes, offset, length)

            override fun close() = Unit
        }

        /** Flushes the part to storage, closes it, renames it to `<id>` and flushes the folder. */
        fun finish() {
            file.use { it.fd.sync() }
            Files.move(part(id).toPath(), stream(id).toPath(), StandardCopyOption.ATOMIC_MOVE)
            flushFolder()
        }

        /** Closes the part and deletes it: the file is not added. */
        fun abandon() {
            try {
                file.close()
            } catch (_: IOException) {
                // The part goes all the same.
            }
            part(id).delete()
        }
    }

    /**
     * Moves a stream of a restore in as the stream of the file [id]: [move]
     * renames it to the file it is given, which it replaces. Then the
     * folder is flushed, so the rename survives a power loss.
     */
    fun moveIn(id: String, move: (File) -> Unit) {
        folder.mkdirs()
        move(stream(id))
        flushFolder()
    }

    /** Removes the stream of the file [id], if it is there. False if it is there and could not be removed: the next start tries again. */
    fun remove(id: String): Boolean {
        val stream = stream(id)
        return !stream.exists() || stream.delete()
    }

    /**
     * Removes every stream that is not in [keep], and every `.part` file
     * whose `id` is not in [keep]. [keep] holds the `id` of every file that
     * is not wiped, and of every add that is running. Returns false if
     * something could not be removed: the next start tries again.
     */
    fun removeAllBut(listed: List<File>, keep: Set<String>): Boolean = listed.fold(true) { removed, file ->
        val id = file.name.removeSuffix(PART)
        if (id in keep) removed else file.delete() && removed
    }

    /** What the folder holds now. A sweep lists it before it reads which files to keep, so a stream written after the list is not in it. */
    fun list(): List<File> = folder.listFiles()?.toList().orEmpty()

    /** Makes a rename survive a power loss. */
    private fun flushFolder() {
        FileChannel.open(folder.toPath(), StandardOpenOption.READ).use { it.force(true) }
    }

    private companion object {
        const val PART = ".part"
    }
}

/**
 * The length of the stream of a file of P bytes (crypto-design.md, kind 2):
 * 5 + 40 + P, plus 16 for each segment. There is one segment if P is at
 * most 1,048,520; each further 1,048,560 bytes, or part of them, add one.
 * A stream of another length is cut or damaged.
 */
object StreamLength {
    /** The plaintext of the first segment. */
    private const val FIRST: Long = 1_048_520L

    /** The plaintext of every later segment. */
    private const val LATER: Long = 1_048_560L

    /** The length of the stream of a file of [size] bytes. */
    fun of(size: Long): Long {
        val segments = if (size <= FIRST) 1L else 1L + (size - FIRST + LATER - 1) / LATER
        return 45L + size + 16L * segments
    }
}
