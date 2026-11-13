package app.shkriuss.core.notify

import android.os.SystemClock
import app.shkriuss.core.testing.TestDevice
import kotlin.math.abs
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test

/**
 * A change of the time zone and of the time on a real Android: Android
 * tells the receiver, which is not exported, and the alarms are
 * registered again.
 *
 * An app cannot change the clock. The tests ask Android as the shell
 * user. The commands for that differ between Android versions, so a test
 * tries the ones it knows, checks the effect, and is skipped with a note
 * where none of them works.
 */
class ClockChangesOnAndroidTest {
    private val app = DeviceApp.running
    private val reminders = app.reminders

    /** The emulator's clock minus the time since it started. It stays the same until someone sets the clock. */
    private val clockOffset = System.currentTimeMillis() - SystemClock.elapsedRealtime()
    private val zoneBefore = timeZone()

    @Before
    fun anAppWithNoAlarms() {
        reminders.wanted.clear()
        syncAndWait()
        reminders.handled.clear()
    }

    @After
    fun putTheClockBack() {
        if (timeZone() != zoneBefore && zoneBefore.isNotEmpty()) setTimeZone(zoneBefore)
        if (abs(System.currentTimeMillis() - SystemClock.elapsedRealtime() - clockOffset) > CLOSE_MILLIS) {
            setTime(SystemClock.elapsedRealtime() + clockOffset)
        }
        reminders.wanted.clear()
        syncAndWait()
    }

    private fun syncAndWait() {
        val before = reminders.asked.get()
        app.notify.sync()
        assertTrue("the sync did not run", TestDevice.waitUntil(WAIT_MILLIS) { reminders.asked.get() > before })
    }

    private fun timeZone(): String = TestDevice.shell("getprop persist.sys.timezone").trim()

    /** Sets the emulator's time zone. True if it is [zone] afterwards. */
    private fun setTimeZone(zone: String): Boolean = listOf(
        "cmd alarm set-timezone $zone",
        "cmd time_zone_detector set_manual_time_zone --zone_id $zone",
        "cmd time_zone_detector suggest_manual_time_zone --zone_id $zone",
    ).any { command ->
        TestDevice.shell(command)
        TestDevice.waitUntil(SHORT_WAIT_MILLIS) { timeZone() == zone }.also { worked ->
            if (worked) TestDevice.note("The time zone was set with: ${command.substringBefore(" $zone").substringBefore(" --")}")
        }
    }

    /** Sets the emulator's clock. True if it shows [millis] afterwards. */
    private fun setTime(millis: Long): Boolean = listOf(
        "cmd alarm set-time $millis",
        "cmd time_detector set_manual_time --unix_epoch_time $millis",
    ).any { command ->
        TestDevice.shell(command)
        TestDevice.waitUntil(SHORT_WAIT_MILLIS) { abs(System.currentTimeMillis() - millis) < CLOSE_MILLIS }.also { worked ->
            if (worked) TestDevice.note("The clock was set with: ${command.substringBefore(" $millis").substringBefore(" --")}")
        }
    }

    @Test
    fun afterANewTimeZoneTheAppIsAskedForItsAlarmsAgain() {
        val other = if (zoneBefore == "Asia/Tbilisi") "Europe/Berlin" else "Asia/Tbilisi"
        val askedBefore = reminders.asked.get()

        assumeTrue("No known command sets the time zone on this Android.", setTimeZone(other))

        val asked = TestDevice.waitUntil(WAIT_MILLIS) { reminders.asked.get() > askedBefore }
        assertTrue("Android changed the time zone, and the alarms were not registered again", asked)
    }

    @Test
    fun afterTheClockIsSetForwardAnAlarmThatIsNowDueFires() {
        val alarm = Alarm(AlarmId("clock"), System.currentTimeMillis() + 10 * MINUTE_MILLIS)
        reminders.wanted += alarm
        syncAndWait()
        val askedBefore = reminders.asked.get()

        assumeTrue("No known command sets the clock on this Android.", setTime(alarm.atMillis + MINUTE_MILLIS))

        val fired = TestDevice.waitUntil(WAIT_MILLIS) { reminders.handled.isNotEmpty() }
        assertTrue("the alarm that is now due did not fire", fired)
        assertEquals(listOf(alarm), reminders.handled.map { it.first })
        // The app is asked once after the alarm fired, and once because Android said that the time changed.
        val asked = TestDevice.waitUntil(WAIT_MILLIS) { reminders.asked.get() >= askedBefore + 2 }
        assertTrue("Android changed the time, and the alarms were not registered again", asked)
    }

    private companion object {
        const val MINUTE_MILLIS = 60_000L
        const val WAIT_MILLIS = 30_000L
        const val SHORT_WAIT_MILLIS = 5_000L

        /** Two readings of the clock this close are the same time. */
        const val CLOSE_MILLIS = 20_000L
    }
}
