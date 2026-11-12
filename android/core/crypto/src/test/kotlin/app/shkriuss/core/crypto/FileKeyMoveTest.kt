package app.shkriuss.core.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The move from a random `file-key` key to a derived one, stopped in the
 * middle and continued (item 7 of "What the tests must cover" in
 * crypto-design.md). The rows of a real app are sealed again through
 * `RecordWriter`. That comes with the first app that stores files. Here
 * the rows are a map in the test.
 */
class FileKeyMoveTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val recoveryKey = TestKeys.vectorRecoveryKey()
    private val fileIds = listOf(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000003",
    )

    /** An app with no recovery key that already has files: the encrypted file and its wrapped key, by file ID. */
    private class Files(val encrypted: Map<String, ByteArray>, val wrapped: MutableMap<String, ByteArray>)

    private fun appWithFiles(): Pair<TestApp, Files> {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        val encrypted = mutableMapOf<String, ByteArray>()
        val wrapped = mutableMapOf<String, ByteArray>()
        fileIds.forEach { id ->
            val key = crypto.files.newFileKey()
            encrypted[id] = TestKeys.encryptFile(key, id, "the file $id".toByteArray())
            wrapped[id] = crypto.files.wrap(id, key)
        }
        return app to Files(encrypted, wrapped)
    }

    private fun assertEveryFileOpens(crypto: ShkCrypto, files: Files) = fileIds.forEach { id ->
        val key = crypto.files.unwrap(id, files.wrapped.getValue(id))
        assertArrayEquals("the file $id".toByteArray(), TestKeys.decryptFile(key, id, files.encrypted.getValue(id)))
    }

    @Test
    fun addingFilesNeedsNoRecoveryKey() {
        val (app, files) = appWithFiles()
        val crypto = app.open()
        assertEveryFileOpens(crypto, files)
        assertFalse(crypto.status().hasDerivedKeys)
        assertNull(app.keyOf(KeysetName.RECORD))
        assertEquals(HardwareKeyKind.UNLOCKED, app.keyOf(KeysetName.FILE_KEY)?.kind)
        // A file key sealed by a key that exists only on this phone must never leave it.
        assertFalse(crypto.backups.mayMakeBackup())
        assertFalse(crypto.appLock.canTurnOn())
    }

    @Test
    fun theWholeMoveWithoutAStop() {
        val (app, files) = appWithFiles()
        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(recoveryKey))
        assertEquals(listOf("file-key-old", "file-key", "backup", "record"), app.store.changes)

        // The old keyset opens what it sealed. New file keys are sealed by the derived key.
        val crypto = app.open()
        assertTrue(crypto.setup.fileKeyMoveIsPending())
        assertEveryFileOpens(crypto, files)
        assertFalse(crypto.backups.mayMakeBackup())
        assertFalse(crypto.appLock.canTurnOn())
        assertEquals(recoveryKey.keyId, SealedBlobs.keyIdOf(BlobKind.WRAPPED_FILE_KEY, crypto.files.wrap(fileIds[0], crypto.files.newFileKey())))

        // Seal every row again. This can stop and go on later.
        fileIds.take(2).forEach { id -> files.wrapped[id] = crypto.files.sealAgain(id, files.wrapped.getValue(id)) }
        val later = app.open()
        assertEveryFileOpens(later, files)
        val left = fileIds.filterNot { later.files.isSealedByCurrentKey(files.wrapped.getValue(it)) }
        assertEquals(listOf(fileIds[2]), left)
        val oldWrapped = files.wrapped.getValue(fileIds[2])
        left.forEach { id -> files.wrapped[id] = later.files.sealAgain(id, files.wrapped.getValue(id)) }

        // When no row is left, file-key-old is deleted.
        later.setup.finishFileKeyMove()
        val done = app.open()
        assertFalse(done.setup.fileKeyMoveIsPending())
        assertNull(app.keyOf(KeysetName.FILE_KEY_OLD))
        assertEveryFileOpens(done, files)
        assertTrue(done.backups.mayMakeBackup())
        assertTrue(done.appLock.canTurnOn())
        fileIds.forEach { id ->
            assertEquals(recoveryKey.keyId, SealedBlobs.keyIdOf(BlobKind.WRAPPED_FILE_KEY, files.wrapped.getValue(id)))
        }
        // What only the old keyset sealed does not open any more.
        assertEquals(BlobAnswer.NEEDS_ANOTHER_RECOVERY_KEY, TestKeys.answerOf { done.files.unwrap(fileIds[2], oldWrapped) })
    }

    @Test
    fun stoppedBeforeEachChangeAndContinuedWithTheSameWords() {
        (1..4).forEach { stopBefore ->
            val (app, files) = appWithFiles()
            val crypto = app.open()
            app.store.stopBeforeChange = stopBefore
            try {
                crypto.setup.storeDerivedKeys(recoveryKey)
                fail("did not stop")
            } catch (_: Stopped) {
                // The app was killed here.
            }

            // Stopped: the app has no derived keys yet, and every file still opens.
            val stopped = app.open()
            assertFalse("stop $stopBefore", stopped.status().hasDerivedKeys)
            assertEveryFileOpens(stopped, files)
            assertFalse(stopped.backups.mayMakeBackup())
            val oldAfterStop = app.snapshot()["file-key-old"]

            // A file added now is sealed by whatever file-key holds at this moment.
            val addedId = "00000000-0000-4000-8000-0000000000aa"
            val addedKey = stopped.files.newFileKey()
            val addedWrapped = stopped.files.wrap(addedId, addedKey)

            // The same words finish the setup. Each step can be done twice without harm.
            assertEquals("stop $stopBefore", KeySetupResult.STORED, app.open().setup.storeDerivedKeys(recoveryKey))
            val continued = app.open()
            assertTrue(continued.status().hasDerivedKeys)
            assertTrue(continued.setup.fileKeyMoveIsPending())
            assertEveryFileOpens(continued, files)
            assertTrue(TestKeys.derived(recoveryKey).fileKey.equalsKeyset((app.vault.look(KeysetName.FILE_KEY) as Stored.Open).keyset))
            // file-key-old is never written again: it still holds the random keyset.
            if (oldAfterStop != null) assertEquals(oldAfterStop, app.snapshot()["file-key-old"])
            // The file that was added in between opens too.
            val added = TestKeys.encryptFile(addedKey, addedId, "added".toByteArray())
            assertArrayEquals("added".toByteArray(), TestKeys.decryptFile(continued.files.unwrap(addedId, addedWrapped), addedId, added))
        }
    }

    @Test
    fun doingTheSetupTwiceChangesNothing() {
        val (app, files) = appWithFiles()
        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(recoveryKey))
        val before = app.snapshot()

        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(recoveryKey))
        assertEquals(emptyList<String>(), app.store.changes)
        assertEquals(before, app.snapshot())
        assertEveryFileOpens(app.open(), files)
    }

    @Test
    fun aSetupThatStoredADerivedKeysetIsNotFinishedByADifferentRecoveryKey() {
        val other = RecoveryKey.ofBytes(ByteArray(32) { 0x42 })
        (3..4).forEach { stopBefore ->
            val (app, files) = appWithFiles()
            val crypto = app.open()
            app.store.stopBeforeChange = stopBefore
            try {
                crypto.setup.storeDerivedKeys(recoveryKey)
                fail("did not stop")
            } catch (_: Stopped) {
                // The app was killed here: file-key is already derived from the first key.
            }
            // A file added now is sealed by a key of the first recovery key.
            val addedId = "00000000-0000-4000-8000-0000000000aa"
            val addedKey = app.open().files.newFileKey()
            val addedWrapped = app.open().files.wrap(addedId, addedKey)
            val before = app.snapshot()

            assertEquals("stop $stopBefore", KeySetupResult.DIFFERENT_RECOVERY_KEY, app.open().setup.storeDerivedKeys(other))
            assertEquals("nothing was stored, stop $stopBefore", before, app.snapshot())
            assertEquals(emptyList<String>(), app.store.changes)
            assertFalse(app.open().status().hasDerivedKeys)

            // The first words still finish it, and nothing was lost.
            assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(recoveryKey))
            val finished = app.open()
            assertEveryFileOpens(finished, files)
            val added = TestKeys.encryptFile(addedKey, addedId, "added".toByteArray())
            assertArrayEquals("added".toByteArray(), TestKeys.decryptFile(finished.files.unwrap(addedId, addedWrapped), addedId, added))
        }
    }

    @Test
    fun aSetupThatStoredNoDerivedKeysetYetCanBeFinishedByOtherWords() {
        // Stopped after file-key-old, before file-key: nothing of the first key is stored.
        // file-key is still the random keyset that file-key-old holds too.
        val other = RecoveryKey.ofBytes(ByteArray(32) { 0x42 })
        val (app, files) = appWithFiles()
        val crypto = app.open()
        app.store.stopBeforeChange = 2
        try {
            crypto.setup.storeDerivedKeys(recoveryKey)
            fail("did not stop")
        } catch (_: Stopped) {
            // The app was killed here.
        }
        val oldBefore = app.snapshot().getValue("file-key-old")

        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(other))
        assertEquals(listOf("file-key", "backup", "record"), app.store.changes)
        assertEquals("file-key-old is never written again", oldBefore, app.snapshot().getValue("file-key-old"))
        val after = app.open()
        assertEquals(other.keyId, after.status().keyId)
        assertEveryFileOpens(after, files)
        // Now the app has its keys, and the first words are a different recovery key.
        assertEquals(KeySetupResult.DIFFERENT_RECOVERY_KEY, app.open().setup.storeDerivedKeys(recoveryKey))
    }

    @Test
    fun withoutARandomKeyNoFileKeyOldIsMade() {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        app.store.stopBeforeChange = 2
        try {
            crypto.setup.storeDerivedKeys(recoveryKey)
            fail("did not stop")
        } catch (_: Stopped) {
            // Stopped after file-key, which is already the derived keyset.
        }
        assertEquals(listOf("file-key"), app.store.changes)

        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(recoveryKey))
        assertEquals(listOf("backup", "record"), app.store.changes)
        assertNull(app.keyOf(KeysetName.FILE_KEY_OLD))
        assertFalse(app.open().setup.fileKeyMoveIsPending())
    }

    @Test
    fun aFileKeyOfAnAbandonedSetupBecomesTheOldOne() {
        // No random key, a stop right after file-key, and then other words. No file-key-old
        // exists yet, so the stored file-key is kept as file-key-old and nothing is lost.
        val other = RecoveryKey.ofBytes(ByteArray(32) { 0x42 })
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        app.store.stopBeforeChange = 2
        try {
            crypto.setup.storeDerivedKeys(recoveryKey)
            fail("did not stop")
        } catch (_: Stopped) {
            // Stopped after file-key.
        }
        val id = fileIds[0]
        val key = app.open().files.newFileKey()
        val wrapped = app.open().files.wrap(id, key)
        assertEquals(recoveryKey.keyId, SealedBlobs.keyIdOf(BlobKind.WRAPPED_FILE_KEY, wrapped))

        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(other))
        assertEquals(listOf("file-key-old", "file-key", "backup", "record"), app.store.changes)
        val after = app.open()
        assertTrue(after.setup.fileKeyMoveIsPending())
        assertEquals(other.keyId, after.status().keyId)
        val file = TestKeys.encryptFile(key, id, "kept".toByteArray())
        assertArrayEquals("kept".toByteArray(), TestKeys.decryptFile(after.files.unwrap(id, wrapped), id, file))
    }
}
