package app.shkriuss.core.notify

import app.shkriuss.core.testing.TestClock
import java.time.LocalTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * The rules of "How alarms are kept right" in
 * docs/architecture/notifications.md, with a clock the test moves and a
 * stand-in for Android's alarms: what is registered, when the app's
 * handler runs, and what happens after a reboot, an update and a change
 * of the time or the time zone.
 *
 * The clock starts at 2026-01-01T00:00:00Z.
 */
@RunWith(RobolectricTestRunner::class)
class AlarmSyncTest {
    private val clock = TestClock()
    private val android = FakeAlarmScheduler()
    private val app = TestReminders(clock)
    private lateinit var sync: AlarmSync

    private val start = TestClock.START_MILLIS
    private val a = AlarmId("a")
    private val b = AlarmId("b")

    @Before
    fun anAppWithNoAlarms() {
        sync = newSync()
    }

    /** What a new start of the app builds: the same file, nothing kept in memory. */
    private fun newSync(): AlarmSync {
        val context = RuntimeEnvironment.getApplication()
        return AlarmSync(app, app, Notifications(context), android, AlarmRegistry(context.notifyStore()), clock)
    }

    /** The app changed its reminders and says so. */
    private fun appChanged() = sync.sync(setAll = false)

    /** A new start of the app, or one of Android's four broadcasts: every alarm is set again. */
    private fun androidMayHaveDroppedTheAlarms() = sync.sync(setAll = true)

    /** The app starts again, in a new process. */
    private fun appStarts() {
        sync = newSync()
        androidMayHaveDroppedTheAlarms()
    }

    /** Time passes: the clock moves, and Android fires what is due. */
    private fun advanceBy(millis: Long) {
        clock.advanceBy(millis)
        android.fireDue(clock, sync::fired)
    }

    @Test
    fun theAlarmsTheAppWantsAreRegistered() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        app.reminders += TestReminder.Once(b, start + 2 * HOUR)

        appChanged()

