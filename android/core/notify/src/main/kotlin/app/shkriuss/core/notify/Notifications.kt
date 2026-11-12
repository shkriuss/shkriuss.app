package app.shkriuss.core.notify

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

/**
 * One notification to show.
 *
 * [key] names it inside the app, usually the `id` of its record. Showing
 * a notification with a key that is already on screen replaces that one.
 * [title] and [text] are user content: they go to Android to be shown and
 * nowhere else. [smallIcon] is a drawable resource of the app, in one
 * colour. [open] is the screen of this app that a tap opens, as an
 * explicit intent. [atMillis] is the time the notification shows, usually
 * the time of the alarm.
 */
class ShkNotification(
    val key: String,
    val channel: NotifyChannel,
    val title: String,
    val text: String?,
    val smallIcon: Int,
    val open: Intent,
    val atMillis: Long,
)

/**
 * Shows and removes the notifications of an app. The only place in the
 * suite that talks to Android's `NotificationManager` (CLAUDE.md).
 *
 * Nothing here checks whether the user allows notifications. Android
 * drops a notification that is not allowed without an error. A screen
 * finds out with `Notify.state`.
 */
class Notifications internal constructor(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)

    /**
     * Shows [notification], or replaces the one with the same key.
     *
     * On a locked screen Android shows its text only if the user lets
     * the lock screen show all notification content.
     */
    fun show(notification: ShkNotification) {
        require(notification.open.component?.packageName == context.packageName) {
            "A notification opens a screen of this app, named by an explicit intent"
        }
        // The identifier makes Android keep one tap target for each key.
        val tap = PendingIntent.getActivity(
            context,
            0,
            Intent(notification.open).setIdentifier(notification.key),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val built = Notification.Builder(context, notification.channel.id)
            .setSmallIcon(notification.smallIcon)
            .setContentTitle(notification.title)
            .setContentText(notification.text)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setWhen(notification.atMillis)
            .setShowWhen(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .build()
        manager.notify(notification.key, NOTIFICATION_ID, built)
    }

    /** Removes the notification with this key. Nothing happens if there is none. */
    fun cancel(key: String) = manager.cancel(key, NOTIFICATION_ID)

    /**
     * Tells Android about [channels]. Safe to repeat: a channel that
     * exists keeps the user's choices and only takes the new name and
     * description, for example after a change of language.
     */
    internal fun createChannels(channels: List<NotifyChannel>) {
        manager.createNotificationChannels(
            channels.map { channel ->
                NotificationChannel(channel.id, context.getString(channel.name), channel.importance.level).apply {
                    description = context.getString(channel.description)
                    lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                }
            },
        )
    }

    /** True if the user allows this app to show notifications at all. */
    internal fun allowed(): Boolean = manager.areNotificationsEnabled()

    /** True if the user turned this one channel off. */
    internal fun isOff(channel: NotifyChannel): Boolean =
        manager.getNotificationChannel(channel.id)?.importance == NotificationManager.IMPORTANCE_NONE

    private companion object {
        /** Notifications are told apart by their key, the tag, alone. */
        const val NOTIFICATION_ID = 0
    }
}
