package app.shkriuss.feature.tasks

import android.app.Application
import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import app.shkriuss.core.notify.Notify
import app.shkriuss.core.notify.NotifyHost
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.core.notify.fixtures.ShownNotification
import app.shkriuss.core.testing.TestClock
import app.shkriuss.core.testing.TestIdSource
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.concurrent.Executor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.robolectric.RuntimeEnvironment

/** The app class of the tests of Tasks' reminders. It is a [NotifyHost], as `TasksApp` is. */
class NotifyTestApp : Application(), NotifyHost {
    override lateinit var notify: Notify
}

/**
 * Tasks' reminders on Robolectric's Android, as the app class builds
 * them: the services on a database in memory, a clock the test moves, the
 * phone's time zone [zone], which a test can change, and one `Notify`
 * whose worker runs each piece at once. What the notifications show and
 * which alarms wait are read through [device].
 */
internal class AlarmsSetup(var zone: ZoneId = TBILISI) {
    val app = RuntimeEnvironment.getApplication() as NotifyTestApp
    val clock = TestClock()
    val database = memoryDatabase()

    /** One source of ids for every start of the app, so that a new start never makes an id that exists. */
    private val ids = TestIdSource()

    /** What the app lock answers about the text of notifications. */
    var hidesText = false

    /** The screen a tap opens. A test can make it another app's, so that showing a notification fails. */
    var open: Intent = Intent().setComponent(ComponentName(app, "app.shkriuss.feature.tasks.TestScreen"))

    /** Android's alarms and notifications of the app. */
    val device = NotifyTestDevice(app)

    var services: TasksServices = newServices()
        private set

    init {
        // The phone's "Use 24-hour format", as in the spec's examples: "09:00".
        Settings.System.putString(app.contentResolver, Settings.System.TIME_12_24, "24")
        device.allowNotifications(true)
        startTheApp()
    }

    val repository: TasksRepository get() = services.repository
    val alarms: TasksAlarms get() = services.alarms

    /** The app starts, in a new process: new objects on the same database and the same files. */
    fun startTheApp() {
        services = newServices()
        val built = services
        app.notify = Notify(
            app,
            listOf(TasksAlarms.CHANNEL),
            built.alarms,
            built.alarms,
            clock,
            hidesText = { hidesText },
            worker = Executor { it.run() },
            buttons = built.alarms,
            review = built.alarms,
            // The spaced steps of hiding the text of notifications run at once here.
            later = { _, step -> step() },
        )
        app.notify.start()
    }

    private fun newServices() =
        TasksServices(app, database, clock, ids, open, notify = { app.notify }, zone = { zone }, work = Dispatchers.Unconfined)

    /** The phone's clock shows [local] in [zone]. */
    fun setClock(local: LocalDateTime) {
        clock.nowMillis = millisOf(local)
    }

    /** The moment of [local] in [zone]. */
    fun millisOf(local: LocalDateTime): Long = local.atZone(zone).toInstant().toEpochMilli()

    /** What the clock shows now. */
    fun reading(): ClockReading = services.time.reading()

    /** Adds a task as the form does, in Inbox, saved at [savedAt]. */
    fun add(title: String, due: Due?, savedAt: LocalDateTime, listId: String = INBOX): Task {
        setClock(savedAt)
        return checkNotNull(runBlocking { repository.addTask(NewTask(title, listId, due)) })
    }

    /** The task [task] as stored now. */
    fun find(task: Task): Task? = runBlocking { repository.findTask(task.id) }

    /** The times of the alarms that wait at Android, soonest first. */
    fun waiting(): List<Long> = device.waitingAlarms()

    /** The notification of [task], if it shows. */
    fun shown(task: Task): ShownNotification? = device.shown(task.id)

    /** Android fires the soonest alarm with the clock at [local], as a broadcast to the receiver of `core/notify`. */
    fun fireAt(local: LocalDateTime) {
        setClock(local)
        device.fireTheAlarm()
    }

    /** The user presses button [index] of the notification of [task] at [local], after the phone's unlock. */
    fun press(task: Task, index: Int, local: LocalDateTime) {
        setClock(local)
        device.press(task.id, index)
    }

    /** What this phone remembers of [task] now, as written. */
    fun entryOf(task: Task): TaskEntry = repository.entries.value[task.id] ?: TaskEntry()
}

/** The index of **Done** among the buttons of a notification. */
internal const val DONE = 0

/** The index of **Snooze 10 min** among the buttons of a notification. */
internal const val SNOOZE = 1
