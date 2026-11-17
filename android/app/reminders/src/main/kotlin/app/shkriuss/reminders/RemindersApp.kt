package app.shkriuss.reminders

import android.app.Application
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.security.AppLockWatcher
import app.shkriuss.core.security.SecurityHost
import app.shkriuss.feature.reminders.RemindersHost
import app.shkriuss.feature.reminders.RemindersServices
import app.shkriuss.feature.reminders.data.RemindersDatabase

/**
 * The app class of Reminders. It builds the one [ShkCrypto], the one
 * [AppLockWatcher] and the one [RemindersServices] of the app, and hands
 * them to the screens, which Android creates itself
 * (docs/architecture/security-screens.md, "What an app does").
 */
class RemindersApp : Application(), SecurityHost, RemindersHost {
    override val crypto: ShkCrypto by lazy { ShkCrypto.create(this, RemindersServices.APP_NAME).also { it.start() } }

    // Reminders shows no notification yet, so there is none whose text the app lock must hide.
    override val appLock: AppLockWatcher by lazy { AppLockWatcher(this, crypto, onTextHidden = {}) }

    override val reminders: RemindersServices by lazy {
        RemindersServices(this, RemindersDatabase.open(this), Clock.System, IdSource.RandomUuid)
    }

    override fun onCreate() {
        super.onCreate()
        // Before any screen starts, so that every screen's gate knows it (AppLockGate).
        appLock.start()
    }
}
