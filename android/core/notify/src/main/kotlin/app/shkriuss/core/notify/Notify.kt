package app.shkriuss.core.notify

import android.Manifest
import android.content.Context
import android.content.Intent
import android.provider.Settings
import app.shkriuss.core.data.Clock
import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * The app class of an app that uses `core/notify` implements this.
 * Android creates the receivers of `core/notify` itself, so nothing can
 * be passed to them through a constructor. They reach the app's one
 * [Notify] through the app class instead.
 */
interface NotifyHost {
    /** The app's one [Notify], built when the app starts. */
    val notify: Notify
}

/**
 * Alarms and notifications of one app. An app builds one when it starts,
 * in its app class, and calls [start]. Nothing else in the suite talks to
 * Android's `AlarmManager` or `NotificationManager` (CLAUDE.md).
 *
 * - The app names its alarms through [AlarmSource] and calls [sync]
 *   after every change to them. `core/notify` registers them again by
 *   itself after a reboot, an app update and a change of the time or the
 *   time zone.
 * - When an alarm fires, the app's [AlarmHandler] runs and shows a
 *   notification through [notifications].
 * - A screen learns from [state] whether the user allows that
 *   notification.
 *
 * [channels] are all channels of the app. [hidesText] answers whether a
 * notification must hide its title and text now, because the app lock
 * is on. It has no default, so that no app can forget it: an app with
 * the app lock passes `AppLockWatcher.hidesNotificationText`, an app
 * without one passes `{ false }` and says so. [worker] runs everything
 * that reads the app's records, one piece at a time. The default is one
 * background thread. The design is in
 * docs/architecture/notifications.md.
 */
class Notify(
    context: Context,
    private val channels: List<NotifyChannel>,
    source: AlarmSource,
    handler: AlarmHandler,
    clock: Clock,
    hidesText: () -> Boolean,
    scheduler: AlarmScheduler = AlarmManagerScheduler(context.applicationContext),
    private val worker: Executor = Executors.newSingleThreadExecutor { Thread(it, "core-notify") },
) {
    private val app = context.applicationContext
    private val preferences = app.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    /** Shows and removes notifications. */
    val notifications = Notifications(app, hidesText)

    private val alarms = AlarmSync(source, handler, notifications, scheduler, AlarmRegistry(preferences), clock)

    /**
     * Call once when the app starts. It tells Android the channels and
     * registers the alarms. The alarms are read on [worker], so this
     * returns at once.
     *
     * It fails if the app class is no [NotifyHost]: the receivers could
     * not find this object then.
     */
    fun start() {
        check(app is NotifyHost) { "The app class must implement NotifyHost" }
        notifications.createChannels(channels)
        // Android may have dropped the alarms since the app last ran.
        worker.execute { alarms.sync(setAll = true) }
    }

    /**
     * Call after every change to the app's alarms: a reminder was added,
     * changed, done or deleted, or a backup was restored. It asks the
     * [AlarmSource] and makes Android's alarms match, on [worker].
     */
    fun sync() = worker.execute { alarms.sync(setAll = false) }

    /**
     * Call when the notifications must hide their text from now on: the
     * app lock was turned on, or the user turned its notification text
     * off. The notifications already shown are posted again in the hidden
     * form, so no old text stays in the notification shade. It runs on
     * [worker], after any alarm handler that is running, and does nothing
     * if `hidesText` says no by then.
     */
    fun hideShownText() = worker.execute { notifications.hideShown(channels) }

    /** What a screen shows about notifications of [channel]. See [NotifyState]. */
    fun state(channel: NotifyChannel): NotifyState = when {
        !notifications.allowed() -> if (preferences.getBoolean(ASKED, false)) NotifyState.Denied else NotifyState.NotAsked
        notifications.isOff(channel) -> NotifyState.ChannelOff
        else -> NotifyState.Ready
    }

    /**
     * Call when Android's question for [PERMISSION] is answered, with yes
     * or with no. From then on a missing permission is
     * [NotifyState.Denied], and the app does not ask again.
     */
    fun permissionAnswered() = preferences.edit().putBoolean(ASKED, true).apply()

    /**
     * The page of Android's settings where the user allows what [state]
     * says is off: the channel's page for [NotifyState.ChannelOff], the
     * app's notification page otherwise. Start it as an activity.
     */
    fun settingsIntent(channel: NotifyChannel): Intent =
        if (state(channel) == NotifyState.ChannelOff) {
            Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_CHANNEL_ID, channel.id)
        } else {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        }.putExtra(Settings.EXTRA_APP_PACKAGE, app.packageName)

    /** An alarm fired. [done] runs when the app has handled it. */
    internal fun alarmFired(id: AlarmId, done: () -> Unit) = worker.execute {
        try {
            alarms.fired(id)
        } finally {
            done()
        }
    }

    /** Android forgot the alarms, or the time moved. [done] runs when they are registered again. */
    internal fun systemEvent(done: () -> Unit) = worker.execute {
        try {
            alarms.sync(setAll = true)
        } finally {
            done()
        }
    }

    companion object {
        /**
         * The permission a screen asks the user for before reminders can
         * show. It is the only one of this module's three that Android
         * asks the user about (docs/security/permissions.md).
         */
        const val PERMISSION: String = Manifest.permission.POST_NOTIFICATIONS

        /** The file of `core/notify` in the app's private storage. */
        private const val STORE = "app.shkriuss.core.notify"
        private const val ASKED = "permission-asked"
    }
}
