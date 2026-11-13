package app.shkriuss.core.notify

import android.app.Activity
import android.app.Application
import android.content.Intent
import app.shkriuss.core.data.Clock
import app.shkriuss.core.notify.test.R
import app.shkriuss.core.testing.TestDevice
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/**
 * The app class of the test APK. It does what the app class of an app
 * with reminders does: it is a [NotifyHost], builds the app's one
 * [Notify] with the device's own clock, and starts it.
 */
class DeviceApp : Application(), NotifyHost {
    /** The reminders of this small app. The tests add and remove them. */
    val reminders = DeviceReminders(this)

    override val notify: Notify by lazy { Notify(
            this,
            listOf(DeviceReminders.CHANNEL),
            reminders,
            reminders,
            Clock.System,
            // The test app has no app lock: its notifications always show their text.
            hidesText = { false },
        ) }

    override fun onCreate() {
        super.onCreate()
        notify.start()
    }

    companion object {
        /** The running test APK. */
        val running: DeviceApp get() = TestDevice.context.applicationContext as DeviceApp
    }
}

/** An empty screen: what a tap on a notification of the tests would open. */
class OpenedScreen : Activity()

/**
 * The records of the test app, as its [AlarmSource] and [AlarmHandler].
 * The handler runs on the worker thread of [Notify] and the tests read
 * from their own thread, so everything here may be used from both.
 */
class DeviceReminders(private val app: Application) : AlarmSource, AlarmHandler {
    /** The alarms the app wants. */
    val wanted = CopyOnWriteArrayList<Alarm>()

    /** Every alarm the handler got, with the moment on the device's clock when it came. */
    val handled = CopyOnWriteArrayList<Pair<Alarm, Long>>()

    /** How often the app was asked for its alarms. */
    val asked = AtomicInteger()

    override fun alarms(): List<Alarm> {
        asked.incrementAndGet()
        return wanted.toList()
    }

    override fun onAlarm(alarm: Alarm, notifications: Notifications) {
        handled += alarm to System.currentTimeMillis()
        wanted.remove(alarm)
        val open = Intent(app, OpenedScreen::class.java)
        notifications.show(
            ShkNotification(alarm.id.value, CHANNEL, "A reminder of the tests", null, android.R.drawable.ic_popup_reminder, open, alarm.atMillis),
        )
    }

    companion object {
        val CHANNEL = NotifyChannel(
            "reminders",
            R.string.notify_test_channel_name,
            R.string.notify_test_channel_description,
            ChannelImportance.Urgent,
        )
    }
}
