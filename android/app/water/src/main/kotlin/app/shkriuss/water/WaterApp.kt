package app.shkriuss.water

import android.app.Application
import android.content.Intent
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.notify.Notify
import app.shkriuss.core.notify.NotifyHost
import app.shkriuss.core.security.AppLockWatcher
import app.shkriuss.core.security.SecurityHost
import app.shkriuss.feature.water.WaterHost
import app.shkriuss.feature.water.WaterReminders
import app.shkriuss.feature.water.WaterServices
import app.shkriuss.feature.water.data.WaterDatabase

/**
 * The app class of Water. It builds the one [ShkCrypto], the one
 * [AppLockWatcher], the one [WaterServices] and the one [Notify] of the
 * app, and hands them to the screens and the receivers, which Android
 * creates itself (docs/architecture/security-screens.md, "What an app
 * does", and docs/architecture/notifications.md, "What an app does").
 * [WaterServices] builds the app's `Backups` with the backup keys of
 * [crypto], and [onCreate] starts it (docs/architecture/backup-format.md,
 * "Staging").
 */
class WaterApp : Application(), SecurityHost, WaterHost, NotifyHost {
    override val crypto: ShkCrypto by lazy { ShkCrypto.create(this, WaterServices.APP_NAME).also { it.start() } }

    override val appLock: AppLockWatcher by lazy {
        // When the app lock starts to hide the text, the reminder already shown is posted again without it.
        AppLockWatcher(this, crypto, onTextHidden = { notify.hideShownText() })
    }

    override val water: WaterServices by lazy {
        WaterServices(this, WaterDatabase.open(this), Clock.System, IdSource.RandomUuid, openToday(), notify = { notify }, crypto = crypto)
    }

    override val notify: Notify by lazy {
        Notify(
            this,
            listOf(WaterReminders.CHANNEL),
            water.reminders,
            water.reminders,
            Clock.System,
            hidesText = appLock::hidesNotificationText,
            buttons = water.reminders,
        )
    }

    override fun onCreate() {
        super.onCreate()
        // Before any screen starts, so that every screen's gate knows it (AppLockGate).
        appLock.start()
        // Backups.start(): empties what a restore left behind when the app stopped in the middle of it. Then, off the
        // main thread, a pending move of the file keys is finished (docs/apps/water/spec.md, "Files").
        water.start()
        // Tells Android the channel and registers the alarm again: Android may have dropped it.
        notify.start()
    }

    /**
     * What a tap on a reminder opens: Water on Today (spec, "What a reminder
     * shows"). The screen starts anew in its own task, so it is on Today
     * even when Water was open on another destination.
     */
    private fun openToday(): Intent =
        Intent(this, WaterActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
}
