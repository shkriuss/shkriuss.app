package app.shkriuss.core.crypto

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * A keyset with two recovery keys: both open old blobs, the primary seals
 * (item 6 of "What the tests must cover" in crypto-design.md). The "new
 * recovery key" flow itself comes with the sync design. What it needs is
 * here: keysets that hold several keys, and blobs that name their key ID.
 */
class TwoRecoveryKeysTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val recordId = "00112233-4455-4677-8899-aabbccddeeff"
    private val fileId = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"
    private val backupHeader = "the backup header".toByteArray()

    private val oldKey = TestKeys.vectorRecoveryKey()
    private val newKey = RecoveryKey.ofBytes(ByteArray(32) { (0xa0 + it).toByte() })
    private val both = RecoveryKeyDeriver.recoveryKeyset(listOf(oldKey, newKey), primary = newKey)

    @Test
    fun theRecoveryKeysetHoldsBothKeysUnderTheirKeyIds() {
        assertEquals(setOf(oldKey.keyId, newKey.keyId), KeysetCodec.keyIds(both).toSet())
        assertEquals(newKey.keyId, KeysetCodec.primaryId(both))

        val again = KeysetCodec.parse(KeysetCodec.serialize(both), KeysetType.RECOVERY)
        val keys = RecoveryKeyDeriver.recoveryKeys(again)
        assertTrue(keys[0].sameKeyAs(newKey))
        assertTrue(keys[1].sameKeyAs(oldKey))
    }

    @Test
    fun everyDerivedKeysetGetsOneKeyPerRecoveryKey() {
        val derived = RecoveryKeyDeriver.derive(both, TestKeys.water)
        val old = TestKeys.derived(oldKey)
        val new = TestKeys.derived(newKey)
        listOf(
            Triple(derived.record, old.record, new.record),
            Triple(derived.backup, old.backup, new.backup),
            Triple(derived.fileKey, old.fileKey, new.fileKey),
        ).forEach { (two, fromOld, fromNew) ->
            assertEquals(TestKeys.keyBytes(fromOld) + TestKeys.keyBytes(fromNew), TestKeys.keyBytes(two))
            assertEquals(listOf(oldKey.keyId, newKey.keyId), KeysetCodec.keyIds(two))
            assertEquals(newKey.keyId, KeysetCodec.primaryId(two))
        }
    }

    @Test
    fun bothOpenOldBlobsAndThePrimarySeals() {
        // Blobs made while the app had only the old recovery key.
        val before = TestApp(temporary.newFolder())
        assertEquals(KeySetupResult.STORED, before.open().setup.storeDerivedKeys(oldKey))
        val oldCrypto = before.open()
        val oldRecord = oldCrypto.records.seal(recordId, "an old record".toByteArray())
        val fileKey = oldCrypto.files.newFileKey()
        val oldWrapped = oldCrypto.files.wrap(fileId, fileKey)
        val oldBackup = ByteArrayOutputStream()
        oldCrypto.backups.encryptingStream(backupHeader, oldBackup).use { it.write("an old backup".toByteArray()) }

        // An app whose keysets hold both keys, with the new one as the primary.
        val after = TestApp(temporary.newFolder())
        after.open()
        assertEquals(KeySetupResult.STORED, after.vault.locked { KeySetup(after.vault).storeDerived(both) })
        val crypto = after.open()

        assertEquals("an old record", String(crypto.records.open(recordId, oldRecord)))
        assertEquals("an old backup", String(crypto.backups.decryptingStream(backupHeader, ByteArrayInputStream(oldBackup.toByteArray())).readBytes()))
        val file = TestKeys.encryptFile(fileKey, fileId, "a file".toByteArray())
        assertEquals("a file", String(TestKeys.decryptFile(crypto.files.unwrap(fileId, oldWrapped), fileId, file)))

        // New blobs name the new key.
        val newRecord = crypto.records.seal(recordId, "a new record".toByteArray())
        val newWrapped = crypto.files.wrap(fileId, fileKey)
        assertEquals(newKey.keyId, SealedBlobs.keyIdOf(BlobKind.SEALED_RECORD, newRecord))
        assertEquals(newKey.keyId, SealedBlobs.keyIdOf(BlobKind.WRAPPED_FILE_KEY, newWrapped))
        assertEquals(newKey.keyId, crypto.backups.keyId())
        assertTrue(crypto.backups.hasKey(oldKey.keyId))
        assertEquals(newKey.keyId, crypto.status().keyId)
        assertArrayEquals("a new record".toByteArray(), crypto.records.open(recordId, newRecord))

        // An old wrapped file key is not sealed by the current key. Sealing it again moves it to the new one.
        assertTrue(!crypto.files.isSealedByCurrentKey(oldWrapped))
        assertTrue(crypto.files.isSealedByCurrentKey(crypto.files.sealAgain(fileId, oldWrapped)))

        // The app with only the old key cannot open what the new key sealed, and says which key it needs.
        try {
            oldCrypto.records.open(recordId, newRecord)
            fail("opened a record sealed by a key the app does not have")
        } catch (refused: BlobException) {
            assertEquals(BlobAnswer.NEEDS_ANOTHER_RECOVERY_KEY, refused.answer)
            assertEquals(newKey.keyId, refused.keyId)
        }
    }

    @Test
    fun enteredWordsAreTheCurrentKeyAnOlderKeyOrADifferentKey() {
        val app = TestApp(temporary.newFolder())
        app.open()
        assertEquals(KeySetupResult.STORED, app.vault.locked { KeySetup(app.vault).storeDerived(both) })
        val before = app.snapshot()

        assertEquals(KeySetupResult.STORED, app.open().setup.storeDerivedKeys(newKey))
        assertEquals(KeySetupResult.OLDER_RECOVERY_KEY, app.open().setup.storeDerivedKeys(oldKey))
        assertEquals(
            KeySetupResult.DIFFERENT_RECOVERY_KEY,
            app.open().setup.storeDerivedKeys(RecoveryKey.ofBytes(ByteArray(32) { 9 })),
        )
        assertEquals("nothing was stored", before, app.snapshot())
    }
}
