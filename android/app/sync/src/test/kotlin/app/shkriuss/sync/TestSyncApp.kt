package app.shkriuss.sync

import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import java.io.File

/**
 * Sync's app class for the tests: the real services, with the keys on the
 * stand-in for the Keystore (ADR 0029), since Robolectric has no Android
 * Keystore.
 */
class TestSyncApp : SyncApp() {
    override val crypto: ShkCrypto by lazy { SoftwareKeysApp(File(noBackupFilesDir, "shk-keys"), AppName.of("sync")).crypto }
}
