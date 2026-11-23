package app.shkriuss.tasks

import android.app.Application
import android.content.Intent
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.notify.Notify
import app.shkriuss.core.notify.NotifyHost
import app.shkriuss.core.security.AppLockWatcher
import app.shkriuss.core.security.SecurityHost
import app.shkriuss.feature.tasks.TasksAlarms
import app.shkriuss.feature.tasks.TasksHost
import app.shkriuss.feature.tasks.TasksServices
import app.shkriuss.feature.tasks.data.TasksDatabase

/**
 * The app class of Tasks. It builds the one [ShkCrypto], the one
 * [AppLockWatcher], the one [TasksServices] and the one [Notify] of the
 * app, and hands them to the screens and the receivers, which Android
 * creates itself (docs/architecture/security-screens.md, "What an app
 * does", and docs/architecture/notifications.md, "What an app does").
 */
class TasksApp : Application(), SecurityHost, TasksHost, NotifyHost {
    override val crypto: ShkCrypto by lazy { ShkCrypto.create(this, TasksServices.APP_NAME).also { it.start() } }

    override val appLock: AppLockWatcher by lazy {
        // When the app lock starts to hide the text, the reminders already shown are posted again without it.
        AppLockWatcher(this, crypto, onTextHidden = { notify.hideShownText() })
    }

    override val tasks: TasksServices by lazy {
        TasksServices(this, TasksDatabase.open(this), Clock.System, IdSource.RandomUuid, openTasks(), notify = { notify })
    }

    override val notify: Notify by lazy {
        Notify(
            this,
            listOf(TasksAlarms.CHANNEL),
            tasks.alarms,
            tasks.alarms,
            Clock.System,
            hidesText = appLock::hidesNotificationText,
            buttons = tasks.alarms,
            review = tasks.alarms,
        )
    }

    override fun onCreate() {
        super.onCreate()
        // Before any screen starts, so that every screen's gate knows it (AppLockGate).
        appLock.start()
        // Tells Android the channel and registers the alarms again: Android may have dropped them.
        notify.start()
    }

    /**
     * What a tap on a reminder opens: Tasks, on the task's list with its
     * form open (docs/apps/tasks/spec.md, "The notification", point 2).
     * `core/notify` puts the task's `id` on it as its identifier. The
     * screen starts anew in its own task, so it opens on that list, also
     * when Tasks was open on another screen.
     */
    private fun openTasks(): Intent =
        Intent(this, TasksActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
}
