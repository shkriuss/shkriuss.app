package app.shkriuss.core.crypto

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Round trips for every kind of blob, with empty, small and large input
 * (item 2 of "What the tests must cover" in crypto-design.md). Sealing is
 * tested here, because Tink cannot be told which nonce to use.
 */
class RoundTripTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val recordId = "00112233-4455-4677-8899-aabbccddeeff"
    private val fileId = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"

    private fun appWithKeys(): TestApp = TestApp(temporary.newFolder()).also {
        assertEquals(KeySetupResult.STORED, it.open().setup.storeDerivedKeys(TestKeys.vectorRecoveryKey()))
    }

    @Test
    fun kind1SealedRecords() {
        val app = appWithKeys()
        val crypto = app.open()
        listOf(0, 1, 18, 4_096, 3_000_000).forEach { size ->
            val plaintext = TestKeys.pattern(size)
            val blob = crypto.records.seal(recordId, plaintext)
            assertEquals("a sealed record is 50 bytes longer", size + 50, blob.size)
            assertEquals("53484b010101b19d376f", blob.copyOf(10).toHex())
            assertArrayEquals(plaintext, crypto.records.open(recordId, blob))
            // The app started again opens it too: the keyset came back from its file.
            assertArrayEquals(plaintext, app.open().records.open(recordId, blob))
        }
    }

    @Test
    fun kind1EverySealHasItsOwnNonce() {
        val crypto = appWithKeys().open()
        val first = crypto.records.seal(recordId, ByteArray(32))
        val second = crypto.records.seal(recordId, ByteArray(32))
        assertFalse(first.contentEquals(second))
        assertFalse(first.copyOfRange(10, 34).contentEquals(second.copyOfRange(10, 34)))
    }

    @Test
    fun kind2FileStreams() {
        val key = appWithKeys().open().files.newFileKey()
        listOf(0, 1, 16, 1_048_520, 1_048_521, 3 * 1_048_576 + 7).forEach { size ->
            val plaintext = TestKeys.pattern(size)
            val blob = TestKeys.encryptFile(key, fileId, plaintext)
            assertEquals(expectedStreamSize(size), blob.size)
            assertEquals("53484b010228", blob.copyOf(6).toHex())
            assertArrayEquals(plaintext, TestKeys.decryptFile(key, fileId, blob))
        }
    }

    @Test
    fun kind2EveryFileContentGetsItsOwnKeySaltAndPrefix() {
        val files = appWithKeys().open().files
        val key = files.newFileKey()
        val first = TestKeys.encryptFile(key, fileId, ByteArray(64))
        val second = TestKeys.encryptFile(key, fileId, ByteArray(64))
        assertFalse(first.copyOfRange(6, 45).contentEquals(second.copyOfRange(6, 45)))
        // A blob of one key does not open with the key of another file content.
        assertEquals(
            BlobAnswer.DAMAGED_OR_CHANGED,
            TestKeys.answerOf { TestKeys.decryptFile(files.newFileKey(), fileId, first) },
        )
    }

    @Test
    fun kind3BackupStreams() {
        val app = appWithKeys()
        val backupHeader = "a backup header with the key ID b19d376f".toByteArray()
        listOf(0, 1, 5_000, 2 * 1_048_576 + 100).forEach { size ->
            val plaintext = TestKeys.pattern(size)
            val blob = ByteArrayOutputStream()
            app.open().backups.encryptingStream(backupHeader, blob).use { it.write(plaintext) }
            assertEquals(expectedStreamSize(size), blob.size())
            assertEquals("53484b010328", blob.toByteArray().copyOf(6).toHex())
            val restored = app.open().backups.decryptingStream(backupHeader, ByteArrayInputStream(blob.toByteArray()))
                .use { it.readBytes() }
            assertArrayEquals(plaintext, restored)
        }
    }

    @Test
    fun kind3TheKeyIdForTheBackupHeader() {
        val backups = appWithKeys().open().backups
        assertEquals("b19d376f", backups.keyId().toString())
        assertTrue(backups.hasKey(TestKeys.vectorRecoveryKey().keyId))
        assertFalse(backups.hasKey(KeyId(1)))
    }

    @Test
    fun kind4WrappedFileKeys() {
        val app = appWithKeys()
        val files = app.open().files
        val key = files.newFileKey()
        val encrypted = TestKeys.encryptFile(key, fileId, TestKeys.pattern(70_000))
        val wrapped = files.wrap(fileId, key)
        assertEquals("53484b010401b19d376f", wrapped.copyOf(10).toHex())
        assertTrue(files.isSealedByCurrentKey(wrapped))

        // The app started again opens the wrapped key, and with it the file.
        val unwrapped = app.open().files.unwrap(fileId, wrapped)
        assertArrayEquals(TestKeys.pattern(70_000), TestKeys.decryptFile(unwrapped, fileId, encrypted))
    }

    @Test
    fun kind5EveryKeysetComesBackFromItsFile() {
        val app = appWithKeys()
        val derived = TestKeys.derived(TestKeys.vectorRecoveryKey())
        app.open()
        listOf(
            KeysetName.RECORD to derived.record,
            KeysetName.BACKUP to derived.backup,
            KeysetName.FILE_KEY to derived.fileKey,
        ).forEach { (name, expected) ->
            val stored = app.vault.look(name) as Stored.Open
            assertTrue(stored.keyset.equalsKeyset(expected))
            assertEquals("53484b0105", KeysetFiles(app.folder).read(name)!!.copyOf(5).toHex())
        }
    }

    /** 5 + 40 + P, plus 16 for each segment: one up to 1,048,520 bytes, then one per 1,048,560 or part of them. */
    private fun expectedStreamSize(plaintext: Int): Int {
        val first = 1_048_520
        val later = 1_048_560
        val segments = if (plaintext <= first) 1 else 1 + (plaintext - first + later - 1) / later
        return 5 + 40 + plaintext + 16 * segments
    }
}
