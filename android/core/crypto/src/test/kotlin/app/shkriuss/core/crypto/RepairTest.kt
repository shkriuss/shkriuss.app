package app.shkriuss.core.crypto

import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * A damaged keyset file (item 11 of "What the tests must cover" in
 * crypto-design.md): repaired with recovery words that another keyset
 * proves, or given up when no words can bring it back. A damaged file is
 * always copied to the set-aside folder first, and never deleted.
 */
class RepairTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val recoveryKey = TestKeys.vectorRecoveryKey()
    private val other = RecoveryKey.ofBytes(ByteArray(32) { (it + 100).toByte() })
    private val recordId = "00112233-4455-4677-8899-aabbccddeeff"
    private val fileId = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"
    private val randomFileId = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e000"

    /** An app with its keys from [recoveryKey], one sealed record and one file. */
    private class Fixture(val app: TestApp, val record: ByteArray, val file: ByteArray, val wrapped: ByteArray)

    private fun appWithKeys(keep: Boolean = false): Fixture {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(recoveryKey))
        if (keep) crypto.setup.beginKeepRecoveryKey(recoveryKey)!!.finish()
        val key = crypto.files.newFileKey()
        return Fixture(
            app,
            record = crypto.records.seal(recordId, "a record".toByteArray()),
            file = TestKeys.encryptFile(key, fileId, "a file".toByteArray()),
            wrapped = crypto.files.wrap(fileId, key),
        )
    }

    private fun assertEverythingWorks(crypto: ShkCrypto, fixture: Fixture) {
        assertEquals("a record", String(crypto.records.open(recordId, fixture.record)))
        val key = crypto.files.unwrap(fileId, fixture.wrapped)
        assertArrayEquals("a file".toByteArray(), TestKeys.decryptFile(key, fileId, fixture.file))
        assertTrue(crypto.backups.mayMakeBackup())
    }

    /** Changes the last byte of a keyset file, which is part of its tag: the Keystore refuses it. */
    private fun damage(file: File): ByteArray {
        file.writeBytes(file.readBytes().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() })
        return file.readBytes()
    }

    private fun setAside(app: TestApp): Map<String, String> =
        app.setAsideFolder.listFiles().orEmpty().sortedBy { it.name }.associate { it.name to it.readBytes().toHex() }

    @Test
    fun theProvenWordsRepairADamagedRecordBackupOrFileKey() {
        listOf("record", "backup", "file-key").forEach { name ->
            val fixture = appWithKeys()
            val app = fixture.app
            val damaged = damage(File(app.folder, name))
            val status = app.open().status()
            assertTrue(name, status.needsRepair)
            assertFalse(name, status.filesCanBeGivenUp)

            assertEquals(name, KeySetupResult.STORED, app.open().setup.storeDerivedKeys(recoveryKey))

            assertEquals(name, listOf("~$name", name), app.store.changes)
            assertArrayEquals(name, damaged, File(app.setAsideFolder, "$name-1").readBytes())
            assertFalse(name, app.open().status().needsRepair)
            assertEverythingWorks(app.open(), fixture)
        }
    }

    @Test
    fun aStopAfterTheCopyLeavesTheDamagedFileInPlaceAndTheRetryCopiesNothingTwice() {
        val fixture = appWithKeys()
        val app = fixture.app
        val damaged = damage(File(app.folder, "record"))
        val crypto = app.open()
        app.store.stopBeforeChange = 2
        try {
            crypto.setup.storeDerivedKeys(recoveryKey)
            fail("did not stop")
        } catch (_: Stopped) {
            // The copy was made. The keyset was not written yet.
        }
        assertArrayEquals("no keyset file is ever missing", damaged, File(app.folder, "record").readBytes())
        assertTrue(app.open().status().hasDerivedKeys)
        assertFalse("a damaged record is no unfinished setup", app.open().status().setupIsUnfinished)

        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(recoveryKey))
        assertEquals(setOf("record-1"), setAside(app).keys)
        assertEverythingWorks(app.open(), fixture)
    }

    @Test
    fun aSetAsideFileIsNeverWrittenOver() {
        val fixture = appWithKeys()
        val app = fixture.app
        val first = damage(File(app.folder, "record"))
        app.open().setup.storeDerivedKeys(recoveryKey)
        val second = damage(File(app.folder, "record"))
        app.open().setup.storeDerivedKeys(recoveryKey)

        assertEquals(setOf("record-1", "record-2"), setAside(app).keys)
        assertArrayEquals(first, File(app.setAsideFolder, "record-1").readBytes())
        assertArrayEquals(second, File(app.setAsideFolder, "record-2").readBytes())
    }

    @Test
    fun withoutProofOrWithOtherWordsNothingIsSetAsideAndNothingIsWritten() {
        val proof = appWithKeys().app
        listOf("record", "backup", "file-key").forEach { damage(File(proof.folder, it)) }
        val before = proof.snapshot()
        assertFalse("nothing could prove the words", proof.open().status().needsRepair)
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { proof.open().setup.storeDerivedKeys(recoveryKey) })
        assertEquals(before, proof.snapshot())
        assertEquals(emptyMap<String, String>(), setAside(proof))

        val words = appWithKeys().app
        damage(File(words.folder, "record"))
        val unchanged = words.snapshot()
        assertEquals(KeySetupResult.DIFFERENT_RECOVERY_KEY, words.open().setup.storeDerivedKeys(other))
        assertEquals(unchanged, words.snapshot())
        assertEquals(emptyMap<String, String>(), setAside(words))
    }

    @Test
    fun aProofThatHoldsMoreKeysThanTheWordsDeriveIsRefused() {
        val app = TestApp(temporary.newFolder())
        app.open()
        val both = RecoveryKeyDeriver.recoveryKeyset(listOf(other, recoveryKey), recoveryKey)
        assertEquals(KeySetupResult.STORED, app.vault.locked { KeySetup(app.vault).storeDerived(both) })
        damage(File(app.folder, "record"))
        val before = app.snapshot()

        // Storing only the keys of the current words would lose those of the older key.
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { app.open().setup.storeDerivedKeys(recoveryKey) })
        assertEquals(before, app.snapshot())
    }

    @Test
    fun aSetAsideFileStopsNoStartUpCleaningAndNamesNoKey() {
        val fixture = appWithKeys(keep = true)
        val app = fixture.app
        val oldGuard = app.keyOf(KeysetName.RECOVERY)!!
        // A header that cannot be read: start-up cleaning stops while this file is in shk-keys/.
        File(app.folder, "recovery").let { it.writeBytes(it.readBytes().also { bytes -> bytes[0] = 0 }) }
        val stray = HardwareKeyRef(HardwareKeyKind.LOCK, 9)
        app.hardware.put(stray, ByteArray(32) { 3 })
        app.open()
        assertTrue("cleaning waits while a header cannot be read", stray.alias in app.hardware.existing())

        val crypto = app.open()
        assertTrue(crypto.status().needsRepair)
        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(recoveryKey))
        crypto.setup.beginKeepRecoveryKey(recoveryKey)!!.finish()
        assertEquals(listOf("~recovery", "recovery"), app.store.changes)

        app.open()
        assertFalse("cleaning ran again", stray.alias in app.hardware.existing())
        assertFalse("the guard of the set-aside file is deleted like any key no file names", oldGuard.alias in app.hardware.existing())
        assertEquals(setOf("recovery-1"), setAside(app).keys)
        assertTrue(app.open().setup.beginShowRecoveryKey().finish().sameKeyAs(recoveryKey))
    }

    @Test
    fun aDamagedFileKeyOldIsLeftAsItIsWhileTheOthersAreRepaired() {
        val app = TestApp(temporary.newFolder())
        val randomKey = app.open().files.newFileKey()
        val randomWrapped = app.open().files.wrap(randomFileId, randomKey)
        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(recoveryKey))
        val key = app.open().files.newFileKey()
        val wrapped = app.open().files.wrap(fileId, key)
        val old = damage(File(app.folder, "file-key-old"))
        damage(File(app.folder, "record"))

        val crypto = app.open()
        assertTrue(crypto.status().filesCanBeGivenUp)
        assertNotNull("files that file-key sealed still open", crypto.files.unwrap(fileId, wrapped))
        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(recoveryKey))

        assertEquals(listOf("~record", "record"), app.store.changes)
        assertArrayEquals(old, File(app.folder, "file-key-old").readBytes())
        val after = app.open()
        assertNotNull(after.files.unwrap(fileId, wrapped))
        assertEquals(BlobAnswer.NEEDS_ANOTHER_RECOVERY_KEY, TestKeys.answerOf { after.files.unwrap(randomFileId, randomWrapped) })
        assertFalse(after.backups.mayMakeBackup())
    }

    @Test
    fun aKeptRecoveryKeyThatAPromptFoundDamagedIsReplacedWithTheWords() {
        val fixture = appWithKeys(keep = true)
        val app = fixture.app
        val oldGuard = app.keyOf(KeysetName.RECOVERY)!!
        val damaged = damage(File(app.folder, "recovery"))
        val crypto = app.open()
        assertFalse("look() cannot see it without a prompt", crypto.status().needsRepair)
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { crypto.setup.beginShowRecoveryKey().finish() })
        assertTrue("the prompt found it", crypto.status().needsRepair)

        // The words are entered again. The keyset that is kept is replaced.
        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(recoveryKey))
        crypto.setup.beginKeepRecoveryKey(recoveryKey)!!.finish()

        assertEquals(listOf("~recovery", "recovery"), app.store.changes)
        assertArrayEquals(damaged, File(app.setAsideFolder, "recovery-1").readBytes())
        assertFalse(oldGuard.alias in app.hardware.existing())
        assertTrue(app.open().setup.beginShowRecoveryKey().finish().sameKeyAs(recoveryKey))
        assertFalse(app.open().status().needsRepair)
    }

    @Test
    fun aKeptRecoveryKeyChangedBetweenTheStartAndTheEndOfTheStepIsNotReplaced() {
        val app = appWithKeys(keep = true).app
        damage(File(app.folder, "recovery"))
        File(app.folder, "recovery").let { it.writeBytes(it.readBytes().also { bytes -> bytes[0] = 0 }) }
        val crypto = app.open()
        val step = crypto.setup.beginKeepRecoveryKey(recoveryKey)!!
        damage(File(app.folder, "recovery"))
        val changed = app.snapshot()

        try {
            step.finish()
            fail("replaced a file that was changed after it was judged")
        } catch (_: IllegalStateException) {
            // Nothing is set aside or written. The new guard is deleted.
        }
        assertEquals(changed, app.snapshot())
        assertEquals(emptyMap<String, String>(), setAside(app))
        assertEquals(1, app.hardware.existing().count { it.startsWith("shk.recovery.") })
    }

    @Test
    fun keepingARecoveryKeyNeedsTheKeysOfThatKey() {
        val fresh = TestApp(temporary.newFolder())
        listOf(fresh.open(), appWithKeys().app.open()).forEach { crypto ->
            try {
                crypto.setup.beginKeepRecoveryKey(other)
                fail("kept a recovery key the app has no keys from")
            } catch (_: IllegalArgumentException) {
                // Showing it again would show the wrong words.
            }
        }
        assertEquals(emptySet<String>(), fresh.hardware.existing())
    }

    @Test
    fun aFileKeyUnderTheAppLockThatAPromptFoundDamagedIsStoredAgainAndTheAppLockIsOff() {
        val fixture = appWithKeys()
        val app = fixture.app
        app.open().appLock.beginTurnOn(WordsProof(recoveryKey.keyId)).finish()
        val lockKey = app.keyOf(KeysetName.FILE_KEY)!!
        assertEquals(HardwareKeyKind.LOCK, lockKey.kind)
        val damaged = damage(File(app.folder, "file-key"))

        // Another run, without the prompt's finding: the words change nothing.
        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(recoveryKey))
        assertEquals(emptyList<String>(), app.store.changes)

        val crypto = app.open()
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { crypto.appLock.beginUnlock().finish() })
        assertTrue(crypto.status().needsRepair)
        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(recoveryKey))

        assertEquals(listOf("~file-key", "file-key"), app.store.changes)
        assertArrayEquals(damaged, File(app.setAsideFolder, "file-key-1").readBytes())
        assertEquals(HardwareKeyKind.UNLOCKED, app.keyOf(KeysetName.FILE_KEY)?.kind)
        assertFalse("the Lock key is deleted", lockKey.alias in app.hardware.existing())
        val after = app.open()
        assertEquals(AppLockState.OFF, after.appLock.state())
        assertEverythingWorks(after, fixture)
    }

    @Test
    fun aDamagedFileKeyOldCanBeGivenUpButNeverOneThatOpens() {
        val app = TestApp(temporary.newFolder())
        val randomWrapped = app.open().files.wrap(randomFileId, app.open().files.newFileKey())
        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(recoveryKey))
        val wrapped = app.open().files.wrap(fileId, app.open().files.newFileKey())
        assertFalse(app.open().status().filesCanBeGivenUp)
        try {
            app.open().setup.giveUpDamagedFileKeys()
            fail("gave up a keyset that opens")
        } catch (_: IllegalStateException) {
            // The move is only unfinished. Its keys are kept.
        }
        assertNotNull(app.open().files.unwrap(randomFileId, randomWrapped))

        val damaged = damage(File(app.folder, "file-key-old"))
        val crypto = app.open()
        assertTrue(crypto.status().filesCanBeGivenUp)
        crypto.setup.giveUpDamagedFileKeys()

        assertEquals(listOf("~file-key-old", "-file-key-old"), app.store.changes)
        assertArrayEquals(damaged, File(app.setAsideFolder, "file-key-old-1").readBytes())
        val after = app.open()
        assertFalse(after.status().filesCanBeGivenUp)
        assertTrue(after.backups.mayMakeBackup())
        assertTrue(after.appLock.canTurnOn())
        assertNotNull(after.files.unwrap(fileId, wrapped))
    }

    @Test
    fun aDamagedRandomFileKeyCanBeGivenUpAndTheAppCanThenBeSetUp() {
        val app = TestApp(temporary.newFolder())
        app.open().files.wrap(randomFileId, app.open().files.newFileKey())
        val damaged = damage(File(app.folder, "file-key"))
        val stuck = app.open()
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { stuck.setup.storeDerivedKeys(recoveryKey) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { stuck.files.wrap(fileId, stuck.files.newFileKey()) })
        assertTrue(stuck.status().filesCanBeGivenUp)
        assertFalse("no words can bring a random key back", stuck.status().needsRepair)

        stuck.setup.giveUpDamagedFileKeys()

        assertEquals(listOf("~file-key", "-file-key"), app.store.changes)
        assertArrayEquals(damaged, File(app.setAsideFolder, "file-key-1").readBytes())
        assertNotNull("a new file gets a new random key", app.open().files.wrap(fileId, app.open().files.newFileKey()))
        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(recoveryKey))
    }

    @Test
    fun aDamagedFileKeyOfAnUnfinishedSetupIsRepairedByItsWordsOrGivenUp() {
        listOf(true, false).forEach { withWords ->
            val app = TestApp(temporary.newFolder())
            val crypto = app.open()
            app.store.stopBeforeChange = 3
            try {
                crypto.setup.storeDerivedKeys(recoveryKey)
                fail("did not stop")
            } catch (_: Stopped) {
                // file-key and backup were stored, record was not.
            }
            damage(File(app.folder, "file-key"))
            val status = app.open().status()
            assertTrue(status.setupIsUnfinished)
            assertTrue("backup can prove the words", status.needsRepair)
            assertTrue(status.filesCanBeGivenUp)
            assertEquals(StartOverResult.FILE_KEYS_DAMAGED, app.open().setup.startOver(other))

            if (withWords) {
                assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(recoveryKey))
                assertEquals(listOf("~file-key", "file-key", "record"), app.store.changes)
            } else {
                app.open().setup.giveUpDamagedFileKeys()
                assertEquals(StartOverResult.STORED, app.open().setup.startOver(other))
                assertEquals(other.keyId, app.open().status().keyId)
            }
            assertNull(app.keyOf(KeysetName.FILE_KEY_OLD))
            assertTrue(app.open().status().hasDerivedKeys)
        }
    }

    @Test
    fun aDamagedFileKeyOfAFinishedSetupIsNeverGivenUp() {
        val app = appWithKeys().app
        damage(File(app.folder, "file-key"))
        val status = app.open().status()
        assertFalse(status.filesCanBeGivenUp)
        assertTrue("the words repair it", status.needsRepair)
        try {
            app.open().setup.giveUpDamagedFileKeys()
            fail("gave up the file-key of a finished setup")
        } catch (_: IllegalStateException) {
            // The app could never make a file-key again.
        }
        assertNotNull(File(app.folder, "file-key").takeIf { it.isFile })
    }
}
