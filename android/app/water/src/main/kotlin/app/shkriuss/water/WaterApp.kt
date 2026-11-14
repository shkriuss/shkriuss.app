package app.shkriuss.water

import android.app.Application
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.security.AppLockWatcher
import app.shkriuss.core.security.SecurityHost
import app.shkriuss.feature.water.WaterHost
import app.shkriuss.feature.water.WaterServices
import app.shkriuss.feature.water.data.WaterDatabase

/**
 * The app class of Water. It builds the one [ShkCrypto], the one
 * [AppLockWatcher] and the one [WaterServices] of the app, and hands them
 * to the screens, which Android creates itself
 * (docs/architecture/security-screens.md, "What an app does").
 *
 * Step 2.4 adds `NotifyHost` with its `Notify`, and step 2.5 `Backups`.
 */
class WaterApp : Application(), SecurityHost, WaterHost {
    override val crypto: ShkCrypto by lazy { ShkCrypto.create(this, AppName.of(APP_NAME)).also { it.start() } }

    override val appLock: AppLockWatcher by lazy {
        // Water shows no notification before step 2.4, which passes { notify.hideShownText() } here.
        AppLockWatcher(this, crypto, onTextHidden = {})
    }

    override val water: WaterServices by lazy {
        WaterServices(WaterDatabase.open(this), Clock.System, IdSource.RandomUuid)
    }

    override fun onCreate() {
        super.onCreate()
        // Before any screen starts, so that every screen's gate knows it (AppLockGate).
        appLock.start()
    }

    private companion object {
        /** The name of the app in keys and backups (docs/apps/water/spec.md). */
        const val APP_NAME = "water"
    }
}
