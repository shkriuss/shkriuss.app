package app.shkriuss.core.crypto

import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The keyset files in `shk-keys/`: one file per keyset, named after it,
 * and replaced so that a stop leaves the old file or the new one, whole.
 */
class KeysetFilesTest {
    @get:Rule
    val temporary = TemporaryFolder()

    @Test
    fun aFileHasTheNameOfItsKeyset() {
        val folder = File(temporary.root, "shk-keys")
        val files = KeysetFiles(folder)
        assertNull(files.read(KeysetName.RECORD))

        KeysetName.entries.forEach { files.replace(it, it.text.toByteArray()) }

        assertEquals(
            listOf("backup", "file-key", "file-key-old", "record", "recovery"),
            folder.list()!!.sorted(),
        )
        KeysetName.entries.forEach { assertArrayEquals(it.text.toByteArray(), files.read(it)) }
    }

    @Test
    fun replacingLeavesOnlyTheNewFile() {
        val folder = temporary.newFolder()
        val files = KeysetFiles(folder)
        files.replace(KeysetName.RECORD, byteArrayOf(1, 2, 3))
        files.replace(KeysetName.RECORD, byteArrayOf(4, 5))

        assertArrayEquals(byteArrayOf(4, 5), files.read(KeysetName.RECORD))
        assertEquals(listOf("record"), folder.list()!!.toList())
    }

    @Test
    fun deletingRemovesTheFile() {
        val folder = temporary.newFolder()
        val files = KeysetFiles(folder)
        files.replace(KeysetName.FILE_KEY_OLD, byteArrayOf(1))
        files.delete(KeysetName.FILE_KEY_OLD)
        files.delete(KeysetName.FILE_KEY_OLD)

        assertNull(files.read(KeysetName.FILE_KEY_OLD))
        assertEquals(emptyList<String>(), folder.list()!!.toList())
    }

    @Test
    fun whatAStoppedReplacementLeftBehindIsRemoved() {
        val folder = temporary.newFolder()
        val files = KeysetFiles(folder)
        files.replace(KeysetName.RECORD, byteArrayOf(1, 2, 3))
        // The app stopped after it wrote the new file and before it renamed it.
        File(folder, "record.tmp").writeBytes(byteArrayOf(9))
        File(folder, "backup.tmp").writeBytes(byteArrayOf(9))

        assertTrue(files.tidy())

        assertEquals(listOf("record"), folder.list()!!.toList())
        assertArrayEquals("the old file is whole", byteArrayOf(1, 2, 3), files.read(KeysetName.RECORD))
        assertNull(files.read(KeysetName.BACKUP))
    }

    @Test
    fun anUnknownFileMeansNotEveryKeysetWasSeen() {
        val folder = temporary.newFolder()
        val files = KeysetFiles(folder)
        files.replace(KeysetName.RECORD, byteArrayOf(1))
        File(folder, "something-else").writeBytes(byteArrayOf(1))

        assertFalse(files.tidy())
        assertTrue("it is left alone", File(folder, "something-else").exists())
    }

    @Test
    fun aFolderThatDoesNotExistYetIsEmpty() {
        val files = KeysetFiles(File(temporary.root, "not-there"))
        assertTrue(files.tidy())
        assertNull(files.read(KeysetName.RECORD))
        files.delete(KeysetName.RECORD)
    }
}
