package app.shkriuss.core.crypto

import app.shkriuss.core.crypto.fixtures.SoftwareHardwareKeys
import com.google.crypto.tink.KeysetHandle
import java.io.File
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
 * Starting over after a setup that stopped half way, with a new recovery
 * key or other words (item 10 of "What the tests must cover" in
 * crypto-design.md). Every key that was ever in `file-key` must still be
 * in `file-key` or `file-key-old` afterwards, after a stop at any point.
 */
class StartOverTest {
    @get:Rule
    val temporary = TemporaryFolder()

    /** The words of the setup that stopped. The user lost them. */
    private val lost = TestKeys.vectorRecoveryKey()
    private val fresh = RecoveryKey.ofBytes(ByteArray(32) { (it + 100).toByte() })
    private val other = RecoveryKey.ofBytes(ByteArray(32) { (it + 200).toByte() })

    /** The files of an app: the encrypted file and its wrapped key, by file ID. */
    private class Files(val encrypted: MutableMap<String, ByteArray> = mutableMapOf(), val wrapped: MutableMap<String, ByteArray> = mutableMapOf())

    private fun addFile(crypto: ShkCrypto, files: Files, id: String) {
        val key = crypto.files.newFileKey()
        files.encrypted[id] = TestKeys.encryptFile(key, id, "the file $id".toByteArray())
        files.wrapped[id] = crypto.files.wrap(id, key)
    }

    private fun assertEveryFileOpens(crypto: ShkCrypto, files: Files, context: String = "") = files.wrapped.keys.forEach { id ->
        val key = crypto.files.unwrap(id, files.wrapped.getValue(id))
        assertArrayEquals(context, "the file $id".toByteArray(), TestKeys.decryptFile(key, id, files.encrypted.getValue(id)))
    }

    private fun fileId(number: Int) = "00000000-0000-4000-8000-%012d".format(number)

    /**
     * An app with files under a random key, whose setup with [lost]
     * stopped just before `record`: `file-key-old` holds the random key,
     * `file-key` and `backup` are derived from [lost], and one more file
     * was sealed under the derived `file-key`.
     */
    private fun stoppedSetup(hardware: SoftwareHardwareKeys = SoftwareHardwareKeys(), withRandomKey: Boolean = true): Pair<TestApp, Files> {
        val app = TestApp(temporary.newFolder(), hardware)
        val files = Files()
        if (withRandomKey) (1..2).forEach { addFile(app.open(), files, fileId(it)) }
        val crypto = app.open()
        app.store.stopBeforeChange = if (withRandomKey) 4 else 3
        try {
            crypto.setup.storeDerivedKeys(lost)
            fail("did not stop")
        } catch (_: Stopped) {
            // The app was killed just before record.
        }
        addFile(app.open(), files, fileId(3))
        assertTrue(app.open().status().setupIsUnfinished)
        return app to files
    }

    private fun keysetOf(app: TestApp, name: KeysetName): KeysetHandle = (app.vault.look(name) as Stored.Open).keyset

    private fun idsOf(app: TestApp, name: KeysetName): Set<KeyId> = KeysetCodec.keyIds(keysetOf(app, name)).toSet()

    @Test
    fun startOverIsRefusedWhenTheSetupIsNotUnfinished() {
        val nothing = TestApp(temporary.newFolder())
        assertEquals(StartOverResult.NOT_UNFINISHED, nothing.open().setup.startOver(fresh))
        assertEquals(emptyMap<String, String>(), nothing.snapshot())

        val randomOnly = TestApp(temporary.newFolder())
        addFile(randomOnly.open(), Files(), fileId(1))
        val before = randomOnly.snapshot()
        assertEquals(StartOverResult.NOT_UNFINISHED, randomOnly.open().setup.startOver(fresh))
        assertEquals(before, randomOnly.snapshot())

        val finished = TestApp(temporary.newFolder())
        assertEquals(KeySetupResult.STORED, finished.open().setup.storeDerivedKeys(lost))
        finished.open().setup.beginKeepRecoveryKey(lost)!!.finish()
        val kept = finished.snapshot()
        assertFalse(finished.open().status().setupIsUnfinished)
        assertEquals(StartOverResult.NOT_UNFINISHED, finished.open().setup.startOver(fresh))
        assertEquals(kept, finished.snapshot())
    }

