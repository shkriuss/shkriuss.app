package app.shkriuss.core.crypto

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The rules for making, replacing and losing a hardware key
 * (crypto-design.md). A keyset file under a hardware key can be the only
 * way to a user's files, so a mistake, a Keystore that fails for a moment
 * or a stop in the middle must never destroy it.
 */
class HardwareKeyRulesTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val recoveryKey = TestKeys.vectorRecoveryKey()
    private val recordId = "00112233-4455-4677-8899-aabbccddeeff"

    private fun appWithKeys(hardware: SoftwareHardwareKeys = SoftwareHardwareKeys()): TestApp =
        TestApp(temporary.newFolder(), hardware).also {
            assertEquals(KeySetupResult.STORED, it.open().setup.storeDerivedKeys(recoveryKey))
        }

    private fun background(number: Int) = HardwareKeyRef(HardwareKeyKind.BACKGROUND, number)

    private fun unlocked(number: Int) = HardwareKeyRef(HardwareKeyKind.UNLOCKED, number)

    @Test
    fun aliasesAndNumbers() {
        assertEquals("shk.background.1", background(1).alias)
        assertEquals("shk.unlocked.7", unlocked(7).alias)
        assertEquals("shk.lock.3", HardwareKeyRef(HardwareKeyKind.LOCK, 3).alias)
        assertEquals("shk.recovery.12", HardwareKeyRef(HardwareKeyKind.RECOVERY_GUARD, 12).alias)
        HardwareKeyKind.entries.forEach { kind ->
            assertEquals(HardwareKeyRef(kind, 41), HardwareKeyRef.ofAlias(HardwareKeyRef(kind, 41).alias))
        }
        listOf("shk.lock.0", "shk.lock.03", "shk.lock.", "shk.other.1", "lock.1", "shk.lock.1.2", "shk.lock.99999999999")
            .forEach { assertEquals(it, null, HardwareKeyRef.ofAlias(it)) }
    }

    @Test
    fun eachKeysetIsUnderTheKindOfKeyThePageNames() {
        val app = appWithKeys()
        assertEquals(background(1), app.keyOf(KeysetName.RECORD))
        assertEquals(unlocked(1), app.keyOf(KeysetName.BACKUP))
        assertEquals(unlocked(1), app.keyOf(KeysetName.FILE_KEY))
        assertEquals(setOf("shk.background.1", "shk.unlocked.1"), app.hardware.existing())
    }

    @Test
    fun onAndroid13And14TheBackgroundKeyStandsInForTheUnlockedKey() {
        val app = appWithKeys(SoftwareHardwareKeys(unlockedKeyAllowed = false))
        KeysetName.entries.filter { it.text in setOf("record", "backup", "file-key") }.forEach {
            assertEquals(background(1), app.keyOf(it))
        }
        assertEquals(setOf("shk.background.1"), app.hardware.existing())
    }

    @Test
    fun rule1And2AKeystoreThatFailsLosesNothing() {
        val app = appWithKeys()
        val before = app.snapshot()
        val keys = app.hardware.existing()

        app.hardware.keystoreFails = true
        val crypto = app.open()
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.records.seal(recordId, ByteArray(1)) })
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.setup.storeDerivedKeys(recoveryKey) })
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.files.wrap(recordId, crypto.files.newFileKey()) })
        assertEquals("no key was made again", emptyList<HardwareKeyRef>(), app.hardware.made.drop(2))
        assertEquals("no key was deleted", emptyList<HardwareKeyRef>(), app.hardware.deleted)
        assertEquals("no file was changed", before, app.snapshot())
        assertEquals(keys, app.hardware.existing())

        app.hardware.keystoreFails = false
        assertNotNull(app.open().records.seal(recordId, ByteArray(1)))
    }

    @Test
    fun rule1ALockedPhoneIsNotALostKey() {
        val app = appWithKeys()
        val before = app.snapshot()
        app.hardware.phoneLocked = true
        val crypto = app.open()

        // The record keyset works while the phone is locked. The others wait.
        assertNotNull(crypto.records.seal(recordId, ByteArray(1)))
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.backups.keyId() })
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.files.unwrap(recordId, ByteArray(60)) })
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.setup.storeDerivedKeys(recoveryKey) })
        assertEquals(before, app.snapshot())
        assertEquals(emptyList<HardwareKeyRef>(), app.hardware.deleted)
    }

    @Test
    fun rule2ADamagedFileUnderALivingKeyIsNeverWrittenOver() {
        val app = appWithKeys()
        val file = File(app.folder, "record")
        file.writeBytes(file.readBytes().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() })
        val before = app.snapshot()

        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { app.open().setup.storeDerivedKeys(recoveryKey) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { app.open().records.seal(recordId, ByteArray(1)) })
        assertEquals(before, app.snapshot())
    }

    @Test
    fun aLostHardwareKeyIsReplacedByOneWithTheNextNumberAndTheWordsBringItsKeysetsBack() {
        val app = appWithKeys()
        val sealed = app.open().records.seal(recordId, "kept".toByteArray())
        app.hardware.lose(background(1))

        val crypto = app.open()
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.records.open(recordId, sealed) })
        assertTrue("the file says the app had its keys", crypto.status().hasDerivedKeys)

        // The words bring back what the lost key held. The other keysets are left as they are.
        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(recoveryKey))
        assertEquals(listOf("record"), app.store.changes)
        assertEquals(background(2), app.keyOf(KeysetName.RECORD))
        assertEquals("kept", String(app.open().records.open(recordId, sealed)))
    }

    @Test
    fun rule4TheNextNumberCountsAliasesThatExistAndNumbersThatFilesName() {
        val app = appWithKeys()
        app.open()
        // An alias that exists and that no file names.
        app.hardware.put(background(6), ByteArray(32))
        assertEquals(background(7), app.vault.locked { app.vault.newKey(HardwareKeyKind.BACKGROUND) })
        // A number that only a file names: its key is gone.
        app.hardware.lose(unlocked(1))
        assertEquals(unlocked(2), app.vault.locked { app.vault.newKey(HardwareKeyKind.UNLOCKED) })
        // A kind with no key yet starts at 1.
        assertEquals(HardwareKeyRef(HardwareKeyKind.LOCK, 1), app.vault.locked { app.vault.newKey(HardwareKeyKind.LOCK) })
    }

    @Test
    fun rule4AListThatFailsNeverLetsAKeyBeMadeUnderAnAliasThatExists() {
        val app = TestApp(temporary.newFolder())
        app.open()
        // Keys that no file names, and a list that does not show them.
        app.hardware.put(background(1), ByteArray(32))
        app.hardware.put(background(2), ByteArray(32))

        app.hardware.listFails = true
        assertEquals("the exact alias is asked for", background(3), app.vault.locked { app.vault.newKey(HardwareKeyKind.BACKGROUND) })

        app.hardware.listFails = false
        app.hardware.leftOutOfList += listOf("shk.background.3", "shk.background.4")
        app.hardware.put(background(4), ByteArray(32))
        assertEquals("a short list", background(5), app.vault.locked { app.vault.newKey(HardwareKeyKind.BACKGROUND) })
        // The software keys fail the test themselves if a key is made under an alias that exists.
        assertEquals(listOf(background(3), background(5)), app.hardware.made)
    }

    @Test
    fun rule4IfTheKeystoreCannotSayWhetherAnAliasIsFreeNothingIsMade() {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        app.hardware.keystoreFails = true

        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { crypto.setup.storeDerivedKeys(recoveryKey) })
        try {
            app.vault.newKey(HardwareKeyKind.BACKGROUND)
            fail("made a key without knowing that the alias is free")
        } catch (_: HardwareKeyNotUsable) {
            // It stops.
        }
        assertEquals(emptyList<HardwareKeyRef>(), app.hardware.made)
        assertEquals(emptyMap<String, String>(), app.snapshot())
    }

    @Test
    fun rule6ANewBlobUnderAKeyWithoutPromptIsOpenedAgainBeforeItReplacesTheFile() {
        // A hardware key that encrypts something it cannot open again.
        val broken = object : HardwareKeys by SoftwareHardwareKeys() {
            override fun decrypt(key: HardwareKeyRef, ivCiphertextTag: ByteArray, associatedData: ByteArray): ByteArray =
                throw HardwareBlobRefused()
        }
        val folder = temporary.newFolder()
        val vault = KeyVault(TestKeys.water, KeysetFiles(folder), broken)

        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { KeySetup(vault).storeDerivedKeys(recoveryKey) })
        assertEquals("no file was written", emptyList<String>(), folder.list()!!.toList())
    }

    @Test
    fun rule8AtStartKeysThatNoFileNamesAreDeleted() {
        val app = appWithKeys()
        app.hardware.put(background(5), ByteArray(32))
        app.hardware.put(HardwareKeyRef(HardwareKeyKind.LOCK, 2), ByteArray(32))
        app.hardware.put(HardwareKeyRef(HardwareKeyKind.RECOVERY_GUARD, 1), ByteArray(32))

        app.open()

        assertEquals(setOf("shk.background.1", "shk.unlocked.1"), app.hardware.existing())
        assertNotNull(app.open().records.seal(recordId, ByteArray(1)))
    }

    @Test
    fun rule8NothingIsDeletedIfOneKeysetFileCannotBeRead() {
        val app = appWithKeys()
        app.hardware.put(background(5), ByteArray(32))
        val file = File(app.folder, "backup")
        val whole = file.readBytes()

        file.writeBytes(whole.copyOf(4))
        app.open()
        assertTrue("a file whose first bytes are cut", "shk.background.5" in app.hardware.existing())

        file.writeBytes(whole)
        File(app.folder, "unknown").writeBytes(ByteArray(1))
        app.open()
        assertTrue("a file this code does not know", "shk.background.5" in app.hardware.existing())

        File(app.folder, "unknown").delete()
        app.open()
        assertFalse("shk.background.5" in app.hardware.existing())
    }

    @Test
    fun rule8AFailedOrShortListDeletesNothingItDoesNotShow() {
        val app = appWithKeys()
        app.hardware.put(background(5), ByteArray(32))
        app.hardware.put(background(6), ByteArray(32))

        app.hardware.listFails = true
        app.open()
        assertEquals("a failed list deletes nothing", emptyList<HardwareKeyRef>(), app.hardware.deleted)

        app.hardware.listFails = false
        app.hardware.leftOutOfList += "shk.background.6"
        app.open()
        assertEquals("only what the list shows", listOf(background(5)), app.hardware.deleted)

        app.hardware.keystoreFails = true
        app.open()
        assertEquals(listOf(background(5)), app.hardware.deleted)
        // And a list that fails is never proof that a key is gone: everything still opens.
        app.hardware.keystoreFails = false
        app.hardware.listFails = true
        assertNotNull(app.open().records.seal(recordId, ByteArray(1)))
        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(recoveryKey))
        assertEquals(emptyList<String>(), app.store.changes)
    }

    @Test
    fun rule8LeavesKeysOfOtherCodeAlone() {
        val app = appWithKeys()
        // An alias that is not one of this module's cannot even be named by a HardwareKeyRef.
        assertEquals(null, HardwareKeyRef.ofAlias("shk-sync-signing"))
        assertEquals(null, HardwareKeyRef.ofAlias("androidx.something"))
        app.open()
        assertEquals(emptyList<HardwareKeyRef>(), app.hardware.deleted)
    }

    @Test
    fun ifAndroidCannotMakeAKeyNothingIsStored() {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        app.hardware.cannotMake = true
        try {
            crypto.setup.storeDerivedKeys(recoveryKey)
            fail("stored keysets without a hardware key")
        } catch (_: CannotMakeHardwareKeyException) {
            // The app shows the error and makes nothing.
        }
        assertEquals(emptyMap<String, String>(), app.snapshot())
        assertFalse(app.open().status().hasDerivedKeys)
    }

    @Test
    fun theSecurityScreenSeesEveryKeyAndItsLevel() {
        val status = appWithKeys().open().status()
        assertTrue(status.hasDerivedKeys)
        assertEquals(recoveryKey.keyId, status.keyId)
        assertEquals(
            listOf(HardwareKeyKind.BACKGROUND to SecurityLevel.SOFTWARE, HardwareKeyKind.UNLOCKED to SecurityLevel.SOFTWARE),
            status.hardwareKeys.map { it.kind to it.level },
        )
        assertFalse(status.keepsRecoveryKey)
        assertEquals(AppLockState.OFF, status.appLock)
        assertFalse(status.fileKeyMoveIsPending)
    }
}
