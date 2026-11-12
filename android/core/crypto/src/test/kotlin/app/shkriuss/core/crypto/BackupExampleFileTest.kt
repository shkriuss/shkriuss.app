package app.shkriuss.core.crypto

import java.io.ByteArrayInputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The example file of docs/architecture/backup-format.md.
 *
 * Tink cannot be told which salt and nonce prefix to use. So the file is
 * built here a second time, from HMAC and AES-GCM alone
 * ([ReferenceStream]), with the values the page gives. The result must be
 * the bytes on the page, and this module must open them.
 *
 * `core/backup` has the same bytes in its own test and reads them as a
 * backup. This test is here because only this module may use the plain
 * AES-GCM that the second build needs.
 */
class BackupExampleFileTest {
    private val derived = TestKeys.derived(TestKeys.vectorRecoveryKey())

    @Test
    fun theExampleFileIsWhatASecondBuildFromTheValuesOfThePageGives() {
        assertEquals("the header names the recovery key of the vectors", "b19d376f", TestKeys.vectorRecoveryKey().keyId.toString())
        val associatedData = AssociatedData.forBackup(HEADER)
        assertEquals("53484b010353484b42414b01b19d376f057761746572", associatedData.toHex())

        val stream = ReferenceStream.build(
            BlobKind.BACKUP_STREAM,
            hex(TestKeys.keyBytes(derived.backup).single()),
            SALT,
            NONCE_PREFIX,
            associatedData,
            BODY,
        )

        assertEquals(312, BODY.size)
        assertEquals(390, HEADER.size + stream.size)
        assertEquals(EXAMPLE_FILE.toHex(), (HEADER + stream).toHex())
    }

    @Test
    fun theModuleOpensTheStreamOfTheExampleFileUnderItsHeader() {
        val stream = EXAMPLE_FILE.copyOfRange(HEADER.size, EXAMPLE_FILE.size)

        val body = Streams.decrypting(BlobKind.BACKUP_STREAM, derived.backup, AssociatedData.forBackup(HEADER), ByteArrayInputStream(stream))
            .use { it.readBytes() }

        assertArrayEquals(BODY, body)
    }

    private companion object {
        /** `SHKBAK`, version 1, key ID `b19d376f`, the app name `water`. */
        val HEADER = hex("53484b42414b01b19d376f057761746572")

        val SALT = hex("505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f")
        val NONCE_PREFIX = hex("f0f1f2f3f4f5f6")

        /** The Manifest, three records, one file and End, as on the page. */
        val BODY = hex(
            """
            01000000010000019b77119680
            02076578616d706c6500112233445546778899aabbccddeeff0000019b76daa8
            000000019b76db926000000000126261636b7570207265636f72642074657374
            02076578616d706c650f1e2d3c4b5a49788695a4b3c2d1e0ff0000019b76dc7c
            c00000019b76dc7cc0000000001066696c65207265636f72642074657374
            02076578616d706c65fedcba98765443218fedcba9876543210000019b76daa8
            000000019b76dd6720010000019b76dd672000000000
            030f1e2d3c4b5a49788695a4b3c2d1e0ff000000000000004d53484b01022860
            6162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f10
            1112131415169a858c7fe385e11df99795433c2849a9996fb194fa42f3870561
            2211e018459a
            0400000000000000030000000000000001
            """,
        )

        /** The whole file, 390 bytes, as on the page. */
        val EXAMPLE_FILE = hex(
            """
            53484b42414b01b19d376f05776174657253484b010328505152535455565758
            595a5b5c5d5e5f606162636465666768696a6b6c6d6e6ff0f1f2f3f4f5f654bf
            5afdd024a27da06faf28e79405d2d1f5e525868e2b70286a5e7254ec1d435d10
            bac2edf4e76756382f3ad3cee77a933c3899a20b996ee737ad101333fe825b61
            e6dc37ca14b88d0e8f7cf7f904652d82e223b8facd0d855e71b0f2418c453041
            5e32c2d65b27a3e44cd6f7429b2f3a2e681ddac04cc80bcff9de0f170d382af6
            152f94342eddae83e6a8aa5cccbf8628c6e44fb670400e91100fa706d75097dc
            4dadcdbcf95ba25f735fb39515cd8a1bd7cffdf331b729b27eb65f03171ef7c1
            15e348425c6ae05c4c8314e59e8e339ef5c152a5fd0238a4f11bc5ad7bc9d3e8
            6b20c0e961128d775dc4395bbee7001cda7f075a04b386dffd9099976b23247e
            14d19c5565ebff33f0440bf5c46fefeb054829bafcb68f68ddbc3d8e7610a8d3
            0d3c96c510af78397016a35b216e7e2873b07f44070eac5f118c3d1c2e9b89dc
            899b22808e26
            """,
        )
    }
}
