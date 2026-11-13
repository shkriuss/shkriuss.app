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
 *
 * While [hidesText] says yes, a notification shows only the name of its
 * channel and a fixed text, never the title and text the app gave it
 * (docs/architecture/notifications.md). If [hidesText] fails, the text
 * is hidden too.
 */
class Notifications internal constructor(
    private val context: Context,
    private val hidesText: () -> Boolean,
) {
    private val manager = context.getSystemService(NotificationManager::class.java)

    /**
     * Shows [notification], or replaces the one with the same key.
     *
     * On a locked screen Android shows its text only if the user lets
     * the lock screen show all notification content. While the app lock
     * hides the text, the notification shows the channel's name and
     * "The app lock hides this notification" instead, everywhere.
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
        val hidden = mustHide()
        val built = builder(notification.channel.id, notification.atMillis, tap)
            .setSmallIcon(notification.smallIcon)
            .setContentTitle(if (hidden) context.getString(notification.channel.name) else notification.title)
            .setContentText(if (hidden) context.getString(R.string.notify_text_hidden) else notification.text)
            .build()
        manager.notify(notification.key, NOTIFICATION_ID, built)
    }

    /**
     * Posts every notification of [channels] that is on screen again, in
     * the hidden form: the same key, tap target, icon and time, and no new
     * sound or vibration. Does nothing if the text is not to be hidden.
     */
    internal fun hideShown(channels: List<NotifyChannel>) {
        if (!mustHide()) return
        manager.activeNotifications.forEach { shown ->
            val old = shown.notification
            val channel = channels.firstOrNull { it.id == old.channelId } ?: return@forEach
            val built = builder(channel.id, old.`when`, old.contentIntent)
                .setSmallIcon(old.smallIcon)
                .setContentTitle(context.getString(channel.name))
                .setContentText(context.getString(R.string.notify_text_hidden))
                .setOnlyAlertOnce(true)
                .build()
            manager.notify(shown.tag, shown.id, built)
        }
    }

    /** True if the text must be hidden now. An answer that cannot be had counts as yes. */
    private fun mustHide(): Boolean = try {
        hidesText()
    } catch (_: Exception) {
        true
    }

    /** The parts every notification of the suite shares. */
    private fun builder(channelId: String, atMillis: Long, tap: PendingIntent?): Notification.Builder =
        Notification.Builder(context, channelId)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setWhen(atMillis)
            .setShowWhen(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PRIVATE)

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