    @Test
    fun startingOverKeepsEveryOldFileKeyAndTakesTheNewKey() {
        val (app, files) = stoppedSetup()
        val random = KeysetCodec.keyIds(keysetOf(app, KeysetName.FILE_KEY_OLD)).single()
        val stopped = app.open()
        assertTrue(stopped.status().setupIsUnfinished)
        assertFalse(stopped.status().hasDerivedKeys)
        // The lost words cannot be given again, and other words are refused as before.
        assertEquals(KeySetupResult.DIFFERENT_RECOVERY_KEY, stopped.setup.storeDerivedKeys(fresh))

        assertEquals(StartOverResult.STORED, app.open().setup.startOver(fresh))

        assertEquals(listOf("file-key-old", "file-key", "backup", "record"), app.store.changes)
        val crypto = app.open()
        val status = crypto.status()
        assertTrue(status.hasDerivedKeys)
        assertFalse(status.setupIsUnfinished)
        assertEquals(fresh.keyId, status.keyId)
        assertEquals(setOf(random, lost.keyId), idsOf(app, KeysetName.FILE_KEY_OLD))
        assertEquals("the random key stays the primary", random, KeysetCodec.primaryId(keysetOf(app, KeysetName.FILE_KEY_OLD)))
        val derived = TestKeys.derived(fresh)
        assertTrue(KeysetCodec.sameKeys(keysetOf(app, KeysetName.FILE_KEY), derived.fileKey))
        assertTrue("the backup keyset of the stopped setup is written over", KeysetCodec.sameKeys(keysetOf(app, KeysetName.BACKUP), derived.backup))
        assertTrue(KeysetCodec.sameKeys(keysetOf(app, KeysetName.RECORD), derived.record))
        assertEveryFileOpens(crypto, files)

        // The move then seals every file key again under the new key, and file-key-old goes.
        assertFalse(crypto.backups.mayMakeBackup())
        files.wrapped.keys.forEach { id -> files.wrapped[id] = crypto.files.sealAgain(id, files.wrapped.getValue(id)) }
        assertTrue(files.wrapped.values.all { crypto.files.isSealedByCurrentKey(it) })
        crypto.setup.finishFileKeyMove()
        val done = app.open()
        assertEveryFileOpens(done, files)
        assertTrue(done.backups.mayMakeBackup())
    }

    @Test
    fun stoppedBeforeEachChangeAndStartedOverAgainWithTheSameWords() {
        (1..4).forEach { stopBefore ->
            val (app, files) = stoppedSetup()
            app.open()
            app.store.stopBeforeChange = stopBefore
            try {
                app.vault.locked { KeySetup(app.vault).startOver(fresh) }
                fail("did not stop")
            } catch (_: Stopped) {
                // The app was killed here.
            }
            val oldBefore = idsOf(app, KeysetName.FILE_KEY_OLD)
            val stopped = app.open()
            assertEveryFileOpens(stopped, files, "stop $stopBefore")
            assertTrue("stop $stopBefore", stopped.status().setupIsUnfinished)
            addFile(stopped, files, fileId(10 + stopBefore))

            assertEquals("stop $stopBefore", StartOverResult.STORED, app.open().setup.startOver(fresh))
            if (stopBefore > 1) assertFalse("the union gains nothing and is not written again", "file-key-old" in app.store.changes)
            assertTrue("file-key-old only grows", idsOf(app, KeysetName.FILE_KEY_OLD).containsAll(oldBefore))
            assertEveryFileOpens(app.open(), files, "stop $stopBefore")
            assertEquals(fresh.keyId, app.open().status().keyId)
        }
    }

    @Test
    fun stoppedBeforeEachChangeAndStartedOverWithOtherWords() {
        (1..4).forEach { stopBefore ->
            val (app, files) = stoppedSetup()
            app.open()
            app.store.stopBeforeChange = stopBefore
            try {
                app.vault.locked { KeySetup(app.vault).startOver(fresh) }
                fail("did not stop")
            } catch (_: Stopped) {
                // The app was killed here.
            }
            addFile(app.open(), files, fileId(20 + stopBefore))

            assertEquals("stop $stopBefore", StartOverResult.STORED, app.open().setup.startOver(other))
            assertEveryFileOpens(app.open(), files, "stop $stopBefore")
            assertEquals(other.keyId, app.open().status().keyId)
            assertTrue(lost.keyId in idsOf(app, KeysetName.FILE_KEY_OLD))
            if (stopBefore >= 3) assertTrue("the key of the first start over is kept too", fresh.keyId in idsOf(app, KeysetName.FILE_KEY_OLD))
        }
    }

