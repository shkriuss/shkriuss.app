package app.shkriuss.tasks

import android.app.Application
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.security.AppLockWatcher
import app.shkriuss.core.security.SecurityHost
import app.shkriuss.feature.tasks.TasksHost
import app.shkriuss.feature.tasks.TasksServices
import app.shkriuss.feature.tasks.data.TasksDatabase

/**
 * The app class of Tasks. It builds the one [ShkCrypto], the one
 * [AppLockWatcher] and the one [TasksServices] of the app, and hands them
 * to the screens, which Android creates itself
 * (docs/architecture/security-screens.md, "What an app does").
 */
class TasksApp : Application(), SecurityHost, TasksHost {
    override val crypto: ShkCrypto by lazy { ShkCrypto.create(this, TasksServices.APP_NAME).also { it.start() } }

    // Tasks shows no notification yet, so there is none whose text the app lock must hide.
    override val appLock: AppLockWatcher by lazy { AppLockWatcher(this, crypto, onTextHidden = {}) }

    override val tasks: TasksServices by lazy {
        TasksServices(this, TasksDatabase.open(this), Clock.System, IdSource.RandomUuid)
    }

    override fun onCreate() {
        super.onCreate()
        // Before any screen starts, so that every screen's gate knows it (AppLockGate).
        appLock.start()
    }
}
