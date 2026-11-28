package app.shkriuss.sync

import android.app.Application
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.feature.sync.SyncHost
import app.shkriuss.feature.sync.SyncServices

/**
 * The app class of Sync. It builds the one [ShkCrypto] and the one
 * [SyncServices] of the app, and hands them to the parts Android creates
 * itself: the screen, the job service and the courier provider. At each
 * start, Sync's checks run (docs/apps/sync/spec.md, "Stopped between two
 * writes"), after the cleanup of `core/crypto`.
 */
open class SyncApp : Application(), SyncHost {
    /** The cryptography of the app name `sync`: the device key and the name key. */
    open val crypto: ShkCrypto by lazy { ShkCrypto.create(this, APP_NAME).also { it.start() } }

    override val sync: SyncServices by lazy { SyncServices.create(this, crypto) }

    override fun onCreate() {
        super.onCreate()
        sync.start()
    }

    private companion object {
        val APP_NAME: AppName = AppName.of("sync")
    }
}
