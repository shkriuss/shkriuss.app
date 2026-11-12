package app.shkriuss.core.backup

import app.shkriuss.core.crypto.RecoveryWords
import app.shkriuss.core.crypto.RecoveryWordsResult
import app.shkriuss.core.data.RecordFields
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The example file of docs/architecture/backup-format.md is read as a
 * backup, with the keys of the recovery words that the vectors of
 * crypto-design.md use (item 11 of "What the tests must cover").
 *
 * The bytes were not made by this module. `BackupExampleFileTest` in
 * `core/crypto` builds them a second time, from the values of the page,
 * with code that shares nothing with the real stream.
 */
class ExampleFileTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private lateinit var device: Device

    @Before
    fun anAppWithTheRecoveryKeyOfTheVectors() {
        device = Device(temporary)
        val words = RecoveryWords.parse(VECTOR_WORDS) as RecoveryWordsResult.Accepted
        device.giveKeys(words.recoveryKey)
        assertEquals("b19d376f", device.keys.crypto.backups.keyId().toString())
    }

    @Test
    fun theExampleFileIsAGoodBackup() {
        assertEquals(390, EXAMPLE_FILE.size)

        assertEquals(CheckResult.Good(SUMMARY), device.check(EXAMPLE_FILE))
    }

    @Test
    fun theExampleFileRestoresToWhatThePageSays() {
        assertEquals(RestoreResult.Restored(SUMMARY), device.restore(EXAMPLE_FILE))

        val made = 1_767_225_600_000L
        val expected = listOf(
            Triple(RecordFields("00112233-4455-4677-8899-aabbccddeeff", made, made + 60_000, null), "example", "backup record test"),
            Triple(RecordFields("0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff", made + 120_000, made + 120_000, null), "example", "file record test"),
            Triple(RecordFields("fedcba98-7654-4321-8fed-cba987654321", made, made + 180_000, made + 180_000), "example", ""),
        )
        assertEquals(expected, device.app.records.values.map { Triple(it.fields, it.type, String(it.content, Charsets.US_ASCII)) })
        assertEquals(listOf("0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"), device.app.fileIds())
        assertEquals(sha256(FILE_STREAM), device.app.snapshot().getValue("file 0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"))
    }

    @Test
    fun theExampleFileIsRefusedWithOneByteChangedOrCut() {
        val changed = EXAMPLE_FILE.copyOf().also { it[200] = (it[200].toInt() xor 0x01).toByte() }

        assertEquals(BackupAnswer.Damaged, device.answerOf(changed))
        assertEquals(BackupAnswer.Damaged, device.answerOf(EXAMPLE_FILE.copyOf(EXAMPLE_FILE.size - 17)))
    }

    private companion object {
        /** The words of the recovery key `00 01 ... 1f`, from crypto-design.md. */
        const val VECTOR_WORDS = "abandon amount liar amount expire adjust cage candy " +
            "arch gather drum bullet absurd math era live " +
            "bid rhythm alien crouch range attend journey unaware"

        /** Made on 2026-01-01 at 01:00 UTC, with three records and one file. */
        val SUMMARY = BackupSummary(dataVersion = 1, madeAt = 1_767_229_200_000L, records = 3, files = 1)

        /** The file stream "file stream test" of the vectors in crypto-design.md, 77 bytes. */
        val FILE_STREAM = hex(
            """
            53484b010228606162636465666768696a6b6c6d6e6f70717273747576777879
            7a7b7c7d7e7f101112131415169a858c7fe385e11df99795433c2849a9996fb1
            94fa42f38705612211e018459a
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
