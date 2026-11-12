package app.shkriuss.core.crypto

import java.io.File
import java.io.FileOutputStream
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption

/**
 * Where the wrapped keysets of one app are stored. The real one is
 * [KeysetFiles]. Tests wrap it to stop in the middle of a change.
 */
internal interface KeysetStore {
    /** The stored blob of [name], or null if there is none. */
    fun read(name: KeysetName): ByteArray?

    /** Stores [blob] as [name], so that after a stop either the old blob or the new one is there, whole. */
    fun replace(name: KeysetName, blob: ByteArray)

    /** Removes the stored blob of [name], if there is one. */
    fun delete(name: KeysetName)

    /**
     * Removes what a stopped [replace] left behind. Returns false if the
     * store holds something this code does not know. Then nobody can say
     * that every keyset was seen, and no hardware key may be deleted.
     */
    fun tidy(): Boolean
}

/**
 * The keyset files: one file per keyset in the folder `shk-keys/` inside
 * the app's no-backup files folder. A file has the name of its keyset.
 */
internal class KeysetFiles(private val folder: File) : KeysetStore {
    override fun read(name: KeysetName): ByteArray? {
        val file = File(folder, name.text)
        return if (file.isFile) file.readBytes() else null
    }

    /**
     * Rule 6 of "Rules for making, replacing and losing a hardware key":
     * write a new file, flush it to storage, rename it over the old one,
     * flush the folder.
     */
    override fun replace(name: KeysetName, blob: ByteArray) {
        folder.mkdirs()
        val temporary = File(folder, name.text + TEMPORARY)
        FileOutputStream(temporary).use { output ->
            output.write(blob)
            output.fd.sync()
        }
        Files.move(
            temporary.toPath(),
            File(folder, name.text).toPath(),
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING,
        )
        flushFolder()
    }

    override fun delete(name: KeysetName) {
        val file = File(folder, name.text)
        if (file.exists()) {
            Files.delete(file.toPath())
            flushFolder()
        }
    }

    override fun tidy(): Boolean {
        val names = KeysetName.entries.map { it.text }
        var known = true
        folder.listFiles().orEmpty().forEach { file ->
            when {
                file.isFile && file.name in names -> Unit
                file.isFile && file.name.removeSuffix(TEMPORARY) in names -> Files.delete(file.toPath())
                else -> known = false
            }
        }
        return known
    }

    /** Makes the rename itself survive a power loss. */
    private fun flushFolder() {
        FileChannel.open(folder.toPath(), StandardOpenOption.READ).use { it.force(true) }
    }

    private companion object {
        const val TEMPORARY = ".tmp"
    }
}
