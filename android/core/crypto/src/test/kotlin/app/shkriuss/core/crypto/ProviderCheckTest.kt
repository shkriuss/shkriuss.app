package app.shkriuss.core.crypto

import java.security.Provider
import java.security.Security
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * No Play services provider ("No Play services provider" in
 * crypto-design.md, item 8 of "What the tests must cover"): `core/crypto`
 * refuses to work if a provider named `GmsCore_OpenSSL` is installed. This
 * test installs a fake one and expects the refusal.
 */
class ProviderCheckTest {
    @get:Rule
    val temporary = TemporaryFolder()

    /** A provider with the name of the one that Play services installs. It offers nothing. */
    private class FakePlayServicesProvider : Provider("GmsCore_OpenSSL", 1.0, "A fake for the test")

    @After
    fun removeTheFake() {
        Security.removeProvider("GmsCore_OpenSSL")
    }

    @Test
    fun everyWayInRefusesWhileTheProviderIsInstalled() {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        val key = TestKeys.vectorRecoveryKey()
        val words = key.words().joinToString(" ")
        crypto.setup.storeDerivedKeys(key)
        val fileKey = crypto.files.newFileKey()
        val id = "00112233-4455-4677-8899-aabbccddeeff"
        val sealed = crypto.records.seal(id, ByteArray(4))

        Security.addProvider(FakePlayServicesProvider())

        val waysIn = mapOf<String, () -> Unit>(
            "seal a record" to { crypto.records.seal(id, ByteArray(4)) },
            "open a record" to { crypto.records.open(id, sealed) },
            "make a file key" to { crypto.files.newFileKey() },
            "wrap a file key" to { crypto.files.wrap(id, fileKey) },
            "encrypt a file" to { TestKeys.encryptFile(fileKey, id, ByteArray(4)) },
            "read a backup's key ID" to { crypto.backups.keyId() },
            "create a recovery key" to { crypto.setup.createRecoveryKey() },
            "read the words" to { RecoveryWords.parse(words) },
            "store derived keys" to { crypto.setup.storeDerivedKeys(key) },
            "read the app lock state" to { crypto.appLock.state() },
            "read the status" to { crypto.status() },
            "start" to { app.open() },
        )
        waysIn.forEach { (what, way) ->
            try {
                way()
                fail("$what worked next to a Play services provider")
            } catch (_: PlayServicesProviderException) {
                // core/crypto refuses to work.
            }
        }
    }

    @Test
    fun withoutTheProviderEverythingWorksAgain() {
        Security.addProvider(FakePlayServicesProvider())
        try {
            RecoveryWords.parse(TestKeys.vectorRecoveryKey().words().joinToString(" "))
            fail("worked next to a Play services provider")
        } catch (_: PlayServicesProviderException) {
            // Refused.
        }
        Security.removeProvider("GmsCore_OpenSSL")

        assertNotNull(TestKeys.vectorRecoveryKey().words())
        assertEquals("b19d376f", TestKeys.vectorRecoveryKey().keyId.toString())
    }
}
