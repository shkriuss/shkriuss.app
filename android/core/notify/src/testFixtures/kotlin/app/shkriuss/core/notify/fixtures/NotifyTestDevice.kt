package app.shkriuss.core.notify.fixtures

import android.app.AlarmManager
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Looper
import app.shkriuss.core.notify.ChannelImportance
import app.shkriuss.core.notify.Notify
import app.shkriuss.core.notify.NotifyChannel
import org.robolectric.Shadows.shadowOf

/**
 * What a notification shows, as a test reads it. [tap] is the screen a tap
 * opens. [timeoutAfterMillis] is how long after it was posted Android
 * removes it, or 0 for never. [buttonsNeedUnlock] is true if every button
 * asks for the phone's unlock first. [alertsOnlyOnce] is true if posting
 * it again makes no new sound or vibration.
 */
data class ShownNotification(
    val channelId: String,
    val title: String?,
    val text: String?,
    val buttons: List<String>,
    val buttonsNeedUnlock: Boolean,
    val atMillis: Long,
    val timeoutAfterMillis: Long,
    val tap: Intent?,
    val alertsOnlyOnce: Boolean,
)

/** A channel of the app, as Android's settings show it. */
data class SeenChannel(val name: String, val description: String?, val importance: ChannelImportance?)

/**
 * Android's alarms and notifications of the app under test, on
 * Robolectric's Android: what the app shows, which alarms wait, and what
 * the user and Android do to them.
 *
 * Only `core/notify` may name Android's alarm and notification classes,
 * also in tests (`NotifyBoundaryTest`). So the tests of an app that uses
 * `core/notify` check its reminders through this. It is for unit tests
 * with Robolectric only, and never part of an app.
 */
class NotifyTestDevice(private val context: Context) {
    private val app = context.applicationContext as Application
    private val notifications = context.getSystemService(NotificationManager::class.java)
    private val alarms = context.getSystemService(AlarmManager::class.java)

    /**
     * Whether Android lets the app show notifications: the user's answer to
     * Android's question, or the switch on the app's notification page.
     */
    fun allowNotifications(allowed: Boolean) {
        if (allowed) shadowOf(app).grantPermissions(Notify.PERMISSION) else shadowOf(app).denyPermissions(Notify.PERMISSION)
        shadowOf(notifications).setNotificationsEnabled(allowed)
    }

    /** The user turns [channel] off on Android's page for it. The app's start must have made the channel. */
    fun turnOff(channel: NotifyChannel) {
        checkNotNull(notifications.getNotificationChannel(channel.id)) { "The app has not made the channel ${channel.id} yet" }
            .importance = NotificationManager.IMPORTANCE_NONE
    }

    /** The channel [id] of the app, or null if the app has not made it. */
    fun channel(id: String): SeenChannel? = notifications.getNotificationChannel(id)?.let { channel ->
        SeenChannel(
            name = channel.name.toString(),
            description = channel.description,
            importance = ChannelImportance.entries.firstOrNull { it.level == channel.importance },
        )
    }

    /** The notification with [key] that the app shows now, or null. */
    fun shown(key: String): ShownNotification? = notification(key)?.let { shown ->
        val actions = shown.actions?.toList().orEmpty()
        ShownNotification(
            channelId = shown.channelId,
            title = shown.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
            text = shown.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
            buttons = actions.map { it.title.toString() },
            buttonsNeedUnlock = actions.all { it.isAuthenticationRequired },
            atMillis = shown.`when`,
            timeoutAfterMillis = shown.timeoutAfter,
            tap = shown.contentIntent?.let { shadowOf(it).savedIntent },
            alertsOnlyOnce = shown.flags and Notification.FLAG_ONLY_ALERT_ONCE != 0,
        )
    }

    /** How many notifications the app shows now. */
    fun shownCount(): Int = shadowOf(notifications).size()

    /** The user presses button [index] of the notification [key], after the phone's unlock: Android sends its pending intent. */
    fun press(key: String, index: Int) {
        val shown = checkNotNull(notification(key)) { "No notification $key is shown" }
        checkNotNull(shown.actions) { "The notification $key has no buttons" }[index].actionIntent.send()
        idle()
    }

    /**
     * Keeps button [index] of the notification [key], as a press that
     * arrives late does, or an app with notification access. The answer
     * sends the button's pending intent when it is called, whatever the
     * app shows by then.
     */
    fun keepButton(key: String, index: Int): () -> Unit {
        val shown = checkNotNull(notification(key)) { "No notification $key is shown" }
        val kept = checkNotNull(shown.actions) { "The notification $key has no buttons" }[index].actionIntent
        return {
            kept.send()
            idle()
        }
    }

    /** The times of the alarms that wait at Android, soonest first. */
    fun waitingAlarms(): List<Long> = shadowOf(alarms).scheduledAlarms.map { it.triggerAtMs }.sorted()

    /** Android fires the soonest alarm of the app now, as a broadcast to the receiver of `core/notify`. */
    fun fireTheAlarm() {
        val soonest = checkNotNull(shadowOf(alarms).scheduledAlarms.minByOrNull { it.triggerAtMs }) { "No alarm waits" }
        shadowOf(alarms).fireAlarm(soonest)
        idle()
    }

    /** A reboot or a "Force stop": Android forgets every alarm of the app. */
    @Suppress("DEPRECATION")
    fun forgetTheAlarms() {
        // Robolectric offers the pending intent of an alarm only as a field it marks as deprecated, with nothing in its place.
        shadowOf(alarms).scheduledAlarms.forEach { alarms.cancel(checkNotNull(it.operation)) }
    }

    /** Android sends one of its own broadcasts to the app, such as `BOOT_COMPLETED`. */
    fun send(action: String) {
        context.sendBroadcast(Intent(action).setPackage(context.packageName))
        idle()
    }

    private fun notification(key: String): Notification? = shadowOf(notifications).getNotification(key, 0)

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()
}
