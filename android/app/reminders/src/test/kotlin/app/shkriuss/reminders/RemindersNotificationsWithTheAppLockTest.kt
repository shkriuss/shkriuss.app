package app.shkriuss.reminders

import androidx.test.core.app.ApplicationProvider
import app.shkriuss.core.notify.R as NotifyR
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.feature.reminders.RemindersAlarms
import app.shkriuss.feature.reminders.Repeat
import app.shkriuss.feature.reminders.Schedule
import java.time.ZoneOffset
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A reminder while the app lock is on (docs/apps/reminders/spec.md, "The
 * notification", who sees the title, point 2): it shows only "Reminders"
 * and the fixed text of core/notify, with no buttons, so its title is not
 * on a phone that someone else holds. A tap opens Reminders, behind its
 * lock screen.
 *
 * The app class has the app lock on, with real keys, and the text of
 * notifications hidden, which is the default. The alarm is fired as
 * Android fires it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = AppLockOnRemindersApp::class)
class RemindersNotificationsWithTheAppLockTest {
    private val app = ApplicationProvider.getApplicationContext<AppLockOnRemindersApp>()
    private val device = NotifyTestDevice(app)

    @After
    fun closeTheDatabase() = app.test.database.close()

    @Test
    fun withTheAppLockOnAReminderShowsInItsHiddenFormWithoutButtons() {
        device.allowNotifications(true)
        val pills = runBlocking {
            app.test.services.repository.addSaved("Pills", Schedule(Repeat.DAILY, THE_TIME.toLocalDate(), 9 * 60))
        }
        val due = THE_TIME.toLocalDate().plusDays(1).atTime(9, 0).toInstant(ZoneOffset.UTC).toEpochMilli()
        assertEquals(listOf(due), device.waitingAlarms())

        app.test.clock.nowMillis = due
        device.fireTheAlarm()

        val shown = checkNotNull(device.shown(pills.id)) { "No reminder shows" }
        assertEquals("only the name of the channel", "Reminders", shown.title)
        assertEquals(app.getString(NotifyR.string.notify_text_hidden), shown.text)
        assertEquals("no Done and no Snooze", emptyList<String>(), shown.buttons)
        assertEquals("a tap opens Reminders", RemindersActivity::class.java.name, shown.tap?.component?.className)
        assertEquals(RemindersAlarms.CHANNEL.id, shown.channelId)
    }
}
