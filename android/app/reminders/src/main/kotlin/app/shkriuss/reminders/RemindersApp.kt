package app.shkriuss.reminders

import android.app.Application
import android.content.Intent
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.notify.Notify
import app.shkriuss.core.notify.NotifyHost
import app.shkriuss.core.security.AppLockWatcher
import app.shkriuss.core.security.SecurityHost
import app.shkriuss.feature.reminders.RemindersAlarms
import app.shkriuss.feature.reminders.RemindersHost
import app.shkriuss.feature.reminders.RemindersServices
import app.shkriuss.feature.reminders.data.RemindersDatabase

/**
 * The app class of Reminders. It builds the one [ShkCrypto], the one
 * [AppLockWatcher], the one [RemindersServices] and the one [Notify] of
 * the app, and hands them to the screens and the receivers, which Android
 * creates itself (docs/architecture/security-screens.md, "What an app
 * does", and docs/architecture/notifications.md, "What an app does").
 * [RemindersServices] builds the app's `Backups` with the backup keys of
 * [crypto], and [onCreate] starts it (docs/architecture/backup-format.md,
 * "Staging").
 */
class RemindersApp : Application(), SecurityHost, RemindersHost, NotifyHost {
    override val crypto: ShkCrypto by lazy { ShkCrypto.create(this, RemindersServices.APP_NAME).also { it.start() } }

    override val appLock: AppLockWatcher by lazy {
        // When the app lock starts to hide the text, the reminders already shown are posted again without it.
        AppLockWatcher(this, crypto, onTextHidden = { notify.hideShownText() })
    }

    override val reminders: RemindersServices by lazy {
        RemindersServices(
            this,
            RemindersDatabase.open(this),
            Clock.System,
            IdSource.RandomUuid,
            openReminders(),
            notify = { notify },
            crypto = crypto,
        )
    }

    override val notify: Notify by lazy {
        Notify(
            this,
            listOf(RemindersAlarms.CHANNEL),
            reminders.alarms,
            reminders.alarms,
            Clock.System,
            hidesText = appLock::hidesNotificationText,
            buttons = reminders.alarms,
            review = reminders.alarms,
        )
    }

    override fun onCreate() {
        super.onCreate()
        // Before any screen starts, so that every screen's gate knows it (AppLockGate).
        appLock.start()
        // Backups.start(): empties what a restore left behind when the app stopped in the middle of it. Then, off the
        // main thread, a pending move of the file keys is finished (docs/apps/water/spec.md, "Files").
        reminders.start()
        // Tells Android the channel and registers the alarms again: Android may have dropped them.
        notify.start()
    }

    /**
     * What a tap on a reminder opens: Reminders, with the form of that
     * reminder (docs/apps/reminders/spec.md, "The notification", point 6).
     * `core/notify` puts the reminder's `id` on it as its identifier. The
     * screen starts anew in its own task, so it opens on the list the
     * reminder is in, also when Reminders was open on another one.
     */
    private fun openReminders(): Intent =
        Intent(this, RemindersActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
}
