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
     * Copies the stored blob of [name] to the set-aside folder, before a
     * damaged keyset is written over or given up. The stored blob stays
     * where it is. A set-aside file is never written over, and a blob
     * whose exact bytes are set aside already is not copied again.
     */
    fun setAside(name: KeysetName)

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
 *
 * Damaged keyset files are copied to [setAsideFolder] before they are
 * written over or given up, as `<name>-<n>`, and kept there. It is a
 * folder of its own, next to [folder], because [tidy] counts any file in
 * [folder] that it does not know as "could not read every header".
 */
internal class KeysetFiles(
    private val folder: File,
    private val setAsideFolder: File = File(folder.path + SET_ASIDE_SUFFIX),
) : KeysetStore {
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

    /**
     * Writes the copy as a new file, flushes it, renames it to the next
     * free number without replacing anything, and flushes the folder.
     */
    override fun setAside(name: KeysetName) {
        val blob = read(name) ?: return
        setAsideFolder.mkdirs()
        val numbered = setAsideFolder.listFiles().orEmpty()
            .filter { it.isFile && it.name.startsWith("${name.text}-") }
            .mapNotNull { file -> file.name.removePrefix("${name.text}-").toIntOrNull()?.let { it to file } }
        if (numbered.any { (_, file) -> file.readBytes().contentEquals(blob) }) return
        val number = (numbered.maxOfOrNull { it.first } ?: 0) + 1
        val temporary = File(setAsideFolder, "${name.text}-$number$TEMPORARY")
        FileOutputStream(temporary).use { output ->
            output.write(blob)
            output.fd.sync()
        }
        // No REPLACE_EXISTING: the move fails rather than write over a set-aside file.
        Files.move(temporary.toPath(), File(setAsideFolder, "${name.text}-$number").toPath())
        flush(setAsideFolder)
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
    private fun flushFolder() = flush(folder)

    private fun flush(directory: File) {
        FileChannel.open(directory.toPath(), StandardOpenOption.READ).use { it.force(true) }
    }

    companion object {
        private const val TEMPORARY = ".tmp"

        /** The set-aside folder is the keyset folder's name with this added: `shk-keys-set-aside`. */
        const val SET_ASIDE_SUFFIX = "-set-aside"
    }
}
