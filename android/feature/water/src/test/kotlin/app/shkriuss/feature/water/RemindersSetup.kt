package app.shkriuss.feature.water

import android.app.Application
import android.content.ComponentName
import android.content.Intent
import app.shkriuss.core.notify.Notify
import app.shkriuss.core.notify.NotifyHost
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.core.notify.fixtures.ShownNotification
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import java.time.LocalDateTime
import java.util.concurrent.Executor
import kotlinx.coroutines.Dispatchers
import org.robolectric.RuntimeEnvironment

/** The app class of the tests of Water's reminders. It is a [NotifyHost], as `WaterApp` is. */
class RemindersTestApp : Application(), NotifyHost {
    override lateinit var notify: Notify
}

/**
 * Water's reminders on Robolectric's Android, as the app class builds
 * them: the services on a database in memory, the clock of [clock] in
 * UTC, and one `Notify` whose worker runs each piece at once. What the
 * reminders show and which alarms wait are read through [device].
 */
internal class RemindersSetup(val clock: TestClock) {
    val app = RuntimeEnvironment.getApplication() as RemindersTestApp
    val database = memoryDatabase()

    /** One source of ids for every start of the app, so that a new start never makes an id that exists. */
    private val ids = TestIdSource()

    /** What the app lock answers about the text of notifications. */
    var hidesText = false

    /** The screen a tap opens: Today. */
    val open: Intent = Intent().setComponent(ComponentName(app, "app.shkriuss.feature.water.TodayScreen"))

    /** Android's alarms and notifications of the app. */
    val device = NotifyTestDevice(app)

    var services: WaterServices = newServices()
        private set

    init {
        device.allowNotifications(true)
        startTheApp()
    }

    val repository: WaterRepository get() = services.repository
    val reminders: WaterReminders get() = services.reminders
    val time: WaterTime get() = services.time

    /** The app starts, in a new process: new objects on the same database and the same files. */
    fun startTheApp() {
        services = newServices()
        val built = services
        app.notify = Notify(
            app,
            listOf(WaterReminders.CHANNEL),
            built.reminders,
            built.reminders,
            clock,
            hidesText = { hidesText },
            worker = Executor { it.run() },
            buttons = built.reminders,
        )
        app.notify.start()
    }

    private fun newServices() =
        WaterServices(app, database, clock, ids, open, notify = { app.notify }, zone = { UTC }, work = Dispatchers.Unconfined)

    /** The moment of [time] in UTC. */
    fun millisOf(time: LocalDateTime): Long = this.time.millisOf(time)

    /** The times of the alarms that wait at Android. Water has one at most. */
    fun waiting(): List<Long> = device.waitingAlarms()

    /** Water's reminder, if it shows. */
    fun reminder(): ShownNotification? = device.shown(WaterReminders.KEY)
}
