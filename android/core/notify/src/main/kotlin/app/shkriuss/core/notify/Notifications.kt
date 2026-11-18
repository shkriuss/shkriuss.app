package app.shkriuss.core.notify

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Bundle
import app.shkriuss.core.data.Clock

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
 *
 * [buttons] are at most three buttons (ADR 0034). They show only while
 * the text is shown. [endsAtMillis], if set, is the moment Android
 * removes the notification by itself, such as the next midnight, so that
 * yesterday's numbers never show as today's.
 */
class ShkNotification(
    val key: String,
    val channel: NotifyChannel,
    val title: String,
    val text: String?,
    val smallIcon: Int,
    val open: Intent,
    val atMillis: Long,
    val buttons: List<ShkNotificationButton> = emptyList(),
    val endsAtMillis: Long? = null,
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
 * channel and a fixed text, never the title and text the app gave it, and
 * no buttons (docs/architecture/notifications.md, ADR 0034). If
 * [hidesText] fails, the text is hidden too. [takesPresses] is true when
 * the app gave `Notify` a [ButtonHandler]: only then may a notification
 * have buttons. [pause] waits for a number of milliseconds, between the
 * posts of [hideShown].
 */
class Notifications internal constructor(
    private val context: Context,
    private val hidesText: () -> Boolean,
    private val clock: Clock,
    private val takesPresses: Boolean = false,
    private val pause: (millis: Long) -> Unit = Thread::sleep,
) {
    private val manager = context.getSystemService(NotificationManager::class.java)

    /**
     * Shows [notification], or replaces the one with the same key.
     *
     * On a locked screen Android shows its text only if the user lets
     * the lock screen show all notification content. While the app lock
     * hides the text, the notification shows the channel's name and
     * "The app lock hides this notification" instead, everywhere, with no
     * buttons. Each button asks Android for the phone's unlock before it
     * runs (ADR 0034, point 2).
     *
     * A notification whose [ShkNotification.endsAtMillis] has passed is
     * not shown, and one with the same key is removed.
     */
    fun show(notification: ShkNotification) {
        require(notification.open.component?.packageName == context.packageName) {
            "A notification opens a screen of this app, named by an explicit intent"
        }
        require(notification.buttons.size <= MOST_BUTTONS) { "A notification has at most $MOST_BUTTONS buttons" }
        require(notification.buttons.map { it.action }.toSet().size == notification.buttons.size) {
            "Each button of a notification has its own action"
        }
        require(notification.buttons.isEmpty() || takesPresses) {
            "An app that puts buttons on its notifications passes a ButtonHandler to Notify"
        }
        val endsAt = notification.endsAtMillis
        if (endsAt != null && endsAt <= clock.nowMillis()) {
            cancel(notification.key)
            return
        }
        // The identifier makes Android keep one tap target for each key.
        val tap = PendingIntent.getActivity(
            context,
            0,
            Intent(notification.open).setIdentifier(notification.key),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val hidden = mustHide()
        val builder = builder(notification.channel.id, notification.atMillis, tap, endsAt)
            .setSmallIcon(notification.smallIcon)
            .setContentTitle(if (hidden) context.getString(notification.channel.name) else notification.title)
            .setContentText(if (hidden) context.getString(R.string.notify_text_hidden) else notification.text)
        if (hidden) builder.addExtras(Bundle().apply { putBoolean(EXTRA_HIDDEN, true) })
        // No buttons while the text is hidden: a label such as "Drank 250 ml" can show what the app lock hides.
        if (!hidden) notification.buttons.forEach { builder.addAction(action(notification, it)) }
        manager.notify(notification.key, NOTIFICATION_ID, builder.build())
    }

    /**
     * Posts every notification of [channels] that is on screen again, in
     * the hidden form: the same key, tap target, icon, time and end, no
     * buttons, and no new sound or vibration. One that is in the hidden
     * form already stays as it is. Does nothing if the text is not to be
     * hidden.
     *
     * Android drops an update of a notification that comes when an app
     * posts more than about five a second, and the old text stays. So the
     * posts come [PACE_MILLIS] apart. Each is read again just before it is
     * posted: during a pause the app may have removed it, for example for
     * a deleted reminder, and it must not come back. Then, after
     * [SETTLE_MILLIS], any of them that still shows the old form is
     * removed: the text must leave the notification shade, also at the
     * cost of the notification.
     */
    internal fun hideShown(channels: List<NotifyChannel>) {
        if (!mustHide()) return
        var posted = 0
        val keys = manager.activeNotifications.map { it.tag to it.id }
        keys.forEach { (tag, id) ->
            if (posted > 0) pause(PACE_MILLIS)
            val shown = manager.activeNotifications.firstOrNull { it.tag == tag && it.id == id } ?: return@forEach
            val old = shown.notification
            val channel = channels.firstOrNull { it.id == old.channelId } ?: return@forEach
            val endsAt = old.extras.getLong(EXTRA_ENDS_AT, 0L).takeIf { it > 0L }
            if (endsAt != null && endsAt <= clock.nowMillis()) {
                manager.cancel(shown.tag, shown.id)
                return@forEach
            }
            // Already hidden: nothing to post, and nothing to wait for. A start while the text is hidden waits for none.
            if (old.extras.getBoolean(EXTRA_HIDDEN, false)) return@forEach
            if (posted > 0) pause(PACE_MILLIS)
            // A new builder carries no button of the old notification.
            val built = builder(channel.id, old.`when`, old.contentIntent, endsAt)
                .setSmallIcon(old.smallIcon)
                .setContentTitle(context.getString(channel.name))
                .setContentText(context.getString(R.string.notify_text_hidden))
                .setOnlyAlertOnce(true)
                .addExtras(Bundle().apply { putBoolean(EXTRA_HIDDEN, true) })
                .build()
            manager.notify(shown.tag, shown.id, built)
            posted++
        }
        if (posted == 0) return
        pause(SETTLE_MILLIS)
        // Only while the text is still to be hidden: a notification shown since, with its text, stays.
        if (!mustHide()) return
        manager.activeNotifications
            .filter { shown -> channels.any { it.id == shown.notification.channelId } }
            .filterNot { it.notification.extras.getBoolean(EXTRA_HIDDEN, false) }
            .forEach { manager.cancel(it.tag, it.id) }
    }

    /**
     * Shows that the app could not show the reminder of [alarm], in its
     * place: the name of [channel] and the fixed text "A reminder could
     * not be shown. Open the app to see it.", with no buttons and nothing
     * of the app's own. Its key is the alarm's id, so the app's next
     * notification for that alarm replaces it. A tap starts the app anew
     * on its start screen, with the alarm's id as the intent's identifier,
     * as a tap on a reminder of the apps does: a screen of the app that is
     * open closes, so no second one opens on top of it. This is the
     * owner's decision (docs/architecture/notifications.md, "How alarms
     * are kept right").
     */
    internal fun showFailure(channel: NotifyChannel, alarm: Alarm) {
        val start = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val tap = start?.let {
            PendingIntent.getActivity(
                context,
                0,
                Intent(it).setIdentifier(alarm.id.value).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
        val built = builder(channel.id, alarm.atMillis, tap, endsAt = null)
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setContentTitle(context.getString(channel.name))
            .setContentText(context.getString(R.string.notify_reminder_failed))
            .build()
        manager.notify(alarm.id.value, NOTIFICATION_ID, built)
    }

    /** True if the text must be hidden now. An answer that cannot be had counts as yes. */
    internal fun mustHide(): Boolean = try {
        hidesText()
    } catch (_: Exception) {
        true
    }

    /** The parts every notification of the suite shares. */
    private fun builder(channelId: String, atMillis: Long, tap: PendingIntent?, endsAt: Long?): Notification.Builder {
        val builder = Notification.Builder(context, channelId)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setWhen(atMillis)
            .setShowWhen(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
        if (endsAt != null) {
            // Android counts the timeout from the moment it is posted, so the end is kept, to post it again with the same end.
            builder.setTimeoutAfter(endsAt - clock.nowMillis())
            builder.addExtras(Bundle().apply { putLong(EXTRA_ENDS_AT, endsAt) })
        }
        return builder
    }

    /**
     * One button: a broadcast to [ButtonReceiver] of this app, which no
     * other app can make. Android's own notification list sends it after
     * the phone's unlock. Its identifier keeps one pending intent for each
     * key, action and time, so the button of an older notification keeps
     * its own time and value. It carries the key, the action, the time
     * and the value, and no text (ADR 0034, point 7).
     */
    private fun action(notification: ShkNotification, button: ShkNotificationButton): Notification.Action {
        val press = PendingIntent.getBroadcast(
            context,
            0,
            ButtonReceiver.intentFor(context, ButtonPress(notification.key, button.action, notification.atMillis, button.value)),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Action.Builder(Icon.createWithResource(context, notification.smallIcon), button.label, press)
            .setAuthenticationRequired(true)
            .build()
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

    internal companion object {
        /** Notifications are told apart by their key, the tag, alone. */
        const val NOTIFICATION_ID = 0

        /** Android shows three buttons at most. */
        const val MOST_BUTTONS = 3

        /** The end of a notification, kept in it, in milliseconds since 1970. A time, never content. */
        const val EXTRA_ENDS_AT = "app.shkriuss.core.notify.ENDS_AT"

        /** Set on a notification posted in the hidden form. A mark, never content. */
        const val EXTRA_HIDDEN = "app.shkriuss.core.notify.HIDDEN"

        /** How far apart [hideShown] posts its notifications: four a second, below Android's limit of about five. */
        const val PACE_MILLIS = 250L

        /** How long [hideShown] waits for Android to take its posts, before it looks at the shade again. */
        const val SETTLE_MILLIS = 1_000L
    }
}