    @Test
    fun theLostWordsStillFinishTheSetupAfterAStartOverStoppedAtItsFirstChange() {
        val (app, files) = stoppedSetup()
        app.open()
        app.store.stopBeforeChange = 2
        try {
            app.vault.locked { KeySetup(app.vault).startOver(fresh) }
            fail("did not stop")
        } catch (_: Stopped) {
            // Only the grown file-key-old was written.
        }

        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(lost))
        assertEquals(lost.keyId, app.open().status().keyId)
        assertEveryFileOpens(app.open(), files)
    }

    @Test
    fun withoutARandomKeyTheStoredFileKeyBecomesFileKeyOld() {
        val (app, files) = stoppedSetup(withRandomKey = false)
        assertNull(app.keyOf(KeysetName.FILE_KEY_OLD))

        assertEquals(StartOverResult.STORED, app.open().setup.startOver(fresh))

        assertEquals(listOf("file-key-old", "file-key", "backup", "record"), app.store.changes)
        assertEquals(setOf(lost.keyId), idsOf(app, KeysetName.FILE_KEY_OLD))
        assertEveryFileOpens(app.open(), files)
    }

    @Test
    fun startOverStopsAndChangesNothingOnALockedPhoneOrWithDamagedFileKeys() {
        val (locked, _) = stoppedSetup()
        val before = locked.snapshot()
        locked.hardware.phoneLocked = true
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { locked.open().setup.startOver(fresh) })
        assertEquals(before, locked.snapshot())

        listOf("file-key", "file-key-old").forEach { name ->
            val (app, _) = stoppedSetup()
            damage(File(app.folder, name))
            val damaged = app.snapshot()
            assertEquals(name, StartOverResult.FILE_KEYS_DAMAGED, app.open().setup.startOver(fresh))
            assertEquals(name, damaged, app.snapshot())
            assertTrue(name, app.open().status().filesCanBeGivenUp)
        }
    }

    @Test
    fun aKeyIdThatSealsAnotherFileKeyIsRefused() {
        val (app, _) = stoppedSetup()
        val random = KeysetCodec.keyIds(keysetOf(app, KeysetName.FILE_KEY_OLD)).single()
        val before = app.snapshot()

        // Other words whose key ID is the ID of a key in file-key-old, and of the stored file-key.
        listOf(random, lost.keyId).forEach { taken ->
            val clash = withKeyId(fresh, taken)
            app.open()
            assertEquals(StartOverResult.KEY_ID_IN_USE, app.vault.locked { KeySetup(app.vault).startOverWith(clash) })
            assertEquals(before, app.snapshot())
        }

        // The same for a first setup over a random file-key.
        val randomOnly = TestApp(temporary.newFolder())
        addFile(randomOnly.open(), Files(), fileId(1))
        val randomId = KeysetCodec.keyIds(keysetOf(randomOnly.also { it.open() }, KeysetName.FILE_KEY)).single()
        val unchanged = randomOnly.snapshot()
        randomOnly.open()
        assertEquals(
            KeySetupResult.KEY_ID_IN_USE,
            randomOnly.vault.locked { KeySetup(randomOnly.vault).storeDerived(withKeyId(fresh, randomId)) },
        )
        assertEquals(unchanged, randomOnly.snapshot())
    }

    @Test
    fun aNewRecoveryKeyAvoidsEveryKeyIdTheAppStores() {
        val (app, _) = stoppedSetup()
        val crypto = app.open()
        val stored = KeysetName.entries.filter { it != KeysetName.RECOVERY }
            .mapNotNull { (app.vault.look(it) as? Stored.Open)?.keyset }
            .flatMap { KeysetCodec.keyIds(it) }
            .toSet()

        val known = app.vault.locked { KeySetup(app.vault).knownKeyIds() }

        assertEquals(stored, known)
        assertTrue(known.size >= 2)
        assertFalse(crypto.setup.createRecoveryKey().keyId in known)
    }

    @Test
    fun onAndroid14EverythingStaysUnderTheBackgroundKey() {
        val (app, files) = stoppedSetup(SoftwareHardwareKeys(unlockedKeyAllowed = false))

        assertEquals(StartOverResult.STORED, app.open().setup.startOver(fresh))

        KeysetName.entries.filter { it != KeysetName.RECOVERY }.forEach { name ->
            assertEquals(name.text, HardwareKeyRef(HardwareKeyKind.BACKGROUND, 1), app.keyOf(name))
        }
        assertEveryFileOpens(app.open(), files)
    }

    @Test
    fun theAndroid15MoveBetweenTwoTriesLosesNothing() {
        val hardware = SoftwareHardwareKeys(unlockedKeyAllowed = false)
        val (app, files) = stoppedSetup(hardware)
        app.open()
        app.store.stopBeforeChange = 2
        try {
            app.vault.locked { KeySetup(app.vault).startOver(fresh) }
            fail("did not stop")
        } catch (_: Stopped) {
            // Stopped after file-key-old grew.
        }

        // The phone is updated to Android 15. The next start moves the keysets to an Unlocked key.
        hardware.unlockedKeyAllowed = true
        app.open()
        assertEquals(HardwareKeyKind.UNLOCKED, app.keyOf(KeysetName.FILE_KEY_OLD)?.kind)

        assertEquals(StartOverResult.STORED, app.open().setup.startOver(fresh))
        assertEveryFileOpens(app.open(), files)
        assertEquals(HardwareKeyKind.UNLOCKED, app.keyOf(KeysetName.FILE_KEY)?.kind)
    }

    @Test
    fun afterAStartOverThatFailsHalfWayFileCodeUsesTheKeysetsOnStorageNotThoseInMemory() {
        val (app, files) = stoppedSetup()
        val crypto = app.open()
        // The keysets of the stopped setup are now in memory.
        assertEveryFileOpens(crypto, files)
        app.store.stopBeforeChange = app.store.changes.size + 3
        try {
            crypto.setup.startOver(fresh)
            fail("did not stop")
        } catch (_: Stopped) {
            // file-key-old and file-key were written, backup was not.
        }

        // In the same run: a new file key is sealed by the new file-key, the one on storage.
        val wrapped = crypto.files.wrap(fileId(30), crypto.files.newFileKey())
        assertEquals(fresh.keyId, SealedBlobs.keyIdOf(BlobKind.WRAPPED_FILE_KEY, wrapped))
        assertFalse(crypto.files.isSealedByCurrentKey(files.wrapped.getValue(fileId(3))))
        assertEveryFileOpens(crypto, files)
    }

    @Test
    fun theMoveCannotBeFinishedWhileTheSetupIsUnfinished() {
        val (app, files) = stoppedSetup()
        try {
            app.open().setup.finishFileKeyMove()
            fail("finished the move without record")
        } catch (_: IllegalStateException) {
            // The keys of the old keyset would be lost.
        }
        assertTrue(app.open().setup.fileKeyMoveIsPending())
        assertEveryFileOpens(app.open(), files)
    }

    @Test
    fun theUnionKeepsIdsAndThePrimaryAndAKeysetWithAnIdTwiceIsRefused() {
        val first = KeysetCodec.newRandom(KeysetType.SEALING)
        val second = TestKeys.derived(lost).fileKey
        val union = KeysetCodec.union(first, second)!!
        assertEquals(KeysetCodec.keyIds(first) + KeysetCodec.keyIds(second), KeysetCodec.keyIds(union))
        assertEquals(KeysetCodec.primaryId(first), KeysetCodec.primaryId(union))
        assertNull("nothing new", KeysetCodec.union(union, second))
        assertTrue(KeysetCodec.sameKeys(union, KeysetCodec.parse(KeysetCodec.serialize(union), KeysetType.SEALING)))

        // Two keys under one ID: a keyset file written this way does not open.
        val one = sealingKeysetWithId(5)
        val two = sealingKeysetWithId(5)
        assertTrue(KeysetCodec.clashes(one, two))
        val twice = KeysetCodec.serialize(one) + KeysetCodec.serialize(two)
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { KeysetCodec.parse(twice, KeysetType.SEALING) })
    }

    private fun sealingKeysetWithId(id: Int): KeysetHandle = KeysetHandle.newBuilder()
        .addEntry(KeysetHandle.generateEntryFromParameters(KeysetType.SEALING.parameters).withFixedId(id).makePrimary())
        .build()

    /** A `recovery` keyset for [key] whose key, and so every derived key, has the ID [id] instead of its own. */
    private fun withKeyId(key: RecoveryKey, id: KeyId): KeysetHandle = KeysetHandle.newBuilder()
        .addEntry(KeysetHandle.importKey(key.prfKey).withFixedId(id.value).makePrimary())
        .build()

    /** Changes the last byte of a keyset file, which is part of its tag: the Keystore refuses it. */
    private fun damage(file: File) = file.writeBytes(file.readBytes().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() })
}
