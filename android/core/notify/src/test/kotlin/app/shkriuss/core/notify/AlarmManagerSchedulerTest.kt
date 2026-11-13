package app.shkriuss.core.notify

import android.app.AlarmManager
import android.app.Application
import android.app.PendingIntent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowAlarmManager

/**
 * What [AlarmManagerScheduler] asks of Android's `AlarmManager`: an exact
 * alarm on the wall clock that wakes a sleeping device, one for each id,
 * as a broadcast that only this app can send and that carries the id and
 * nothing else.
 */
@RunWith(RobolectricTestRunner::class)
class AlarmManagerSchedulerTest {
    private val context: Application = RuntimeEnvironment.getApplication()
    private val scheduler = AlarmManagerScheduler(context)
    private val android = shadowOf(context.getSystemService(AlarmManager::class.java))

    private val a = AlarmId("0b9f6c1e-5d1c-4a57-9d0e-0f4f3c1f2a10")
    private val b = AlarmId("next-drink")

    private fun waiting() = android.waiting()

    @Test
    fun anAlarmIsExactOnTheWallClockAndWakesASleepingDevice() {
        scheduler.set(Alarm(a, 1_800_000_000_000))

        val alarm = android.scheduledAlarms.single()
        assertEquals(AlarmManager.RTC_WAKEUP, alarm.getType())
        assertEquals(1_800_000_000_000, alarm.triggerAtMs)
        assertEquals(ShadowAlarmManager.WINDOW_EXACT, alarm.windowLengthMs)
        assertTrue(alarm.isAllowWhileIdle)
        assertEquals(0, alarm.intervalMs)
        assertNull(alarm.alarmClockInfo)
    }

    @Test
    fun theBroadcastGoesToThisAppsReceiverAndCarriesOnlyTheId() {
        scheduler.set(Alarm(a, 1_800_000_000_000))

        val intent = android.scheduledAlarms.single().broadcast()
        val operation = shadowOf(PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE))
        assertTrue(operation.isBroadcast)
        assertTrue(operation.isImmutable)
        assertEquals(context.packageName, intent.component?.packageName)
        assertEquals(AlarmReceiver::class.java.name, intent.component?.className)
        assertEquals(AlarmReceiver.ACTION_ALARM, intent.action)
        assertEquals(a.value, intent.identifier)
        assertNull(intent.extras)
        assertNull(intent.data)
    }

    @Test
    fun settingTheSameIdAgainLeavesOneAlarmWithTheNewTime() {
        scheduler.set(Alarm(a, 1_800_000_000_000))
        scheduler.set(Alarm(a, 1_800_000_000_000))
        scheduler.set(Alarm(a, 1_900_000_000_000))

        assertEquals(mapOf<String?, Long>(a.value to 1_900_000_000_000), waiting())
    }

    @Test
    fun twoIdsAreTwoAlarms() {
        scheduler.set(Alarm(a, 1_800_000_000_000))
        scheduler.set(Alarm(b, 1_800_000_000_000))

        assertEquals(mapOf<String?, Long>(a.value to 1_800_000_000_000, b.value to 1_800_000_000_000), waiting())
    }

    @Test
    fun cancelRemovesThatAlarmAndNoOther() {
        scheduler.set(Alarm(a, 1_800_000_000_000))
        scheduler.set(Alarm(b, 1_900_000_000_000))

        scheduler.cancel(a)

        assertEquals(mapOf<String?, Long>(b.value to 1_900_000_000_000), waiting())
    }

    @Test
    fun cancelOfAnAlarmThatDoesNotExistDoesNothing() {
        scheduler.set(Alarm(b, 1_900_000_000_000))

        scheduler.cancel(a)
        scheduler.cancel(a)

        assertEquals(mapOf<String?, Long>(b.value to 1_900_000_000_000), waiting())
    }

    @Test
    fun anAlarmCanBeSetAgainAfterItWasCancelled() {
        scheduler.set(Alarm(a, 1_800_000_000_000))
        scheduler.cancel(a)
        assertFalse(waiting().containsKey(a.value))

        scheduler.set(Alarm(a, 1_900_000_000_000))

        assertEquals(mapOf<String?, Long>(a.value to 1_900_000_000_000), waiting())
    }
}
