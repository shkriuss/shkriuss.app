package app.shkriuss.core.crypto

import app.shkriuss.core.crypto.fixtures.SoftwareHardwareKeys
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Creating, entering, keeping and showing a recovery key ("The recovery
 * key" in crypto-design.md), with the software stand-in for the hardware
 * keys. Calling `finish()` stands for a prompt that succeeded, `cancel()`
 * for one that was cancelled.
 */
@RunWith(RobolectricTestRunner::class)
class KeySetupTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val recordId = "00112233-4455-4677-8899-aabbccddeeff"
    private val guard = HardwareKeyRef(HardwareKeyKind.RECOVERY_GUARD, 1)

    @Test
    fun aNewRecoveryKeyHasAKeyIdThatIsNotZeroAndStoresNothing() {
        val app = TestApp(temporary.newFolder())
        val key = app.open().setup.createRecoveryKey()

        assertTrue(key.keyId.value != 0)
        assertEquals(24, key.words().size)
        assertEquals("nothing is stored before the words are confirmed", emptyMap<String, String>(), app.snapshot())
        assertEquals(emptySet<String>(), app.hardware.existing())
        assertFalse(app.open().setup.createRecoveryKey().sameKeyAs(key))
    }

    @Test
    fun theDerivedKeysetsAreStoredInThePagesOrderAndRecordIsLast() {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        val key = crypto.setup.createRecoveryKey()
        assertFalse(crypto.status().hasDerivedKeys)

        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(key))

        assertEquals(listOf("file-key", "backup", "record"), app.store.changes)
        val status = app.open().status()
        assertTrue(status.hasDerivedKeys)
        assertEquals(key.keyId, status.keyId)
        val expected = TestKeys.derived(key)
        assertTrue(expected.record.equalsKeyset((app.vault.look(KeysetName.RECORD) as Stored.Open).keyset))
        assertTrue(expected.backup.equalsKeyset((app.vault.look(KeysetName.BACKUP) as Stored.Open).keyset))
        assertTrue(expected.fileKey.equalsKeyset((app.vault.look(KeysetName.FILE_KEY) as Stored.Open).keyset))
    }

    @Test
    fun enteredWordsMustBeTheKeyTheAppAlreadyHas() {
        val app = TestApp(temporary.newFolder())
        val key = app.open().setup.createRecoveryKey()
        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(key))
        val before = app.snapshot()

        // The same words, typed again.
        val typed = RecoveryWords.parse(key.words().joinToString(" ")) as RecoveryWordsResult.Accepted
        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(typed.recoveryKey))
        assertEquals(emptyList<String>(), app.store.changes)

        // Other words. The key ID alone is a name, not a proof: the record key is compared.
        val other = app.open().setup.createRecoveryKey()
        assertEquals(KeySetupResult.DIFFERENT_RECOVERY_KEY, app.open().setup.storeDerivedKeys(other))
        assertEquals(before, app.snapshot())
    }

    @Test
    fun noKeysAreDerivedForAppsThatHoldNoDataKeys() {
        val recovery = TestKeys.recoveryKeyset(TestKeys.vectorRecoveryKey())
        listOf("sync", "catalog").forEach { name ->
            try {
                RecoveryKeyDeriver.derive(recovery, AppName.of(name))
                fail("derived keys for $name")
            } catch (_: IllegalArgumentException) {
                // A keeper refuses to derive for them.
            }
        }
        assertFalse(AppName.of("sync").holdsDataKeys)
        assertTrue(AppName.of("water").holdsDataKeys)
    }

    @Test
    fun everyAppGetsItsOwnKeys() {
        val recovery = TestKeys.recoveryKeyset(TestKeys.vectorRecoveryKey())
        val water = RecoveryKeyDeriver.derive(recovery, AppName.of("water"))
        val notes = RecoveryKeyDeriver.derive(recovery, AppName.of("notes"))
        val all = listOf(water.record, water.backup, water.fileKey, notes.record, notes.backup, notes.fileKey)
        assertEquals(6, all.flatMap { TestKeys.keyBytes(it) }.toSet().size)
    }

    @Test
    fun appNames() {
        assertEquals("water", AppName.fromApplicationId("app.shkriuss.water").value)
        assertEquals("a preview has the name of its app", "water", AppName.fromApplicationId("app.shkriuss.water.preview").value)
        listOf("", "Water", "water2", "wa ter", "wa.ter", "wäter").forEach { wrong ->
            try {
                AppName.of(wrong)
                fail("took '$wrong'")
            } catch (_: IllegalArgumentException) {
                // Only the letters a to z.
            }
        }
        try {
            AppName.fromApplicationId("com.example.water")
            fail("took an application ID of another suite")
        } catch (_: IllegalArgumentException) {
            // Not one of ours.
        }
    }

    @Test
    fun anAppWithAScreenLockKeepsTheRecoveryKeyAndCanShowItAgain() {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        val key = crypto.setup.createRecoveryKey()
        crypto.setup.storeDerivedKeys(key)
        assertFalse(crypto.setup.keepsRecoveryKey())

        val keep = crypto.setup.beginKeepRecoveryKey(key)!!
        assertNotNull(keep.cryptoObject.cipher)
        assertFalse("nothing is stored before the prompt succeeds", "recovery" in app.snapshot())
        keep.finish()

        assertEquals(guard, app.keyOf(KeysetName.RECOVERY))
        val later = app.open()
        assertTrue(later.setup.keepsRecoveryKey())
        assertTrue(later.status().keepsRecoveryKey)
        assertNull("it keeps the key already", later.setup.beginKeepRecoveryKey(key))

        // Showing it again: one prompt, one showing.
        val shown = later.setup.beginShowRecoveryKey().finish()
        assertTrue(shown.sameKeyAs(key))
        assertEquals(key.words(), shown.words())
        assertEquals(key.keyId, shown.keyId)
    }

    @Test
    fun ifThePromptIsCancelledTheKeyIsNotKeptAndEverythingElseWorks() {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        val key = crypto.setup.createRecoveryKey()
        crypto.setup.storeDerivedKeys(key)

        crypto.setup.beginKeepRecoveryKey(key)!!.cancel()

        assertFalse(crypto.setup.keepsRecoveryKey())
        assertFalse("recovery" in app.snapshot())
        assertFalse("the unused Recovery guard is deleted", guard.alias in app.hardware.existing())
        assertNotNull(crypto.records.seal(recordId, ByteArray(1)))
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.setup.beginShowRecoveryKey() })
    }

    @Test
    fun aStepServesOnePrompt() {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        val key = crypto.setup.createRecoveryKey()
        crypto.setup.storeDerivedKeys(key)
        val step = crypto.setup.beginKeepRecoveryKey(key)!!
        step.finish()
        listOf({ step.finish() }, { step.cancel() }).forEach { again ->
            try {
                again()
                fail("a step was used twice")
            } catch (_: IllegalStateException) {
                // The next try starts with a new step.
            }
        }
    }

    @Test
    fun ifStoringStopsTheGuardIsLeftForTheNextStartAndTheWordsCanBeEnteredAgain() {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        val key = crypto.setup.createRecoveryKey()
        crypto.setup.storeDerivedKeys(key)
        val step = crypto.setup.beginKeepRecoveryKey(key)!!
        app.store.stopBeforeChange = app.store.changes.size + 1
        try {
            step.finish()
            fail("did not stop")
        } catch (_: Stopped) {
            // The app was killed while it stored the recovery keyset.
        }

        val later = app.open()
        assertFalse(later.setup.keepsRecoveryKey())
        assertEquals("no key is left that no file names", setOf("shk.background.1", "shk.unlocked.1"), app.hardware.existing())
        later.setup.beginKeepRecoveryKey(key)!!.finish()
        assertTrue(app.open().setup.beginShowRecoveryKey().finish().sameKeyAs(key))
    }

    @Test
    fun onAPhoneWithNoScreenLockTheKeyIsNotKeptAndEverythingElseWorks() {
        val app = TestApp(temporary.newFolder(), SoftwareHardwareKeys().apply { screenLock = false })
        val crypto = app.open()
        val key = crypto.setup.createRecoveryKey()

        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(key))
        assertNull(crypto.setup.beginKeepRecoveryKey(key))

        val status = app.open().status()
        assertTrue(status.hasDerivedKeys)
        assertFalse(status.hasScreenLock)
        assertFalse(status.keepsRecoveryKey)
        assertFalse(app.open().appLock.canTurnOn())
        assertNotNull(app.open().records.seal(recordId, ByteArray(1)))
        assertTrue(app.open().backups.mayMakeBackup())
    }

    @Test
    fun removingTheScreenLockDeletesTheKeptCopyAndTheWordsBringItBack() {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        val key = crypto.setup.createRecoveryKey()
        crypto.setup.storeDerivedKeys(key)
        crypto.setup.beginKeepRecoveryKey(key)!!.finish()
        val sealed = crypto.records.seal(recordId, "kept".toByteArray())

        app.hardware.removeScreenLock()
        val without = app.open()
        assertFalse(without.setup.keepsRecoveryKey())
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { without.setup.beginShowRecoveryKey() })
        // Files, sync and backup go on.
        assertEquals("kept", String(without.records.open(recordId, sealed)))
        assertNull(without.setup.beginKeepRecoveryKey(key))

        // To keep it again: set a screen lock and enter the words in one app.
        app.hardware.screenLock = true
        val again = app.open()
        assertEquals(KeySetupResult.STORED, again.setup.storeDerivedKeys(key))
        again.setup.beginKeepRecoveryKey(key)!!.finish()
        assertTrue(app.open().setup.beginShowRecoveryKey().finish().sameKeyAs(key))
        assertEquals(1, app.hardware.existing().count { it.startsWith("shk.recovery.") })
    }

    @Test
    fun theKeptRecoveryKeyOpensOnlyWithItsOwnGuard() {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        val key = crypto.setup.createRecoveryKey()
        crypto.setup.storeDerivedKeys(key)
        crypto.setup.beginKeepRecoveryKey(key)!!.finish()
        // Another key under the same alias: the blob is refused.
        app.hardware.put(guard, ByteArray(32) { 1 })

        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { app.open().setup.beginShowRecoveryKey().finish() })
    }
}
