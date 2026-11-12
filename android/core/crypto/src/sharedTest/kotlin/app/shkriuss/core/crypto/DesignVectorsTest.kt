package app.shkriuss.core.crypto

import app.shkriuss.core.crypto.fixtures.SoftwareHardwareKeys
import com.google.crypto.tink.Aead
import com.google.crypto.tink.InsecureSecretKeyAccess
import com.google.crypto.tink.KeysetHandle
import com.google.crypto.tink.RegistryConfiguration
import com.google.crypto.tink.aead.AesGcmKey
import com.google.crypto.tink.aead.AesGcmParameters
import com.google.crypto.tink.util.SecretBytes
import java.io.ByteArrayInputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Every vector of "Test vectors" in crypto-design.md (item 1 of "What the
 * tests must cover"). Tink cannot be told which nonce to use, so the blobs
 * are tests for opening. Sealing is tested by round trips.
 */
class DesignVectorsTest {
    private val recoveryKey = TestKeys.vectorRecoveryKey()
    private val derived = TestKeys.derived(recoveryKey)

    private val fileKeyBytes = hex("a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf")
    private val fileId = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"
    private val fileSalt = hex("606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f")
    private val fileNoncePrefix = hex("10111213141516")
    private val fileKey = TestKeys.fileKeyOf(fileKeyBytes, FILE_KEY_ID)

    @Test
    fun keyIdAndWords() {
        assertEquals("b19d376f", recoveryKey.keyId.toString())
        assertEquals(
            "abandon amount liar amount expire adjust cage candy " +
                "arch gather drum bullet absurd math era live " +
                "bid rhythm alien crouch range attend journey unaware",
            recoveryKey.words().joinToString(" "),
        )
    }

    @Test
    fun derivedKeysForWater() {
        assertEquals(
            listOf("2ea787db61b3469728cb62c4d9ce81891169363dc3a25bfd24db275641f13980"),
            TestKeys.keyBytes(derived.record),
        )
        assertEquals(
            listOf("856f496f008216060733447a8093752b3bc04195cb164396e13b034e92c7c463"),
            TestKeys.keyBytes(derived.backup),
        )
        assertEquals(
            listOf("7a32e58cfa189148f623776170c5e9bab5da910ee080bc94930ba8e8a37362d1"),
            TestKeys.keyBytes(derived.fileKey),
        )
    }

    @Test
    fun everyDerivedKeyHasTheKeyIdOfItsRecoveryKey() {
        listOf(derived.record, derived.backup, derived.fileKey).forEach { keyset ->
            assertEquals(listOf(recoveryKey.keyId), KeysetCodec.keyIds(keyset))
            assertEquals(recoveryKey.keyId, KeysetCodec.primaryId(keyset))
        }
    }

    @Test
    fun recordKeysetAsTinksBinaryKeyset() {
        assertEquals(RECORD_KEYSET.filterNot { it.isWhitespace() }, KeysetCodec.serialize(derived.record).toHex())
        assertEquals(119, KeysetCodec.serialize(derived.record).size)
    }

    @Test
    fun recoveryKeysetAsTinksBinaryKeyset() {
        val serialized = KeysetCodec.serialize(TestKeys.recoveryKeyset(recoveryKey))
        assertEquals(RECOVERY_KEYSET.filterNot { it.isWhitespace() }, serialized.toHex())
        assertEquals(113, serialized.size)
    }

    @Test
    fun kind1SealedRecord() {
        val blob = hex(
            """
            53484b010101b19d376f404142434445464748494a4b4c4d4e4f505152535455
            56579de67bfa1e55912b5ad2d254cb6bda565a1a54d613396f3c713edc2a0fe2
            ac872b70
            """,
        )
        val recordId = "00112233-4455-4677-8899-aabbccddeeff"
        assertEquals(68, blob.size)
        assertArrayEquals(
            hex("53484b010100112233445546778899aabbccddeeff"),
            AssociatedData.forId(BlobKind.SEALED_RECORD, recordId),
        )

        val plaintext = SealedBlobs.open(
            BlobKind.SEALED_RECORD,
            derived.record,
            AssociatedData.forId(BlobKind.SEALED_RECORD, recordId),
            blob,
        )
        assertEquals("sealed record test", String(plaintext, Charsets.US_ASCII))

        // It must not open with the record ID changed in its last byte.
        val otherId = "00112233-4455-4677-8899-aabbccddeefe"
        assertEquals(
            BlobAnswer.DAMAGED_OR_CHANGED,
            TestKeys.answerOf {
                SealedBlobs.open(
                    BlobKind.SEALED_RECORD,
                    derived.record,
                    AssociatedData.forId(BlobKind.SEALED_RECORD, otherId),
                    blob,
                )
            },
        )
    }

    @Test
    fun kind2AssociatedDataAndStreamKey() {
        val associatedData = AssociatedData.forId(BlobKind.FILE_STREAM, fileId)
        assertArrayEquals(hex("53484b01020f1e2d3c4b5a49788695a4b3c2d1e0ff"), associatedData)
        assertEquals(
            "89e679d7dddafc7dadf998c023639cfc39417066b3fa378bd44ba32d10af66cc",
            ReferenceStream.streamKey(fileKeyBytes, fileSalt, associatedData).toHex(),
        )
    }

    @Test
    fun kind2EmptyFile() {
        val blob = hex(
            """
            53484b010228606162636465666768696a6b6c6d6e6f70717273747576777879
            7a7b7c7d7e7f10111213141516d342b9778f744a3bcac7ee6f3c6f72ca
            """,
        )
        assertEquals(61, blob.size)
        assertArrayEquals(blob, referenceFile(ByteArray(0)))
        assertArrayEquals(ByteArray(0), TestKeys.decryptFile(fileKey, fileId, blob))
    }

    @Test
    fun kind2SmallFile() {
        val blob = hex(
            """
            53484b010228606162636465666768696a6b6c6d6e6f70717273747576777879
            7a7b7c7d7e7f101112131415169a858c7fe385e11df99795433c2849a9996fb1
            94fa42f38705612211e018459a
            """,
        )
        assertEquals(77, blob.size)
        assertArrayEquals(blob, referenceFile("file stream test".toByteArray(Charsets.US_ASCII)))
        assertEquals("file stream test", String(TestKeys.decryptFile(fileKey, fileId, blob), Charsets.US_ASCII))
    }

    @Test
    fun kind2OneSegmentExactlyFull() = longFile(
        plaintextSize = 1_048_520,
        blobSize = 1_048_581,
        blobHash = "6cfb3b27f59afea137cdc6381b7b0b66728933abc71323f67fdce4133f6e9f77",
        plaintextHash = "c1d229c473a1b2dc6f785f4e20919bd921a161c53a45d1af65b9cd0c5fb245a6",
    )

    @Test
    fun kind2TwoSegments() = longFile(
        plaintextSize = 1_048_521,
        blobSize = 1_048_598,
        blobHash = "1c5ff74f80ca384cde7d51f1aca07ccb0ecf0672518d6304243b7544f03e6fa6",
        plaintextHash = "ede29c24f5b1c799ee3fb2bd2522bca23e2c21b928eb7ff19d4a3c97129599e7",
    )

    @Test
    fun kind2ThreeSegments() = longFile(
        plaintextSize = 2_500_000,
        blobSize = 2_500_093,
        blobHash = "d1d38e3431844f0154f450fe9956c8c26d08fc9d7a7b016c43228ad9ee7df5bb",
        plaintextHash = "bd597bc684f3effbd30ef55f519679760ca77831d212eddc15fb862e7ffb8c8f",
    )

    /**
     * Builds the blob from the page's values, compares its SHA-256, lets
     * the module open it, and checks that it fails with its last 17 bytes
     * cut off.
     */
    private fun longFile(plaintextSize: Int, blobSize: Int, blobHash: String, plaintextHash: String) {
        val plaintext = TestKeys.pattern(plaintextSize)
        assertEquals(plaintextHash, TestKeys.sha256(plaintext))

        val blob = referenceFile(plaintext)
        assertEquals(blobSize, blob.size)
        assertEquals(blobHash, TestKeys.sha256(blob))
        assertEquals(plaintextHash, TestKeys.sha256(TestKeys.decryptFile(fileKey, fileId, blob)))

        val cut = blob.copyOf(blob.size - 17)
        assertEquals(BlobAnswer.DAMAGED_OR_CHANGED, TestKeys.answerOf { TestKeys.decryptFile(fileKey, fileId, cut) })
    }

    private fun referenceFile(plaintext: ByteArray): ByteArray = ReferenceStream.build(
        BlobKind.FILE_STREAM,
        fileKeyBytes,
        fileSalt,
        fileNoncePrefix,
        AssociatedData.forId(BlobKind.FILE_STREAM, fileId),
        plaintext,
    )

    @Test
    fun kind3BackupStream() {
        val blob = hex(
            """
            53484b010328303132333435363738393a3b3c3d3e3f40414243444546474849
            4a4b4c4d4e4f707172737475762f4c25bad40f340da5313be45aabfc5ca63a14
            c51f4668b6db5e9affd782c515e5ee
            """,
        )
        val backupHeader = "example backup header".toByteArray(Charsets.US_ASCII)
        val associatedData = AssociatedData.forBackup(backupHeader)
        assertEquals(79, blob.size)
        assertArrayEquals(hex("53484b01036578616d706c65206261636b757020686561646572"), associatedData)

        val backupKey = hex(TestKeys.keyBytes(derived.backup).single())
        val reference = ReferenceStream.build(
            BlobKind.BACKUP_STREAM,
            backupKey,
            hex("303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f"),
            hex("70717273747576"),
            associatedData,
            "backup stream test".toByteArray(Charsets.US_ASCII),
        )
        assertArrayEquals(blob, reference)

        val plaintext = Streams.decrypting(BlobKind.BACKUP_STREAM, derived.backup, associatedData, ByteArrayInputStream(blob))
            .use { it.readBytes() }
        assertEquals("backup stream test", String(plaintext, Charsets.US_ASCII))
    }

    @Test
    fun kind4WrappedFileKey() {
        val blob = hex(
            """
            53484b010401b19d376f808182838485868788898a8b8c8d8e8f909192939495
            9697cbcbd5a521af018ed74a13ea64fbbe296353cabfef7eb6763a10d101c998
            fd871dee2a714739c22cc81c1910f4e485dd0bde9248d796be04fd4f7386a016
            cf774dbb16b8010c32089de847b1133a229e418a73800db4463912ca3b3c1f09
            602277ee917ce22f2fadd8c5b02f4fc7d65c6f2cadd30c68fe9afa9e00519fe8
            25245026b44ae130026fe0affce40112527007f95c
            """,
        )
        val fileKeyKeyset = FILE_KEY_KEYSET.filterNot { it.isWhitespace() }
        assertEquals(181, blob.size)
        assertEquals(131, hex(fileKeyKeyset).size)
        assertEquals(fileKeyKeyset, KeysetCodec.serialize(fileKey.keyset).toHex())
        assertArrayEquals(
            hex("53484b01040f1e2d3c4b5a49788695a4b3c2d1e0ff"),
            AssociatedData.forId(BlobKind.WRAPPED_FILE_KEY, fileId),
        )

        val plaintext = SealedBlobs.open(
            BlobKind.WRAPPED_FILE_KEY,
            derived.fileKey,
            AssociatedData.forId(BlobKind.WRAPPED_FILE_KEY, fileId),
            blob,
        )
        assertEquals(fileKeyKeyset, plaintext.toHex())
        assertEquals(recoveryKey.keyId, SealedBlobs.keyIdOf(BlobKind.WRAPPED_FILE_KEY, blob))
    }

    @Test
    fun kind5KeysetWrappedByAHardwareKey() {
        val blob = hex(
            """
            53484b01050100000001202122232425262728292a2b49dafd91121a02df2886
            16f8de4f9979d93f76878ea3a72717a5a0624c108e790fbc0caf9ba2b93e77a8
            fc1c20c4584b5ea7f0ce51eb96e825c29ab93e3d2a16247d912331ec1ab09468
            3f263e4f8d759739b98b501e3f969f646a5d75b426ddefcf8c17facaf120d099
            de01854b108f58a9ff8768fca193f7fce8d937f5dc0b2efa4402b2edb7
            """,
        )
        val standIn = hex("c0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedf")
        val key = HardwareKeyRef(HardwareKeyKind.BACKGROUND, 1)
        val associatedData = AssociatedData.forKeyset(key, KeysetName.RECORD)
        assertEquals(157, blob.size)
        assertEquals(key, WrappedKeyset.keyOf(blob, KeysetName.RECORD))
        assertArrayEquals(hex("53484b010501000000017265636f7264"), associatedData)
        assertArrayEquals(hex("202122232425262728292a2b"), WrappedKeyset.iv(blob))

        // Tink's AES-GCM key with no prefix opens bytes 10 to the end.
        val parameters = AesGcmParameters.builder()
            .setKeySizeBytes(32)
            .setIvSizeBytes(12)
            .setTagSizeBytes(16)
            .setVariant(AesGcmParameters.Variant.NO_PREFIX)
            .build()
        val tinkKey = AesGcmKey.builder()
            .setParameters(parameters)
            .setKeyBytes(SecretBytes.copyFrom(standIn, InsecureSecretKeyAccess.get()))
            .build()
        TinkSetup.ready()
        val aead = KeysetHandle.newBuilder()
            .addEntry(KeysetHandle.importKey(tinkKey).withRandomId().makePrimary())
            .build()
            .getPrimitive(RegistryConfiguration.get(), Aead::class.java)
        val recordKeyset = RECORD_KEYSET.filterNot { it.isWhitespace() }
        assertEquals(recordKeyset, aead.decrypt(WrappedKeyset.afterPrefix(blob), associatedData).toHex())

        // The software stand-in of the tests has the same byte layout.
        val hardware = SoftwareHardwareKeys().apply { put(key, standIn) }
        assertEquals(recordKeyset, hardware.decrypt(key, WrappedKeyset.afterPrefix(blob), associatedData).toHex())
    }

    private companion object {
        /** The file key's own key ID in the kind 4 vector. */
        const val FILE_KEY_ID = 0xf1020304.toInt()

        const val RECORD_KEYSET = """
            08efeef48c0b126f0a630a3b747970652e676f6f676c65617069732e636f6d2f
            676f6f676c652e63727970746f2e74696e6b2e584368614368613230506f6c79
            313330354b657912221a202ea787db61b3469728cb62c4d9ce81891169363dc3
            a25bfd24db275641f139801801100118efeef48c0b2001
            """

        const val RECOVERY_KEYSET = """
            08efeef48c0b12690a5d0a31747970652e676f6f676c65617069732e636f6d2f
            676f6f676c652e63727970746f2e74696e6b2e486b64665072664b6579122612
            0208031a20000102030405060708090a0b0c0d0e0f101112131415161718191a
            1b1c1d1e1f1801100118efeef48c0b2003
            """

        const val FILE_KEY_KEYSET = """
            08848688880f127b0a6f0a3d747970652e676f6f676c65617069732e636f6d2f
            676f6f676c652e63727970746f2e74696e6b2e41657347636d486b6466537472
            65616d696e674b6579122c120808808040102018031a20a0a1a2a3a4a5a6a7a8
            a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf180110011884868888
            0f2003
            """
    }
}
