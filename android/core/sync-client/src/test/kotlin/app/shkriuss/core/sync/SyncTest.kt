package app.shkriuss.core.sync

import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.testing.TestClock
import org.junit.After
import org.junit.Rule
import org.junit.rules.TemporaryFolder

/**
 * What the tests of sync share: a server, a clock, one recovery key, and
 * devices that are closed at the end.
 */
abstract class SyncTest {
    @get:Rule
    val temporary = TemporaryFolder()

    val clock = TestClock()
    private val devices = mutableListOf<TestDevice>()

    /** The recovery key of the account. */
    val recoveryKey: RecoveryKey by lazy { SoftwareKeysApp(temporary.newFolder(), AppName.of("lists")).crypto.setup.createRecoveryKey() }

    private val accountKeyId by lazy {
        SoftwareKeysApp(temporary.newFolder(), LISTS).also { it.crypto.setup.storeDerivedKeys(recoveryKey) }.crypto.records.keyIds().current
    }

    private var currentServer: TestServer? = null

    /** The server that new devices join. */
    val server: TestServer get() = currentServer ?: newServer()

    /** A new, empty server for the devices made from now on. */
    fun newServer(): TestServer = TestServer(accountKeyId).also { currentServer = it }

    /** A new device with Lists, sync on. */
    suspend fun device(
        name: String,
        dataVersion: Int = 1,
        wipes: Boolean = true,
        key: RecoveryKey = recoveryKey,
        on: Boolean = true,
        seed: Int = devices.size + 1,
    ): TestDevice {
        val device = TestDevice(name, temporary.newFolder(name), key, server, clock, seed, dataVersion, wipes)
        devices += device
        if (on) device.client.setOn(true)
        return device
    }

    /** The same phone after an update of Lists to [dataVersion]: its database, keys and files stay. */
    fun updated(device: TestDevice, dataVersion: Int): TestDevice {
        val next = TestDevice(device.name, temporary.root.resolve(device.name), recoveryKey, server, clock, 99, dataVersion, from = device)
        next.epoch = device.epoch
        return next
    }

    @After
    fun closeDevices() {
        devices.forEach { it.close() }
    }
}
