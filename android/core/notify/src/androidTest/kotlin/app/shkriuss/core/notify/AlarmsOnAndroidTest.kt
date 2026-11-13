package app.shkriuss.core.notify

import android.app.AlarmManager
import android.app.NotificationManager
import android.os.SystemClock
import app.shkriuss.core.testing.TestDevice
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Exact alarms on a real Android, with the device's own clock: Android's
 * `AlarmManager` takes them, fires them at their time as a broadcast to
 * the receiver that is not exported, and the app shows its notification.
 */
class AlarmsOnAndroidTest {
    private val app = DeviceApp.running
    private val reminders = app.reminders
    private val notificationManager = app.getSystemService(NotificationManager::class.java)

    @Before
    fun anAppWithNoAlarmsThatMayShowNotifications() {
        TestDevice.instrumentation.uiAutomation.grantRuntimePermission(app.packageName, Notify.PERMISSION)
        clear()
    }

    @After
    fun clear() {
        reminders.wanted.clear()
        syncAndWait()
        reminders.handled.clear()
        notificationManager.cancelAll()
    }

    /** Asks for a sync and waits until the worker has run it. */
    private fun syncAndWait() {
        val before = reminders.asked.get()
        app.notify.sync()
        assertTrue("the sync did not run", TestDevice.waitUntil(WAIT_MILLIS) { reminders.asked.get() > before })
    }

    @Test
    fun exactAlarmsAreAllowedWithoutAskingTheUser() {
        assertTrue(app.getSystemService(AlarmManager::class.java).canScheduleExactAlarms())
    }

    @Test
    fun anAlarmFiresAtItsTimeAndTheAppShowsItsNotification() {
        val alarm = Alarm(AlarmId("fires"), System.currentTimeMillis() + SOON_MILLIS)
        reminders.wanted += alarm
        syncAndWait()

        val fired = TestDevice.waitUntil(WAIT_MILLIS) { reminders.handled.isNotEmpty() }

        assertTrue("the alarm did not fire within ${WAIT_MILLIS / 1000} s", fired)
        val (handled, at) = reminders.handled.single()
        assertEquals(alarm, handled)
        assertTrue("the alarm fired ${alarm.atMillis - at} ms before its time", at >= alarm.atMillis)
        TestDevice.note("An exact alarm fired ${at - alarm.atMillis} ms after its time.")

        val shown = TestDevice.waitUntil(WAIT_MILLIS) { notificationManager.activeNotifications.any { it.tag == "fires" } }
        assertTrue("the notification is not shown", shown)
        val notification = notificationManager.activeNotifications.single { it.tag == "fires" }.notification
        assertEquals(DeviceReminders.CHANNEL.id, notification.channelId)
        assertEquals(alarm.atMillis, notification.`when`)
    }

    @Test
    fun twoAlarmsWithTwoIdsBothFire() {
        val now = System.currentTimeMillis()
        reminders.wanted += Alarm(AlarmId("one"), now + SOON_MILLIS)
        reminders.wanted += Alarm(AlarmId("two"), now + SOON_MILLIS + 2_000)
        syncAndWait()

        val fired = TestDevice.waitUntil(WAIT_MILLIS) { reminders.handled.size == 2 }

        assertTrue("only ${reminders.handled.size} of two alarms fired", fired)
        // Android may deliver two alarms that are due together in either order.
        assertEquals(listOf("one", "two"), reminders.handled.map { it.first.id.value }.sorted())
        if (reminders.handled.first().first.id.value == "two") TestDevice.note("Two alarms two seconds apart came in the other order.")
    }

    @Test
    fun anAlarmThatIsNoLongerWantedDoesNotFire() {
        val alarm = Alarm(AlarmId("removed"), System.currentTimeMillis() + SOON_MILLIS)
        reminders.wanted += alarm
        syncAndWait()

        reminders.wanted.clear()
        syncAndWait()
        SystemClock.sleep(2 * SOON_MILLIS)

        assertEquals(emptyList<Alarm>(), reminders.handled.map { it.first })
    }

    @Test
    fun anAlarmWhoseTimeHasPassedFiresWithinSeconds() {
        val alarm = Alarm(AlarmId("missed"), System.currentTimeMillis() - 60 * 60_000)
        reminders.wanted += alarm
        val setAt = System.currentTimeMillis()
        syncAndWait()

        val fired = TestDevice.waitUntil(WAIT_MILLIS) { reminders.handled.isNotEmpty() }

        assertTrue("the missed alarm did not fire", fired)
        assertEquals(listOf(alarm), reminders.handled.map { it.first })
        TestDevice.note("An alarm whose time had passed fired ${reminders.handled.single().second - setAt} ms after it was set.")
    }

    private companion object {
        /**
         * How far ahead a test sets its alarm. Android fires no alarm
         * sooner than about five seconds after it was set, so a shorter
         * time would measure that limit and not the alarm.
         */
        const val SOON_MILLIS = 7_000L
        const val WAIT_MILLIS = 30_000L
    }
}