        assertEquals(mapOf(a to start + HOUR, b to start + 2 * HOUR), android.waiting)
    }

    @Test
    fun anAlarmFiresOnceAtItsTime() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        appChanged()

        advanceBy(HOUR - 1)
        assertEquals(emptyList<Alarm>(), app.handled)

        advanceBy(1)
        assertEquals(listOf(Alarm(a, start + HOUR)), app.handled)

        advanceBy(DAY)
        appChanged()
        advanceBy(DAY)
        assertEquals(1, app.handled.size)
        assertTrue(android.waiting.isEmpty())
    }

    @Test
    fun aBroadcastBeforeTheTimeIsDroppedAndTheAlarmStays() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        appChanged()

        sync.fired(a)

        assertEquals(emptyList<Alarm>(), app.handled)
        assertEquals(mapOf(a to start + HOUR), android.waiting)
        advanceBy(HOUR)
        assertEquals(listOf(Alarm(a, start + HOUR)), app.handled)
    }

    @Test
    fun aBroadcastThatComesTwiceRunsTheHandlerOnce() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        appChanged()
        clock.advanceBy(HOUR)

        sync.fired(a)
        sync.fired(a)

        assertEquals(listOf(Alarm(a, start + HOUR)), app.handled)
    }

    @Test
    fun aBroadcastForAnAlarmNobodyKnowsIsDropped() {
        appChanged()

        sync.fired(AlarmId("unknown"))

        assertEquals(emptyList<Alarm>(), app.handled)
    }

    @Test
    fun aChangedTimeReplacesTheAlarm() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        appChanged()

        app.reminders[0] = TestReminder.Once(a, start + 3 * HOUR)
        appChanged()

        assertEquals(mapOf(a to start + 3 * HOUR), android.waiting)
        advanceBy(2 * HOUR)
        assertEquals(emptyList<Alarm>(), app.handled)
        advanceBy(HOUR)
        assertEquals(listOf(Alarm(a, start + 3 * HOUR)), app.handled)
    }

    @Test
    fun anAlarmTheAppNoLongerWantsIsRemoved() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        app.reminders += TestReminder.Once(b, start + HOUR)
        appChanged()

        app.reminders.removeAt(0)
        appChanged()

        assertEquals(mapOf(b to start + HOUR), android.waiting)
        assertTrue("cancel a" in android.calls)
        advanceBy(HOUR)
        assertEquals(listOf(Alarm(b, start + HOUR)), app.handled)
    }

    @Test
    fun aReminderThatRepeatsGetsItsNextTimeWhenItFired() {
        app.reminders += TestReminder.Daily(a, LocalTime.of(9, 0))
        appChanged()
        assertEquals(mapOf(a to start + 9 * HOUR), android.waiting)

        advanceBy(9 * HOUR)

        assertEquals(listOf(Alarm(a, start + 9 * HOUR)), app.handled)
        assertEquals(mapOf(a to start + DAY + 9 * HOUR), android.waiting)

        advanceBy(3 * DAY)
        // Android fires a missed alarm when the device wakes. Three days passed at once, so one more fired.
        assertEquals(2, app.handled.size)
    }

    @Test
    fun anAlarmTheAppStillNamesAfterItFiredDoesNotFireAgain() {
        app.keepsNamingDoneReminders = true
        app.reminders += TestReminder.Once(a, start + HOUR)
        appChanged()
        advanceBy(HOUR)

        repeat(3) { appChanged() }
        advanceBy(DAY)

        assertEquals(listOf(Alarm(a, start + HOUR)), app.handled)
        assertTrue(android.waiting.isEmpty())
    }

    @Test
    fun afterARebootEveryAlarmIsRegisteredAgain() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        app.reminders += TestReminder.Daily(b, LocalTime.of(9, 0))
        appChanged()

        android.forgetEverything()
        appStarts()

        assertEquals(mapOf(a to start + HOUR, b to start + 9 * HOUR), android.waiting)
    }

    @Test
    fun anAlarmMissedWhileTheDeviceWasOffFiresLateAndOnce() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        appChanged()

        // The device is off from before the alarm until three hours after it.
        android.forgetEverything()
        clock.advanceBy(4 * HOUR)
        assertEquals(emptyList<Alarm>(), app.handled)

        // It starts and is unlocked: the alarms are registered again.
        appStarts()
        android.fireDue(clock, sync::fired)

        assertEquals(listOf(Alarm(a, start + HOUR)), app.handled)
        appChanged()
        android.fireDue(clock, sync::fired)
        assertEquals(1, app.handled.size)
    }

    @Test
    fun anAlarmThatFiredBeforeARebootDoesNotFireAgainAfterIt() {
        app.keepsNamingDoneReminders = true
        app.reminders += TestReminder.Once(a, start + HOUR)
        appChanged()
        advanceBy(HOUR)

        android.forgetEverything()
        appStarts()
        advanceBy(HOUR)

        assertEquals(1, app.handled.size)
    }

    @Test
    fun afterTheClockIsSetForwardTheAlarmsThatAreNowDueFire() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        app.reminders += TestReminder.Once(b, start + 5 * HOUR)
        appChanged()

        // The user sets the clock two hours ahead. Android tells the app, and fires what is due.
        clock.advanceBy(2 * HOUR)
        androidMayHaveDroppedTheAlarms()
        android.fireDue(clock, sync::fired)

        assertEquals(listOf(Alarm(a, start + HOUR)), app.handled)
        assertEquals(mapOf(b to start + 5 * HOUR), android.waiting)
    }

    @Test
    fun afterTheClockIsSetBackAnAlarmThatFiredIsDueAgain() {
        app.keepsNamingDoneReminders = true
        app.reminders += TestReminder.Once(a, start + HOUR)
        appChanged()
        advanceBy(HOUR)
        assertEquals(1, app.handled.size)

        // The clock goes back to half an hour before the alarm.
        clock.advanceBy(-30 * MINUTE)
        androidMayHaveDroppedTheAlarms()

        assertEquals(mapOf(a to start + HOUR), android.waiting)
        advanceBy(30 * MINUTE)
        assertEquals(listOf(Alarm(a, start + HOUR), Alarm(a, start + HOUR)), app.handled)
    }

    @Test
    fun aDailyReminderFollowsANewTimeZone() {
        app.reminders += TestReminder.Daily(a, LocalTime.of(9, 0))
        appChanged()
        assertEquals(mapOf(a to start + 9 * HOUR), android.waiting)

        // Tbilisi is four hours ahead of UTC: 09:00 there is 05:00 UTC.
        app.zone = ZoneId.of("Asia/Tbilisi")
        androidMayHaveDroppedTheAlarms()

        assertEquals(mapOf(a to start + 5 * HOUR), android.waiting)
        advanceBy(5 * HOUR)
        assertEquals(listOf(Alarm(a, start + 5 * HOUR)), app.handled)
        assertEquals(mapOf(a to start + DAY + 5 * HOUR), android.waiting)
    }

    @Test
    fun aNewTimeZoneThatPutsTheReminderInThePastFiresItAtOnce() {
        app.reminders += TestReminder.Daily(a, LocalTime.of(9, 0))
        appChanged()
        clock.advanceBy(6 * HOUR)

        // 06:00 UTC is 10:00 in Tbilisi: today's 09:00 has passed there.
        app.zone = ZoneId.of("Asia/Tbilisi")
        androidMayHaveDroppedTheAlarms()
        android.fireDue(clock, sync::fired)

        assertEquals(listOf(Alarm(a, start + 5 * HOUR)), app.handled)
        assertEquals(mapOf(a to start + DAY + 5 * HOUR), android.waiting)
    }

    @Test
    fun onlyTheSoonestHundredWaitAtAndroidAndTheRestFollowInOrder() {
        // 150 reminders, one a minute, named in the wrong order.
        repeat(150) { number -> app.reminders += TestReminder.Once(AlarmId("r$number"), start + (150 - number) * MINUTE) }
        appChanged()

        assertEquals(100, android.waiting.size)
        assertEquals(start + 100 * MINUTE, android.waiting.values.max())

        advanceBy(MINUTE)
        assertEquals(100, android.waiting.size)
        assertEquals(start + 101 * MINUTE, android.waiting.values.max())

        advanceBy(DAY)
        assertEquals(150, app.handled.size)
        assertEquals(app.handled.sortedBy { it.atMillis }, app.handled)
        assertTrue(android.waiting.isEmpty())
    }

    @Test
    fun anAppThatNamesAnIdTwiceIsRefused() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        app.reminders += TestReminder.Once(a, start + 2 * HOUR)

        assertThrows(IllegalArgumentException::class.java) { appChanged() }
    }

    @Test
    fun aHandlerThatFailsDoesNotFailAgainForTheSameAlarm() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        appChanged()
        clock.advanceBy(HOUR)
        app.failure = IllegalStateException("the record cannot be read")

        assertThrows(IllegalStateException::class.java) { android.fireDue(clock, sync::fired) }

        // The app starts again. The alarm is still named, and is done.
        appStarts()
        android.fireDue(clock, sync::fired)
        assertEquals(1, app.handled.size)
    }

    @Test
    fun theHandlerGetsTheTimeTheAlarmWasSetFor() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        appChanged()

        // The device slept through the time and fires 20 minutes late.
        advanceBy(HOUR + 20 * MINUTE)

        assertEquals(listOf(Alarm(a, start + HOUR)), app.handled)
    }

    @Test
    fun aStartOfTheAppSetsEveryAlarmAgainBecauseAndroidMayHaveDroppedThem() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        appChanged()

        // "Force stop": Android drops the alarms and tells nobody. Later the user opens the app.
        android.forgetEverything()
        appStarts()

        assertEquals(mapOf(a to start + HOUR), android.waiting)
    }

    @Test
    fun aChangeInTheAppLeavesTheOtherAlarmsAlone() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        appChanged()

        // Another reminder is added, one second before the first one is due.
        clock.advanceBy(HOUR - 1_000)
        app.reminders += TestReminder.Once(b, start + 2 * HOUR)
        appChanged()

        // Setting an alarm again that is almost due would make it late: Android waits five seconds after a set.
        assertEquals(listOf("set a ${start + HOUR}", "set b ${start + 2 * HOUR}"), android.calls)
    }

    @Test
    fun anAlarmThatFiredDoesNotSetTheOthersAgain() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        app.reminders += TestReminder.Once(b, start + HOUR + 1_000)
        appChanged()
        android.calls.clear()

        advanceBy(HOUR)

        assertEquals(listOf(Alarm(a, start + HOUR)), app.handled)
        assertEquals(emptyList<String>(), android.calls)
        assertEquals(mapOf(b to start + HOUR + 1_000), android.waiting)
    }

    @Test
    fun aBroadcastThatIsDroppedSetsEveryAlarmAgain() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        appChanged()

        // Android fired the alarm, so it is gone there. On the app's clock it is not due: the clock went back in between.
        android.forgetEverything()
        sync.fired(a)

        assertEquals(emptyList<Alarm>(), app.handled)
        assertEquals(mapOf(a to start + HOUR), android.waiting)
    }

    @Test
    fun anAlarmIdIsShortAndPlain() {
        AlarmId("0b9f6c1e-5d1c-4a57-9d0e-0f4f3c1f2a10")
        AlarmId("next-drink")
        listOf("", "a b", "a/b", "a:b", "é", "x".repeat(65)).forEach { value ->
            assertThrows(IllegalArgumentException::class.java) { AlarmId(value) }
        }
    }
}
