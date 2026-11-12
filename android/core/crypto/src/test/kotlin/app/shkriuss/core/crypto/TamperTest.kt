package app.shkriuss.core.crypto

import com.google.crypto.tink.KeysetHandle
import com.google.crypto.tink.streamingaead.PredefinedStreamingAeadParameters
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * For every kind of blob: one changed byte anywhere, a cut blob, a wrong
 * key, a wrong ID in the associated data, a wrong kind, a higher version
 * and a wrong magic (item 3 of "What the tests must cover" in
 * crypto-design.md). Nothing is used before it is checked.
 */
class TamperTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val recordId = "00112233-4455-4677-8899-aabbccddeeff"
    private val otherRecordId = "00112233-4455-4677-8899-aabbccddeefe"
    private val fileId = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"
    private val otherFileId = "1f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"
    private val derived = TestKeys.derived(TestKeys.vectorRecoveryKey())
    private val otherDerived = TestKeys.derived(RecoveryKey.ofBytes(ByteArray(32) { 0x55 }))

    private fun ByteArray.withByteChanged(index: Int): ByteArray = copyOf().also { it[index] = (it[index].toInt() xor 1).toByte() }

    private fun ByteArray.withByte(index: Int, value: Int): ByteArray = copyOf().also { it[index] = value.toByte() }

    // Kinds 1 and 4: sealed blobs.

    private fun sealed(kind: BlobKind, id: String) = SealedBlobs.seal(
        kind,
        if (kind == BlobKind.SEALED_RECORD) derived.record else derived.fileKey,
        AssociatedData.forId(kind, id),
        "a record or a key".toByteArray(),
    )

    private fun openSealed(kind: BlobKind, blob: ByteArray, id: String, keysets: DerivedKeysets = derived) {
        val keyset = if (kind == BlobKind.SEALED_RECORD) keysets.record else keysets.fileKey
        SealedBlobs.open(kind, keyset, AssociatedData.forId(kind, id), blob)
    }

    private val sealedKinds = listOf(BlobKind.SEALED_RECORD to recordId, BlobKind.WRAPPED_FILE_KEY to fileId)

    @Test
    fun sealedBlobsOneChangedByteAnywhere() {
        sealedKinds.forEach { (kind, id) ->
            val blob = sealed(kind, id)
            blob.indices.forEach { index ->
                val expected = when (index) {
                    in 0..2 -> BlobAnswer.NOT_ONE_OF_OURS
                    3 -> BlobAnswer.DAMAGED_OR_CHANGED // version 01 becomes 00
                    4 -> BlobAnswer.WRONG_KIND
                    5 -> BlobAnswer.DAMAGED_OR_CHANGED // Tink's prefix byte
                    in 6..9 -> BlobAnswer.NEEDS_ANOTHER_RECOVERY_KEY
                    else -> BlobAnswer.DAMAGED_OR_CHANGED
                }
                assertEquals("$kind, byte $index", expected, TestKeys.answerOf { openSealed(kind, blob.withByteChanged(index), id) })
            }
        }
    }

    @Test
    fun sealedBlobsCutAtEveryLength() {
        sealedKinds.forEach { (kind, id) ->
            val blob = sealed(kind, id)
            (0 until blob.size).forEach { length ->
                val expected = if (length < 3) BlobAnswer.NOT_ONE_OF_OURS else BlobAnswer.DAMAGED_OR_CHANGED
                assertEquals("$kind, $length bytes", expected, TestKeys.answerOf { openSealed(kind, blob.copyOf(length), id) })
            }
        }
    }

    @Test
    fun sealedBlobsWrongKeyWrongIdWrongKindVersionAndMagic() {
        sealedKinds.forEach { (kind, id) ->
            val blob = sealed(kind, id)
            val otherId = if (kind == BlobKind.SEALED_RECORD) otherRecordId else otherFileId
            val otherKind = sealedKinds.first { it.first != kind }.first

            // The keys of another recovery key: the blob names a key ID the keyset does not have.
            try {
                openSealed(kind, blob, id, otherDerived)
                fail("opened with the wrong key")
            } catch (refused: BlobException) {
                assertEquals(BlobAnswer.NEEDS_ANOTHER_RECOVERY_KEY, refused.answer)
                assertEquals(TestKeys.vectorRecoveryKey().keyId, refused.keyId)
            }
            assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { openSealed(kind, blob, otherId) })
            assertEquals(BlobAnswer.WRONG_KIND, TestKeys.answerOf { openSealed(otherKind, blob, id) })
            assertEquals(BlobAnswer.WRONG_KIND, TestKeys.answerOf { openSealed(kind, blob.withByte(4, 9), id) })
            assertEquals(BlobAnswer.MADE_BY_A_NEWER_VERSION, TestKeys.answerOf { openSealed(kind, blob.withByte(3, 2), id) })
            assertEquals(BlobAnswer.NOT_ONE_OF_OURS, TestKeys.answerOf { openSealed(kind, blob.withByte(0, 0x54), id) })
            assertEquals(BlobAnswer.NOT_ONE_OF_OURS, TestKeys.answerOf { openSealed(kind, "not a blob at all".toByteArray(), id) })
        }
    }

    @Test
    fun aSealedBlobDoesNotOpenAsTheOtherKindEvenUnderTheSameKey() {
        // The kind byte is inside the associated data.
        val blob = SealedBlobs.seal(
            BlobKind.SEALED_RECORD,
            derived.record,
            AssociatedData.forId(BlobKind.SEALED_RECORD, recordId),
            ByteArray(8),
        )
        val relabelled = blob.withByte(4, BlobKind.WRAPPED_FILE_KEY.byte.toInt())
        assertEquals(
            BlobAnswer.DAMAGED_OR_CHANGED,
            TestKeys.answerOf {
                SealedBlobs.open(
                    BlobKind.WRAPPED_FILE_KEY,
                    derived.record,
                    AssociatedData.forId(BlobKind.WRAPPED_FILE_KEY, recordId),
                    relabelled,
                )
            },
        )
    }

    // Kinds 2 and 3: streams.

    private val backupHeader = "the backup header".toByteArray()
    private val fileKey = FileKey(KeysetCodec.newRandom(KeysetType.STREAMING))

    private fun encryptStream(kind: BlobKind, plaintext: ByteArray): ByteArray {
        val blob = ByteArrayOutputStream()
        val stream = if (kind == BlobKind.FILE_STREAM) {
            fileKey.encryptingStream(fileId, blob)
        } else {
            Streams.encrypting(kind, derived.backup, AssociatedData.forBackup(backupHeader), blob)
        }
        stream.use { it.write(plaintext) }
        return blob.toByteArray()
    }

    private fun decryptStream(
        kind: BlobKind,
        blob: ByteArray,
        fileKey: FileKey = this.fileKey,
        fileId: String = this.fileId,
        backupHeader: ByteArray = this.backupHeader,
        keysets: DerivedKeysets = derived,
    ): ByteArray {
        val input = ByteArrayInputStream(blob)
        val stream = if (kind == BlobKind.FILE_STREAM) {
            fileKey.decryptingStream(fileId, input)
        } else {
            Streams.decrypting(kind, keysets.backup, AssociatedData.forBackup(backupHeader), input)
        }
        return stream.use { it.readBytes() }
    }

    private val streamKinds = listOf(BlobKind.FILE_STREAM, BlobKind.BACKUP_STREAM)

    @Test
    fun streamsOneChangedByteAnywhere() {
        streamKinds.forEach { kind ->
            val blob = encryptStream(kind, "a small stream".toByteArray())
            blob.indices.forEach { index ->
                val expected = when (index) {
                    in 0..2 -> BlobAnswer.NOT_ONE_OF_OURS
                    4 -> BlobAnswer.WRONG_KIND
                    else -> BlobAnswer.DAMAGED_OR_CHANGED
                }
                assertEquals("$kind, byte $index", expected, TestKeys.answerOf { decryptStream(kind, blob.withByteChanged(index)) })
            }
        }
    }

    @Test
    fun streamsCutAtEveryLength() {
        streamKinds.forEach { kind ->
            val blob = encryptStream(kind, "a small stream".toByteArray())
            (0 until blob.size).forEach { length ->
                val expected = if (length < 3) BlobAnswer.NOT_ONE_OF_OURS else BlobAnswer.DAMAGED_OR_CHANGED
                assertEquals("$kind, $length bytes", expected, TestKeys.answerOf { decryptStream(kind, blob.copyOf(length)) })
            }
        }
    }

    @Test
    fun streamsWrongKeyWrongIdWrongKindVersionAndMagic() {
        streamKinds.forEach { kind ->
            val blob = encryptStream(kind, TestKeys.pattern(1_000))
            val otherKind = streamKinds.first { it != kind }
            val otherKey = FileKey(KeysetCodec.newRandom(KeysetType.STREAMING))
            assertEquals(
                BlobAnswer.DAMAGED_OR_CHANGED,
                TestKeys.answerOf { decryptStream(kind, blob, fileKey = otherKey, keysets = otherDerived) },
            )
            assertEquals(
                BlobAnswer.DAMAGED_OR_CHANGED,
                TestKeys.answerOf {
                    decryptStream(kind, blob, fileId = otherFileId, backupHeader = "another backup header".toByteArray())
                },
            )
            assertEquals(BlobAnswer.WRONG_KIND, TestKeys.answerOf { decryptStream(otherKind, blob) })
            assertEquals(BlobAnswer.WRONG_KIND, TestKeys.answerOf { decryptStream(kind, blob.withByte(4, 9)) })
            assertEquals(BlobAnswer.MADE_BY_A_NEWER_VERSION, TestKeys.answerOf { decryptStream(kind, blob.withByte(3, 2)) })
            assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { decryptStream(kind, blob.withByte(3, 0)) })
            assertEquals(BlobAnswer.NOT_ONE_OF_OURS, TestKeys.answerOf { decryptStream(kind, blob.withByte(1, 0x49)) })
        }
    }

    @Test
    fun streamSegmentsThatAreChangedSwappedDroppedOrRepeated() {
        val plaintext = TestKeys.pattern(3 * 1_048_576)
        val blob = encryptStream(BlobKind.FILE_STREAM, plaintext)
        // Where the segments are in the blob: the header, then 1 MiB each, the first one with Tink's 40 bytes.
        val first = 5 until 5 + 1_048_576
        val second = first.last + 1 until first.last + 1 + 1_048_576
        val third = second.last + 1 until second.last + 1 + 1_048_576
        val rest = third.last + 1 until blob.size
        assertTrue(rest.count() > 16)

        fun part(range: IntRange) = blob.copyOfRange(range.first, range.last + 1)
        val head = blob.copyOf(5)
        val broken = mapOf(
            "a byte changed in the first segment" to blob.withByteChanged(first.first + 5_000),
            "a byte changed in the second segment" to blob.withByteChanged(second.first + 5_000),
            "a byte changed in the last segment" to blob.withByteChanged(blob.size - 20),
            "second and third swapped" to head + part(first) + part(third) + part(second) + part(rest),
            "second dropped" to head + part(first) + part(third) + part(rest),
            "second repeated" to head + part(first) + part(second) + part(second) + part(third) + part(rest),
            "last segment dropped" to blob.copyOf(rest.first),
            "bytes added at the end" to blob + ByteArray(16),
        )
        broken.forEach { (what, changed) ->
            assertEquals(what, BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { decryptStream(BlobKind.FILE_STREAM, changed) })
        }
        assertArrayEquals(plaintext, decryptStream(BlobKind.FILE_STREAM, blob))
    }

    @Test
    fun aCutStreamGivesWhatWasCheckedAndThenFails() {
        val plaintext = TestKeys.pattern(3 * 1_048_576)
        val blob = encryptStream(BlobKind.FILE_STREAM, plaintext)
        val cut = blob.copyOf(blob.size - 17)
        val stream = fileKey.decryptingStream(fileId, ByteArrayInputStream(cut))
        val read = ByteArrayOutputStream()
        val buffer = ByteArray(65_536)
        var answer: BlobAnswer? = null
        try {
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                read.write(buffer, 0, count)
            }
        } catch (refused: BlobException) {
            answer = refused.answer
        }
        // The file counts as whole only when its stream has ended without an error.
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, answer)
        assertTrue(read.size() in 1 until plaintext.size)
        assertArrayEquals(plaintext.copyOf(read.size()), read.toByteArray())
    }

    // Kind 5: keysets wrapped by a hardware key.

    private fun appWithKeys(): TestApp = TestApp(temporary.newFolder()).also {
        assertEquals(KeySetupResult.STORED, it.open().setup.storeDerivedKeys(TestKeys.vectorRecoveryKey()))
    }

    private fun TestApp.write(name: KeysetName, blob: ByteArray) = File(folder, name.text).writeBytes(blob)

    @Test
    fun wrappedKeysetOneChangedByteAnywhere() {
        val app = appWithKeys()
        val blob = KeysetFiles(app.folder).read(KeysetName.RECORD)!!
        blob.indices.forEach { index ->
            app.write(KeysetName.RECORD, blob.withByteChanged(index))
            val stored = app.open(start = false).let { app.vault.look(KeysetName.RECORD) }
            // A changed number byte names a hardware key that does not exist. In the last
            // one the change turns number 1 into number 0, which no key has. Everything
            // else is damage.
            val namesAnotherKey = index in 6..8
            assertEquals("byte $index", if (namesAnotherKey) Stored.KeyGone::class else Stored.Damaged::class, stored::class)
            assertEquals(
                "byte $index",
                if (namesAnotherKey) BlobAnswer.NEEDS_KEYS_NOT_HERE_NOW else BlobAnswer.DAMAGED_OR_CHANGED,
                TestKeys.answerOf { app.open(start = false).records.seal(recordId, ByteArray(1)) },
            )
        }
        app.write(KeysetName.RECORD, blob)
        assertNotNull(app.open().records.seal(recordId, ByteArray(1)))
    }

    @Test
    fun wrappedKeysetCutAtEveryLength() {
        val app = appWithKeys()
        val blob = KeysetFiles(app.folder).read(KeysetName.RECORD)!!
        (0 until blob.size).forEach { length ->
            app.write(KeysetName.RECORD, blob.copyOf(length))
            app.open(start = false)
            assertEquals("$length bytes", Stored.Damaged::class, app.vault.look(KeysetName.RECORD)::class)
        }
    }

    @Test
    fun wrappedKeysetWrongKeyWrongNameWrongKindVersionAndMagic() {
        val app = appWithKeys()
        val files = KeysetFiles(app.folder)
        val record = files.read(KeysetName.RECORD)!!
        val backup = files.read(KeysetName.BACKUP)!!

        // The header answers, as a reader of kind 5 gives them.
        assertEquals(BlobAnswer.WRONG_KIND, TestKeys.answerOf { WrappedKeyset.keyOf(record.withByte(4, 1), KeysetName.RECORD) })
        assertEquals(
            BlobAnswer.MADE_BY_A_NEWER_VERSION,
            TestKeys.answerOf { WrappedKeyset.keyOf(record.withByte(3, 2), KeysetName.RECORD) },
        )
        assertEquals(BlobAnswer.NOT_ONE_OF_OURS, TestKeys.answerOf { WrappedKeyset.keyOf(record.withByte(2, 0), KeysetName.RECORD) })
        // A hardware key kind that does not exist, the number 0, and a kind that may not wrap this keyset.
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { WrappedKeyset.keyOf(record.withByte(5, 5), KeysetName.RECORD) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { WrappedKeyset.keyOf(record.withByte(9, 0), KeysetName.RECORD) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { WrappedKeyset.keyOf(record.withByte(5, 2), KeysetName.RECORD) })

        // A keyset file renamed to another keyset: the name is in the associated data.
        app.hardware.unlockedKeyAllowed = false
        app.write(KeysetName.BACKUP, record)
        app.open(start = false)
        assertEquals(Stored.Damaged::class, app.vault.look(KeysetName.BACKUP)::class)
        app.write(KeysetName.BACKUP, backup)

        // Another hardware key under the same alias.
        val key = app.keyOf(KeysetName.RECORD)!!
        app.hardware.put(key, ByteArray(32) { 7 })
        app.open(start = false)
        assertEquals(Stored.Damaged::class, app.vault.look(KeysetName.RECORD)::class)
    }

    @Test
    fun everyPairOfHardwareKeyAndKeysetThatIsNotAllowedIsRefused() {
        val allowed = mapOf(
            KeysetName.RECORD to setOf(HardwareKeyKind.BACKGROUND),
            KeysetName.BACKUP to setOf(HardwareKeyKind.BACKGROUND, HardwareKeyKind.UNLOCKED),
            KeysetName.FILE_KEY to setOf(HardwareKeyKind.BACKGROUND, HardwareKeyKind.UNLOCKED, HardwareKeyKind.LOCK),
            KeysetName.FILE_KEY_OLD to setOf(HardwareKeyKind.BACKGROUND, HardwareKeyKind.UNLOCKED),
            KeysetName.RECOVERY to setOf(HardwareKeyKind.RECOVERY_GUARD),
        )
        KeysetName.entries.forEach { name ->
            HardwareKeyKind.entries.forEach { kind ->
                val blob = WrappedKeyset.prefix(HardwareKeyRef(kind, 1)) + ByteArray(40)
                val answer = TestKeys.answerOf { WrappedKeyset.keyOf(blob, name) }
                assertEquals("$name under $kind", if (kind in allowed.getValue(name)) null else BlobAnswer.DAMAGED_OR_CHANGED, answer)
            }
        }
    }

    @Test
    fun aKeysetOfTheWrongKeyTypeIsRefused() {
        val streaming = KeysetCodec.serialize(derived.backup)
        val sealing = KeysetCodec.serialize(derived.record)
        val recovery = KeysetCodec.serialize(TestKeys.recoveryKeyset(TestKeys.vectorRecoveryKey()))
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { KeysetCodec.parse(streaming, KeysetType.SEALING) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { KeysetCodec.parse(sealing, KeysetType.STREAMING) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { KeysetCodec.parse(sealing, KeysetType.RECOVERY) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { KeysetCodec.parse(recovery, KeysetType.SEALING) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { KeysetCodec.parse(ByteArray(0), KeysetType.SEALING) })
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { KeysetCodec.parse(ByteArray(64) { 9 }, KeysetType.SEALING) })
        // Other parameters of the right key type: a 4 KiB segment size instead of 1 MiB.
        val otherParameters = KeysetHandle.newBuilder()
            .addEntry(
                KeysetHandle.generateEntryFromParameters(PredefinedStreamingAeadParameters.AES256_GCM_HKDF_4KB)
                    .withRandomId()
                    .makePrimary(),
            )
            .build()
        assertEquals(
            BlobAnswer.DAMAGED_OR_CHANGED,
            TestKeys.answerOf { KeysetCodec.parse(KeysetCodec.serialize(otherParameters), KeysetType.STREAMING) },
        )
        // A file key holds exactly one key.
        val two = RecoveryKeyDeriver.derive(
            RecoveryKeyDeriver.recoveryKeyset(
                listOf(TestKeys.vectorRecoveryKey(), RecoveryKey.ofBytes(ByteArray(32) { 3 })),
                TestKeys.vectorRecoveryKey(),
            ),
            TestKeys.water,
        ).backup
        assertEquals(
            BlobAnswer.DAMAGED_OR_CHANGED,
            TestKeys.answerOf { KeysetCodec.parse(KeysetCodec.serialize(two), KeysetType.STREAMING, exactCount = 1) },
        )
    }
}
