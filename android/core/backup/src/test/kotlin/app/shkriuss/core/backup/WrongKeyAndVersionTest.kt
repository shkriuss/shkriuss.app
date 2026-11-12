package app.shkriuss.core.backup

import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * A backup made with another recovery key, a backup an app has no keys
 * for, and a backup from a newer version (items 4 and 5 of "What the
 * tests must cover" in backup-format.md).
 */
class WrongKeyAndVersionTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private fun deviceWithKeys(dataVersion: Int = 1): Device = Device(temporary, dataVersion).also { it.giveKeys() }

    @Test
    fun aBackupMadeWithAnotherRecoveryKeyNamesTheKeyItNeeds() {
        val maker = deviceWithKeys()
        maker.app.add(record(1))
        val file = maker.backup()
        val other = deviceWithKeys()
        val neededKey = maker.keys.crypto.backups.keyId()
        assertNotEquals(neededKey, other.keys.crypto.backups.keyId())

        assertEquals(BackupAnswer.OtherRecoveryKey(neededKey), other.answerOf(file))
    }

    @Test
    fun aKeyIdIsANameAndNotAProof() {
        val maker = deviceWithKeys()
        val other = deviceWithKeys()
        val file = maker.backup()
        // The header now names a key the other app has. The stream was still made with the first key.
        other.keys.crypto.backups.keyId().toBytes().copyInto(file, destinationOffset = KEY_ID_AT)

        assertEquals(BackupAnswer.Damaged, other.answerOf(file))
    }

    @Test
    fun anAppWithNoKeysYetSaysSo() {
        val file = deviceWithKeys().backup()
        val noKeys = Device(temporary)

        assertEquals(BackupAnswer.NoKeysNow, noKeys.answerOf(file))
    }

    @Test
    fun aLockedPhoneCannotReadOrWriteABackup() {
        val device = deviceWithKeys()
        val file = device.backup()
        val openedBefore = device.documentsOpened
        device.keys.phoneLocked = true

        assertEquals(BackupAnswer.NoKeysNow, device.answerOf(file))
        assertEquals(ExportResult.NoKeysNow, device.write().first)
        assertEquals("nothing is written", openedBefore, device.documentsOpened)

        device.keys.phoneLocked = false
        assertTrue(device.restore(file) is RestoreResult.Restored)
    }

    @Test
    fun aBackupOfAnotherAppNamesThatApp() {
        val device = deviceWithKeys()
        val file = device.backup()
        // "water" becomes "notes": same length, another app. The stream would not open for it anyway.
        "notes".toByteArray(Charsets.US_ASCII).copyInto(file, destinationOffset = NAME_AT)

        assertEquals(BackupAnswer.OtherApp("notes"), device.answerOf(file))
    }

    @Test
    fun aHigherFormatVersionIsRefusedBeforeAnyKeyIsLookedAt() {
        val file = deviceWithKeys().backup()
        file[VERSION_AT] = 2

        assertEquals(BackupAnswer.NewerVersion, deviceWithKeys().answerOf(file))
        assertEquals(BackupAnswer.NewerVersion, Device(temporary).answerOf(file))
    }

    @Test
    fun aHigherVersionOfTheStreamIsANewerVersion() {
        val device = deviceWithKeys()
        val file = device.backup()
        file[STREAM_VERSION_AT] = 2

        assertEquals(BackupAnswer.NewerVersion, device.answerOf(file))
    }

    @Test
    fun aHigherDataVersionIsANewerVersion() {
        val newer = Device(temporary, dataVersion = 5)
        val recoveryKey = newer.giveKeys()
        newer.app.add(record(1))
        val file = newer.backup()
        val older = Device(temporary, dataVersion = 4)
        older.giveKeys(recoveryKey)

        assertEquals(BackupAnswer.NewerVersion, older.answerOf(file))
    }

    @Test
    fun aHigherDataVersionIsRefusedRightAfterTheManifestBeforeAnythingIsPutAside() {
        val newer = Device(temporary, dataVersion = 5)
        val recoveryKey = newer.giveKeys()
        newer.app.add(record(1, type = "file"))
        newer.app.putFile(1, pattern(2_500_000))
        val file = newer.backup()
        val older = Device(temporary, dataVersion = 4)
        older.giveKeys(recoveryKey)
        // Two traps that a reader who went on would fall into. The staging folder cannot be made: a file
        // stands in its place. And the document fails a little after its first segment, of three.
        val engine = BackupEngine(older.keys.crypto.backups, WATER, older.app, BackupStaging(temporary.newFile()), older.clock)
        val afterTheFirstSegment = 1_200_000
        val failure = IOException("The reader went on after the Manifest")

        val checked = runBlocking { engine.check(FailingInput(file, afterTheFirstSegment, failure)) }
        val restored = runBlocking { engine.restore(FailingInput(file, afterTheFirstSegment, failure)) }

        assertTrue("the backup has three segments", file.size > 2 * 1_048_576)
        assertEquals(CheckResult.Refused(BackupAnswer.NewerVersion), checked)
        assertEquals(RestoreResult.Refused(BackupAnswer.NewerVersion), restored)
        assertEquals(0, older.app.restores)
    }

    @Test
    fun aNewerBackupIsANewerVersionEvenWhenItsLaterPartIsDamaged() {
        val newer = Device(temporary, dataVersion = 5)
        val recoveryKey = newer.giveKeys()
        newer.app.add(record(1, type = "file"))
        newer.app.putFile(1, pattern(2_500_000))
        val file = newer.backup()
        val older = Device(temporary, dataVersion = 4)
        older.giveKeys(recoveryKey)
        val changedAtTheEnd = file.copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 0x01).toByte() }
        val changedInTheFirstSegment = file.copyOf().also { it[100] = (it[100].toInt() xor 0x01).toByte() }

        // The reader stops at the Manifest, so it never reaches the damage at the end.
        assertEquals(BackupAnswer.NewerVersion, older.answerOf(changedAtTheEnd))
        assertEquals(BackupAnswer.NewerVersion, older.answerOf(file.copyOf(file.size - 100)))
        // The Manifest is released only after the tag of its segment was checked.
        assertEquals(BackupAnswer.Damaged, older.answerOf(changedInTheFirstSegment))
    }

    @Test
    fun anOlderDataVersionReachesTheAppWhichMustReadIt() {
        val older = Device(temporary, dataVersion = 3)
        val recoveryKey = older.giveKeys()
        older.app.add(record(1))
        val file = older.backup()
        val newer = Device(temporary, dataVersion = 5)
        newer.giveKeys(recoveryKey)

        val result = newer.restore(file)

        assertEquals(RestoreResult.Restored(BackupSummary(3, older.clock.nowMillis, records = 1, files = 0)), result)
        assertEquals(3, newer.app.restoredDataVersion)
        assertEquals(older.app.snapshot(), newer.app.snapshot())
    }

    private companion object {
        const val VERSION_AT = 6
        const val KEY_ID_AT = 7
        const val NAME_AT = 12

        /** The version byte of blob kind 3: after the 17 bytes of the backup header and the letters SHK. */
        const val STREAM_VERSION_AT = 17 + 3
    }
}
