package app.shkriuss.core.crypto

import android.os.Bundle
import app.shkriuss.core.crypto.fixtures.SoftwareHardwareKeys
import com.google.crypto.tink.KeysetHandle
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
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * The handover between apps (item 14 of "What the tests must cover" in
 * crypto-design.md, ADR 0041): a keeper makes another app's keysets from
 * the recovery key it keeps, they travel in a bundle, and the asking app
 * stores them as it stores the keysets of entered words.
 */
@RunWith(RobolectricTestRunner::class)
class HandoverTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val key = TestKeys.vectorRecoveryKey()
    private val words = key.words()
    private val otherKey = RecoveryKey.ofBytes(ByteArray(32) { 0x77 })
    private val reminders = AppName.of("reminders")
    private val fileId = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"

    /** Water, which keeps [kept]. */
    private fun keeper(kept: RecoveryKey = key): TestApp {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        assertEquals(KeySetupResult.STORED, crypto.setup.storeDerivedKeys(kept))
        crypto.setup.beginKeepRecoveryKey(kept)!!.finish()
        return app
    }

    /** Reminders, with its own hardware keys. */
    private fun asker(hardware: SoftwareHardwareKeys = SoftwareHardwareKeys()): TestApp =
        TestApp(temporary.newFolder(), hardware, reminders)

    /** What the keeper hands over to Reminders, after one prompt. */
    private fun handOver(keeper: TestApp): HandedOverKeys = keeper.open().setup.beginHandOver(reminders).finish()

    /** The keys as the asking app reads them from the result: through a bundle. */
    private fun throughABundle(keys: HandedOverKeys): HandedOverKeys =
        HandedOverKeys.readFrom(Bundle().also { keys.writeTo(it) })

    private fun keysetOf(app: TestApp, name: KeysetName): KeysetHandle = (app.vault.look(name) as Stored.Open).keyset

    private fun damage(file: File) = file.writeBytes(file.readBytes().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() })

    @Test
    fun theAskingAppGetsExactlyTheKeysItsWordsWouldGiveIt() {
        val asker = asker()
        val result = asker.open().setup.storeHandedOverKeys(throughABundle(handOver(keeper())))
        assertEquals(KeySetupResult.STORED, result)

        val byWords = RecoveryKeyDeriver.derive(TestKeys.recoveryKeyset(key), reminders)
        assertTrue(KeysetCodec.sameKeys(keysetOf(asker, KeysetName.RECORD), byWords.record))
        assertTrue(KeysetCodec.sameKeys(keysetOf(asker, KeysetName.BACKUP), byWords.backup))
        assertTrue(KeysetCodec.sameKeys(keysetOf(asker, KeysetName.FILE_KEY), byWords.fileKey))
        val water = TestKeys.derived(key)
        assertFalse("its own keys, not the keeper's", KeysetCodec.sameKeys(keysetOf(asker, KeysetName.RECORD), water.record))

        val status = asker.open().status()
        assertTrue(status.hasDerivedKeys)
        assertEquals(key.keyId, status.keyId)
        assertFalse("the asking app is not a keeper", status.keepsRecoveryKey)
        assertEquals(KeySetupResult.STORED, asker.open().setup.storeDerivedKeys(key))
        assertTrue("the words still fit", asker.store.changes.isEmpty())
    }

    @Test
    fun theKeysAreStoredUnderTheUsualHardwareKeysAndInTheUsualOrder() {
        val asker = asker()
        val crypto = asker.open()
        crypto.files.wrap(fileId, crypto.files.newFileKey())
        val opened = asker.open()
        opened.setup.storeHandedOverKeys(handOver(keeper()))

        assertEquals(listOf("file-key-old", "file-key", "backup", "record"), asker.store.changes)
        assertEquals(HardwareKeyKind.BACKGROUND, asker.keyOf(KeysetName.RECORD)!!.kind)
        assertEquals(HardwareKeyKind.UNLOCKED, asker.keyOf(KeysetName.BACKUP)!!.kind)
        assertEquals(HardwareKeyKind.UNLOCKED, asker.keyOf(KeysetName.FILE_KEY)!!.kind)
        assertTrue("files added before go through the move", asker.open().setup.fileKeyMoveIsPending())
    }

    @Test
    fun theHandoverNeedsThePromptOfTheRecoveryGuardAndACancelChangesNothing() {
        val keeper = keeper()
        val before = keeper.snapshot()
        val step = keeper.open().setup.beginHandOver(reminders)
        assertNotNull(step.cryptoObject.cipher)
        step.cancel()
        assertEquals(before, keeper.snapshot())

        handOver(keeper)
        assertEquals("handing over stores nothing in the keeper", before, keeper.snapshot())
    }

    @Test
    fun anAppThatDoesNotKeepTheKeyCannotHandOver() {
        val notKept = TestApp(temporary.newFolder())
        notKept.open().setup.storeDerivedKeys(key)
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { notKept.open().setup.beginHandOver(reminders) })

        val keeper = keeper()
        keeper.hardware.removeScreenLock()
        assertFalse(keeper.open().setup.keepsRecoveryKey())
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { keeper.open().setup.beginHandOver(reminders) })

        val nothing = TestApp(temporary.newFolder())
        assertEquals(BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW, TestKeys.answerOf { nothing.open().setup.beginHandOver(reminders) })
    }

    @Test
    fun keysAreHandedOverOnlyToAnotherDataApp() {
        val keeper = keeper().open()
        val kept = keeper.setup.beginShowRecoveryKey().finish()
        val answers = listOf(2, 9, 15, 24).associateWith { words[it - 1] }
        listOf(TestKeys.water, AppName.of("sync"), AppName.of("catalog")).forEach { name ->
            try {
                keeper.setup.beginHandOver(name)
                fail("handed over to $name")
            } catch (_: IllegalArgumentException) {
                // The screen code checks the name first. Reaching here is its mistake.
            }
            try {
                keeper.setup.handOverAfterWords(kept, answers, name)
                fail("checked the words for $name")
            } catch (_: IllegalArgumentException) {
                // As above.
            }
        }
    }

    @Test
    fun anAppWithTheSameKeysTakesTheHandoverAndChangesNothing() {
        val asker = asker()
        asker.open().setup.storeDerivedKeys(key)
        val before = asker.snapshot()

        assertEquals(KeySetupResult.STORED, asker.open().setup.storeHandedOverKeys(handOver(keeper())))
        assertEquals(before, asker.snapshot())
    }

    @Test
    fun anAppWithKeysOfAnotherRecoveryKeyRefusesTheHandover() {
        val asker = asker()
        asker.open().setup.storeDerivedKeys(otherKey)
        val before = asker.snapshot()

        assertEquals(KeySetupResult.DIFFERENT_RECOVERY_KEY, asker.open().setup.storeHandedOverKeys(handOver(keeper())))
        assertEquals(before, asker.snapshot())
    }

    @Test
    fun aHandoverFinishesASetupThatStoppedButNeverOneOfAnotherKey() {
        val asker = asker()
        val crypto = asker.open()
        asker.store.stopBeforeChange = 3
        try {
            crypto.setup.storeDerivedKeys(key)
            fail("did not stop")
        } catch (_: Stopped) {
            // The app was killed just before record.
        }
        assertTrue(asker.open().status().setupIsUnfinished)

        val other = keeper(otherKey)
        val stopped = asker.snapshot()
        assertEquals(KeySetupResult.DIFFERENT_RECOVERY_KEY, asker.open().setup.storeHandedOverKeys(handOver(other)))
        assertEquals(stopped, asker.snapshot())

        assertEquals(KeySetupResult.STORED, asker.open().setup.storeHandedOverKeys(handOver(keeper())))
        assertFalse(asker.open().status().setupIsUnfinished)
        assertTrue(asker.open().status().hasDerivedKeys)
    }

    @Test
    fun aHandoverBringsBackTheFilesOfAnAppLockThatWasReset() {
        val asker = asker()
        asker.open().setup.storeDerivedKeys(key)
        asker.open().appLock.beginTurnOn(WordsProof(key.keyId)).finish()
        assertEquals(AppLockState.ON, asker.open().appLock.state())

        asker.hardware.removeScreenLock()
        val keys = handOver(keeper())
        val reset = asker.open()
        assertEquals(AppLockState.RESET, reset.appLock.state())
        assertEquals(KeySetupResult.STORED, reset.setup.storeHandedOverKeys(keys))
        assertEquals(listOf("file-key"), asker.store.changes)
        assertEquals(AppLockState.OFF, asker.open().appLock.state())
        assertEquals(HardwareKeyKind.UNLOCKED, asker.keyOf(KeysetName.FILE_KEY)!!.kind)
    }

    @Test
    fun aHandoverLeavesAnAppLockThatIsOnAsItIs() {
        val asker = asker()
        asker.open().setup.storeDerivedKeys(key)
        asker.open().appLock.beginTurnOn(WordsProof(key.keyId)).finish()
        val before = asker.snapshot()

        assertEquals(KeySetupResult.STORED, asker.open().setup.storeHandedOverKeys(handOver(keeper())))
        assertEquals(before, asker.snapshot())
        assertEquals(AppLockState.ON, asker.open().appLock.state())
    }

    @Test
    fun aHandoverRepairsADamagedKeysetFileAsTheWordsDo() {
        val asker = asker()
        asker.open().setup.storeDerivedKeys(key)
        val record = File(asker.folder, "record")
        damage(record)
        val damaged = record.readBytes()

        assertEquals(KeySetupResult.STORED, asker.open().setup.storeHandedOverKeys(handOver(keeper())))
        assertArrayEquals(damaged, File(asker.setAsideFolder, "record-1").readBytes())
        assertTrue(KeysetCodec.sameKeys(keysetOf(asker, KeysetName.RECORD), handOver(keeper()).derived.record))
    }

    @Test
    fun theKeysTravelThroughABundleUnchanged() {
        val keys = handOver(keeper())
        val read = throughABundle(keys)
        assertTrue(KeysetCodec.sameKeys(keys.derived.record, read.derived.record))
        assertTrue(KeysetCodec.sameKeys(keys.derived.backup, read.derived.backup))
        assertTrue(KeysetCodec.sameKeys(keys.derived.fileKey, read.derived.fileKey))
        assertEquals(key.keyId, read.keyId)
        assertFalse(read.wordsChecked)
    }

    @Test
    fun aBundleIsTakenOnlyInVersion1WithThreeKeysetsThatBelongTogether() {
        val good = Bundle().also { handOver(keeper()).writeTo(it) }
        val other = Bundle().also { handOver(keeper(otherKey)).writeTo(it) }
        val water = TestKeys.derived(key)

        fun changed(change: Bundle.() -> Unit) = Bundle(good).apply(change)

        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { HandedOverKeys.readFrom(Bundle()) })
        assertEquals(BlobAnswer.MADE_BY_A_NEWER_VERSION, TestKeys.answerOf { HandedOverKeys.readFrom(changed { putInt(VERSION, 2) }) })
        listOf<Pair<String, Bundle.() -> Unit>>(
            "no version" to { remove(VERSION) },
            "version 0" to { putInt(VERSION, 0) },
            "a version of another type" to { putString(VERSION, "1") },
            "no record" to { remove(RECORD) },
            "no backup" to { remove(BACKUP) },
            "no file-key" to { remove(FILE_KEY) },
            "a keyset of another type" to { putString(RECORD, "record") },
            "bytes that are no keyset" to { putByteArray(BACKUP, ByteArray(40) { 7 }) },
            "a record of the streaming type" to { putByteArray(RECORD, good.getByteArray(BACKUP)) },
            "a backup of the sealing type" to { putByteArray(BACKUP, good.getByteArray(RECORD)) },
            "a record of another recovery key" to { putByteArray(RECORD, other.getByteArray(RECORD)) },
            "a file-key of another recovery key" to { putByteArray(FILE_KEY, other.getByteArray(FILE_KEY)) },
            "a record with two keys" to {
                putByteArray(RECORD, KeysetCodec.serialize(KeysetCodec.union(water.record, KeysetCodec.newRandom(KeysetType.SEALING))!!))
            },
            "the recovery key itself" to { putByteArray(RECORD, KeysetCodec.serialize(TestKeys.recoveryKeyset(key))) },
            "a words flag of another type" to { putString(WORDS_CHECKED, "true") },
        ).forEach { (what, change) ->
            assertEquals(what, BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { HandedOverKeys.readFrom(changed(change)) })
        }
        assertNotNull("other entries are ignored", HandedOverKeys.readFrom(changed { putString("something.else", "x") }))
    }

    @Test
    fun aKeeperChecksFourWordsForAnotherAppAndThatIsItsProofForTheAppLock() {
        val asker = asker()
        asker.open().setup.storeHandedOverKeys(handOver(keeper()))
        val keeper = keeper().open()
        val kept = keeper.setup.beginShowRecoveryKey().finish()
        val answers = listOf(3, 8, 17, 22).associateWith { words[it - 1] }

        val checked = throughABundle(keeper.setup.handOverAfterWords(kept, answers, reminders)!!)
        assertTrue(checked.wordsChecked)
        val before = asker.snapshot()
        val proof = asker.open().setup.checkWordsAtKeeper(checked)
        assertNotNull(proof)
        assertEquals("the check stores nothing", before, asker.snapshot())

        val crypto = asker.open()
        crypto.appLock.beginTurnOn(proof!!).finish()
        assertEquals(AppLockState.ON, crypto.appLock.state())
        assertFalse(crypto.setup.keepsRecoveryKey())
    }

    @Test
    fun noProofWithoutTheWordsOrForAnotherRecoveryKey() {
        val asker = asker()
        asker.open().setup.storeHandedOverKeys(handOver(keeper()))
        val keeper = keeper().open()
        val kept = keeper.setup.beginShowRecoveryKey().finish()
        val answers = listOf(3, 8, 17, 22).associateWith { words[it - 1] }

        assertNull("one wrong word", keeper.setup.handOverAfterWords(kept, answers + (8 to words[0]), reminders))
        assertNull("not the keeper's own key", keeper.setup.handOverAfterWords(otherKey, otherKey.words().let { w -> answers.mapValues { w[it.key - 1] } }, reminders))
        assertNull("a plain handover is no proof", asker.open().setup.checkWordsAtKeeper(handOver(keeper())))

        val otherKeeper = keeper(otherKey).open()
        val otherKept = otherKeeper.setup.beginShowRecoveryKey().finish()
        val otherChecked = otherKeeper.setup.handOverAfterWords(otherKept, otherKey.words().let { w -> answers.mapValues { w[it.key - 1] } }, reminders)!!
        assertNull("the words of another recovery key", asker.open().setup.checkWordsAtKeeper(otherChecked))

        val nothing = asker()
        assertNull("an app with no keys has nothing to prove", nothing.open().setup.checkWordsAtKeeper(throughABundle(keeper.setup.handOverAfterWords(kept, answers, reminders)!!)))
    }

    private companion object {
        const val VERSION = "app.shkriuss.handover.VERSION"
        const val RECORD = "app.shkriuss.handover.RECORD"
        const val BACKUP = "app.shkriuss.handover.BACKUP"
        const val FILE_KEY = "app.shkriuss.handover.FILE_KEY"
        const val WORDS_CHECKED = "app.shkriuss.handover.WORDS_CHECKED"
    }
}
