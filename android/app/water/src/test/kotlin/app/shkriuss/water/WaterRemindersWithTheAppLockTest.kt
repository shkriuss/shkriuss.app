package app.shkriuss.water

import androidx.test.core.app.ApplicationProvider
import app.shkriuss.core.notify.R as NotifyR
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.feature.water.WaterReminders
import java.time.ZoneOffset
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A reminder of Water while the app lock is on
 * (docs/apps/water/spec.md, "What a reminder shows", point 7, and
 * "Buttons on a reminder", rule 2): it shows in its hidden form, the
 * channel's name and the fixed text of core/notify, with no buttons, so
 * neither today's numbers nor **Drank** and **Later** are on a phone that
 * someone else holds. A tap opens Water, behind its lock screen.
 *
 * The app class has the app lock on, with real keys, and the text of
 * notifications hidden, which is the default. The alarm is fired as
 * Android fires it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = AppLockOnWaterApp::class)
class WaterRemindersWithTheAppLockTest {
    private val app = ApplicationProvider.getApplicationContext<AppLockOnWaterApp>()
    private val device = NotifyTestDevice(app)

    @After
    fun closeTheDatabase() = app.test.database.close()

    @Test
    fun withTheAppLockOnAReminderShowsInItsHiddenFormWithoutButtons() {
        device.allowNotifications(true)
        runBlocking {
            app.test.services.repository.addDrink(THE_DAY, 9 * 60, 300)
            app.test.services.repository.changeSettings { it.copy(remindersOn = true) }
        }
        // 14:05, every hour from 08:00: the next reminder is at 15:00.
        val due = THE_DAY.atTime(15, 0).toInstant(ZoneOffset.UTC).toEpochMilli()
        assertEquals(listOf(due), device.waitingAlarms())

        app.test.clock.nowMillis = due
        device.fireTheAlarm()

        val reminder = checkNotNull(device.shown(WaterReminders.KEY)) { "No reminder shows" }
        assertEquals("only the name of the channel", "Drink reminders", reminder.title)
        assertEquals(app.getString(NotifyR.string.notify_text_hidden), reminder.text)
        assertEquals("no Drank and no Later", emptyList<String>(), reminder.buttons)
        assertEquals("a tap opens Water", WaterActivity::class.java.name, reminder.tap?.component?.className)
        assertEquals(WaterReminders.CHANNEL.id, reminder.channelId)
    }
}
