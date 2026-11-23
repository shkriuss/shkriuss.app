package app.shkriuss.tasks

import androidx.test.core.app.ApplicationProvider
import app.shkriuss.core.notify.R as NotifyR
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.feature.tasks.Due
import app.shkriuss.feature.tasks.TasksAlarms
import java.time.ZoneOffset
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A task's reminder while the app lock is on (docs/apps/tasks/spec.md,
 * "The notification", which takes who sees the title from Reminders): it
 * shows only "Task reminders" and the fixed text of core/notify, with no
 * buttons, so its title is not on a phone that someone else holds. A tap
 * opens Tasks, behind its lock screen.
 *
 * The app class has the app lock on, with real keys, and the text of
 * notifications hidden, which is the default. The alarm is fired as
 * Android fires it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = AppLockOnTasksApp::class)
class TasksNotificationsWithTheAppLockTest {
    private val app = ApplicationProvider.getApplicationContext<AppLockOnTasksApp>()
    private val device = NotifyTestDevice(app)

    @After
    fun closeTheDatabase() = app.test.database.close()

    @Test
    fun withTheAppLockOnAReminderShowsInItsHiddenFormWithoutButtons() {
        device.allowNotifications(true)
        val bank = seed { addTask("Call the bank", Due(THE_TIME.toLocalDate(), null, 14 * 60)) }
        val due = THE_TIME.toLocalDate().atTime(14, 0).toInstant(ZoneOffset.UTC).toEpochMilli()
        assertEquals(listOf(due), device.waitingAlarms())

        app.test.clock.nowMillis = due
        device.fireTheAlarm()

        val shown = checkNotNull(device.shown(bank.id)) { "No reminder shows" }
        assertEquals("only the name of the channel", "Task reminders", shown.title)
        assertEquals(app.getString(NotifyR.string.notify_text_hidden), shown.text)
        assertEquals("no Done and no Snooze", emptyList<String>(), shown.buttons)
        assertEquals("a tap opens Tasks", TasksActivity::class.java.name, shown.tap?.component?.className)
        assertEquals(TasksAlarms.CHANNEL.id, shown.channelId)
    }
}
