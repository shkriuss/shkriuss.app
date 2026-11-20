package app.shkriuss.feature.water

import android.content.Intent
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.notify.Alarm
import app.shkriuss.core.notify.ButtonPress
import app.shkriuss.core.notify.ChannelImportance
import app.shkriuss.core.notify.NotifyState
import java.time.LocalDateTime
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Water's reminders (docs/apps/water/spec.md, "Reminders"): the alarm
 * Water names, the reminder its handler shows, the buttons Drank and
 * Later, and when a reminder is removed. On a real database in memory and
 * Robolectric's Android, with reminders every hour from 08:00 until 22:00
 * on Friday, 13 November 2026, in UTC.
 *
 * The handler and the buttons are called as `core/notify` calls them.
 * The way in through Android's alarms and the buttons' pending intents is
 * in the app's `WaterRemindersTest`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = RemindersTestApp::class)
class WaterRemindersTest {
    private val clock = clockAt(at(8, 0))
    private val water = RemindersSetup(clock)
    private val repository get() = water.repository
    private val reminders get() = water.reminders

    @After
    fun closeTheDatabase() = water.database.close()

    private fun remindersOn(change: (WaterSettings) -> WaterSettings = { it }) =
        runBlocking { repository.changeSettings { change(it.copy(remindersOn = true)) } }

    private fun drink(hour: Int, minute: Int, amountMl: Int, on: java.time.LocalDate = THE_DAY) =
        runBlocking { repository.addDrink(on, hour * 60 + minute, amountMl) }

    private fun named(): List<Alarm> = reminders.alarms()

    /** A drink one hour before [hour]:00, so that Water sets its alarm for [hour]:00. */
    private fun dueAt(hour: Int) {
        clock.setTo(at(hour - 1, 0))
        drink(hour - 1, 0, 100)
        assertEquals(listOf(alarm(at(hour, 0))), named())
    }

    private fun alarm(time: LocalDateTime) = Alarm(WaterReminders.ALARM, water.millisOf(time))

    /**
     * The alarm of [time] reaches the handler at [arrives], as `core/notify`
     * hands it over, and the sync after it runs.
     */
    private fun alarmComes(time: LocalDateTime, arrives: LocalDateTime = time) {
        clock.setTo(arrives)
        reminders.onAlarm(alarm(time), water.app.notify.notifications)
        water.app.notify.sync()
    }

    /** A press of [action] on the reminder shown for [time], with the value its button carries, at [pressedAt]. */
    private fun press(action: String, time: LocalDateTime, pressedAt: LocalDateTime, value: Long = 0) {
        clock.setTo(pressedAt)
        reminders.onButton(ButtonPress(WaterReminders.KEY, action, water.millisOf(time), value), water.app.notify.notifications)
    }

    private fun drinksToday(): List<Drink> = runBlocking { repository.drinksOf(THE_DAY).first() }

    // The alarm Water names.

    @Test
    fun withRemindersOffWaterNamesNoAlarm() {
        assertEquals(emptyList<Alarm>(), named())
        assertEquals(emptyList<Long>(), water.waiting())
    }

    @Test
    fun turningRemindersOnSetsTheAlarmForTheNextReminder() {
        remindersOn()

        assertEquals(listOf(alarm(at(9, 0))), named())
        assertEquals(listOf(water.millisOf(at(9, 0))), water.waiting())
    }

    @Test
    fun aDrinkMovesTheAlarm() {
        remindersOn()
        clock.setTo(at(8, 30))

        drink(8, 30, 300)

        assertEquals(listOf(water.millisOf(at(9, 30))), water.waiting())
    }

    @Test
    fun turningRemindersOffRemovesTheAlarm() {
        remindersOn()

        runBlocking { repository.changeSettings { it.copy(remindersOn = false) } }

        assertEquals(emptyList<Long>(), water.waiting())
    }

    // The reminder.

    @Test
    fun atItsTimeTheReminderShowsTodaysNumbersAndTheTwoButtons() {
        remindersOn()
        clock.setTo(at(8, 30))
        drink(8, 30, 300)

        alarmComes(at(9, 30))

        val shown = checkNotNull(water.reminder())
        assertEquals("Time for some water", shown.title)
        assertEquals("300 of 2,000 ml today", shown.text)
        assertEquals(listOf("Drank 150 ml", "Later"), shown.buttons)
        assertEquals("drink-reminders", shown.channelId)
        assertEquals(water.millisOf(at(9, 30)), shown.atMillis)
        assertTrue("every button asks for the unlock", shown.buttonsNeedUnlock)
        assertEquals("the tap opens Today", water.open.component, shown.tap?.component)
        // Android removes it at midnight, so yesterday's numbers never show as today's.
        assertEquals(water.millisOf(THE_DAY.plusDays(1).atStartOfDay()) - clock.nowMillis, shown.timeoutAfterMillis)
        // The next one comes one interval after it.
        assertEquals(listOf(water.millisOf(at(10, 30))), water.waiting())
    }

    @Test
    fun inFluidOuncesTheReminderShowsFluidOunces() {
        remindersOn { SettingsRules.withUnit(it, WaterUnit.US_FLUID_OUNCES) }
        clock.setTo(at(8, 30))
        drink(8, 30, 296)

        alarmComes(at(9, 30))

        val shown = checkNotNull(water.reminder())
        assertEquals("10 of 68 fl oz today", shown.text)
        assertEquals(listOf("Drank 5 fl oz", "Later"), shown.buttons)
    }

    @Test
    fun theChannelIsDrinkRemindersWithSound() {
        val channel = checkNotNull(water.device.channel("drink-reminders"))

        assertEquals("Drink reminders", channel.name)
        assertEquals("Reminds you to drink during the hours you choose.", channel.description)
        assertEquals(ChannelImportance.Normal, channel.importance)
    }

    @Test
    fun whileTheAppLockHidesTheTextTheReminderHasNoButtons() {
        remindersOn()
        water.hidesText = true

        alarmComes(at(9, 0))

        val shown = checkNotNull(water.reminder())
        assertEquals("Drink reminders", shown.title)
        assertEquals(emptyList<String>(), shown.buttons)
    }

    @Test
    fun anAlarmThatTheRuleNoLongerGivesShowsNothing() {
        remindersOn()
        // A drink logged in the very minute the alarm is due, before the alarm reaches the handler.
        clock.setTo(at(9, 0))
        drink(9, 0, 250)

        alarmComes(at(9, 0), arrives = at(9, 0, 1))

        assertNull(water.reminder())
        assertEquals(listOf(water.millisOf(at(10, 0))), water.waiting())
    }

    @Test
    fun withTheGoalMetOrRemindersOffOrOutsideTheHoursTheHandlerShowsNothing() {
        remindersOn()
        drink(7, 0, 2_000)
        alarmComes(at(9, 0))
        assertNull("goal met", water.reminder())

        runBlocking { repository.setGoal(THE_DAY, 5_000) }
        runBlocking { repository.changeSettings { it.copy(remindersOn = false) } }
        alarmComes(at(10, 0))
        assertNull("reminders off", water.reminder())

        remindersOn { it.copy(untilMinute = 10 * 60) }
        alarmComes(at(10, 30))
        assertNull("after Until", water.reminder())
    }

    @Test
    fun anAlarmThatComesMoreThanAMinuteLateIsSkipped() {
        remindersOn()

        alarmComes(at(9, 0), arrives = at(9, 1))

        assertNull(water.reminder())
        assertEquals(listOf(water.millisOf(at(10, 0))), water.waiting())
    }

    @Test
    fun anAlarmThatComesWithinTheMinuteShows() {
        remindersOn()

        alarmComes(at(9, 0), arrives = at(9, 0, 59))

        checkNotNull(water.reminder())
    }

    @Test
    fun doingItTwiceGivesTheSameResult() {
        remindersOn()
        alarmComes(at(9, 0))
        val first = checkNotNull(water.reminder())

        alarmComes(at(9, 0), arrives = at(9, 0, 5))

        assertEquals(1, water.device.shownCount())
        assertEquals(first.atMillis, checkNotNull(water.reminder()).atMillis)
        assertEquals(water.millisOf(at(9, 0)), water.reminders.entries.value.lastShown)
    }

    @Test
    fun aReminderNotAnsweredIsReplacedByTheNextOne() {
        remindersOn()
        alarmComes(at(9, 0))

        alarmComes(at(10, 0))

        assertEquals(1, water.device.shownCount())
        assertEquals(water.millisOf(at(10, 0)), checkNotNull(water.reminder()).atMillis)
    }

    @Test
    fun alarmsFireAlsoWhileNotificationsAreNotAllowedAndTheCountMovesOn() {
        water.device.allowNotifications(false)
        remindersOn()
        assertEquals(NotifyState.NotAsked, reminders.state())

        alarmComes(at(9, 0))

        assertEquals(water.millisOf(at(9, 0)), reminders.entries.value.lastShown)
        assertEquals(listOf(water.millisOf(at(10, 0))), water.waiting())
    }

    // The grace of one minute (the owner's decision).

    @Test
    fun whenTheAppStartsInTheMinuteOfTheAlarmTheAlarmStays() {
        remindersOn()
        assertEquals(listOf(alarm(at(9, 0))), named())

        // Android starts Water's process for the alarm. The start runs a sync before the alarm comes.
        clock.setTo(at(9, 0, 1))
        water.startTheApp()

        assertEquals(listOf(water.millisOf(at(9, 0))), water.waiting())
        alarmComes(at(9, 0), arrives = at(9, 0, 2))
        checkNotNull(water.reminder())
    }

    @Test
    fun aChangeInTheMinuteOfTheAlarmLeavesTheAlarm() {
        remindersOn()
        clock.setTo(at(9, 0, 2))

        // A change that does not answer the reminder: "Every" stays, the quick amounts change.
        runBlocking { repository.changeSettings { it.copy(cup2Ml = 300) } }

        assertEquals(listOf(alarm(at(9, 0))), named())
        alarmComes(at(9, 0), arrives = at(9, 0, 3))
        checkNotNull(water.reminder())
    }

    @Test
    fun afterAHandlerThatFailedTheAlarmIsNotNamedAgain() {
        remindersOn()
        water.database.close()

        clock.setTo(at(9, 0))
        assertThrows(Exception::class.java) {
            reminders.onAlarm(alarm(at(9, 0)), water.app.notify.notifications)
        }

        // Written before anything could fail: the next sync names the reminder after it.
        assertEquals(water.millisOf(at(9, 0)), reminders.entries.value.lastAlarm)
        assertNull(reminders.entries.value.pending)
    }

    @Test
    fun afterTheClockIsSetBackPastTheLastAlarmTheNextReminderStillShows() {
        remindersOn()
        alarmComes(at(9, 0))
        assertEquals(water.millisOf(at(9, 0)), reminders.entries.value.lastAlarm)

        // The phone's date goes back one day. Android tells the app, and core/notify registers the alarms again.
        val dayBefore = THE_DAY.minusDays(1)
        clock.setTo(dayBefore.atTime(8, 30))
        water.device.send(Intent.ACTION_TIME_CHANGED)
        assertEquals(listOf(water.millisOf(dayBefore.atTime(9, 0))), water.waiting())
        assertNull("the last alarm lies later than now: it is forgotten", reminders.entries.value.lastAlarm)
        assertEquals("so the alarm Water set is pending", water.millisOf(dayBefore.atTime(9, 0)), reminders.entries.value.pending)

        alarmComes(dayBefore.atTime(9, 0))

        assertEquals(water.millisOf(dayBefore.atTime(9, 0)), checkNotNull(water.reminder()).atMillis)
    }

    // Drank.

    @Test
    fun drankLogsTheAmountOnTheButtonNowAndRemovesTheReminder() {
        remindersOn()
        alarmComes(at(9, 0))

        press(WaterReminders.DRANK, at(9, 0), pressedAt = at(9, 3), value = 150)

        assertEquals(listOf(Drink(drinksToday().single().id, THE_DAY, 9 * 60 + 3, 150)), drinksToday())
        assertNull(water.reminder())
        assertEquals(listOf(water.millisOf(at(10, 3))), water.waiting())
    }

    @Test
    fun drankLogsWhatItsLabelSaysAlsoAfterTheQuickAmountsChanged() {
        remindersOn()
        alarmComes(at(9, 0))
        assertEquals("Drank 150 ml", checkNotNull(water.reminder()).buttons.first())
        runBlocking { repository.changeSettings { it.copy(cup1Ml = 400) } }

        press(WaterReminders.DRANK, at(9, 0), pressedAt = at(9, 3), value = 150)

        assertEquals(listOf(150), drinksToday().map { it.amountMl })
    }

    @Test
    fun theNextReminderShowsTheNewFirstAmount() {
        remindersOn()
        runBlocking { repository.changeSettings { it.copy(cup1Ml = 400) } }

        alarmComes(at(9, 0))

        assertEquals("Drank 400 ml", checkNotNull(water.reminder()).buttons.first())
    }

    @Test
    fun drankThatMeetsTheGoalEndsTheRemindersOfToday() {
        remindersOn()
        drink(8, 30, 1_900)
        alarmComes(at(9, 30))

        press(WaterReminders.DRANK, at(9, 30), pressedAt = at(9, 31), value = 150)

        assertNull(water.reminder())
        assertEquals(listOf(water.millisOf(THE_DAY.plusDays(1).atTime(9, 0))), water.waiting())
    }

    @Test
    fun aButtonWorksOnce() {
        remindersOn()
        alarmComes(at(9, 0))

        press(WaterReminders.DRANK, at(9, 0), pressedAt = at(9, 3), value = 150)
        press(WaterReminders.DRANK, at(9, 0), pressedAt = at(9, 3), value = 150)

        assertEquals(1, drinksToday().size)
    }

    @Test
    fun aDrankThatCannotBeSavedLeavesTheReminderAndTheNextPressSavesTheDrink() {
        remindersOn()
        alarmComes(at(9, 0))
        water.savingFails = true
        clock.setTo(at(9, 3))

        // Through the button's pending intent and core/notify, which holds the failure back.
        water.device.press(WaterReminders.KEY, 0)

        assertEquals(emptyList<Drink>(), drinksToday())
        assertEquals("the reminder stays, with its buttons", listOf("Drank 150 ml", "Later"), checkNotNull(water.reminder()).buttons)
        assertEquals(water.millisOf(at(9, 0)), reminders.entries.value.showing)

        water.savingFails = false
        water.device.press(WaterReminders.KEY, 0)

        assertEquals(listOf(150), drinksToday().map { it.amountMl })
        assertNull(water.reminder())
    }

    @Test
    fun aSecondPressOfTheSameDrankButtonDoesNothing() {
        remindersOn()
        alarmComes(at(9, 0))
        val drank = water.device.keepButton(WaterReminders.KEY, 0)
        clock.setTo(at(9, 3))

        drank()
        drank()

        assertEquals(1, drinksToday().size)
        assertNull(water.reminder())
    }

    @Test
    fun aPressOnAnOlderReminderDoesNothingAndLeavesTheNewerOne() {
        remindersOn()
        alarmComes(at(9, 0))
        alarmComes(at(10, 0))

        press(WaterReminders.DRANK, at(9, 0), pressedAt = at(10, 1), value = 150)

        assertEquals(emptyList<Drink>(), drinksToday())
        assertEquals(water.millisOf(at(10, 0)), checkNotNull(water.reminder()).atMillis)
    }

    @Test
    fun aPressWhenNoReminderIsShowingOnlyRemovesIt() {
        remindersOn()
        alarmComes(at(9, 0))
        // A drink logged in the app answered it.
        clock.setTo(at(9, 2))
        drink(9, 2, 250)

        press(WaterReminders.LATER, at(9, 0), pressedAt = at(9, 3))

        assertNull(water.reminder())
        assertNull(reminders.entries.value.snooze)
    }

    @Test
    fun aDrankThatComesAfterMidnightLogsNothingAndTakesTheReminder() {
        remindersOn()
        dueAt(21)
        alarmComes(at(21, 0))
        checkNotNull(water.reminder())

        // Android removed the reminder at midnight. A watch hands the press over later.
        press(WaterReminders.DRANK, at(21, 0), pressedAt = THE_DAY.plusDays(1).atTime(0, 10), value = 150)

        assertEquals(emptyList<Drink>(), runBlocking { repository.drinksOf(THE_DAY.plusDays(1)).first() })
        assertNull(reminders.entries.value.showing)
        assertNull(water.reminder())
    }

    @Test
    fun aLaterThatComesAfterMidnightSetsNoSnooze() {
        remindersOn()
        dueAt(21)
        alarmComes(at(21, 0))

        press(WaterReminders.LATER, at(21, 0), pressedAt = THE_DAY.plusDays(1).atTime(0, 10))

        assertNull(reminders.entries.value.snooze)
        assertNull(reminders.entries.value.showing)
    }

    @Test
    fun aDrankWithAnAmountOutsideTheLimitsLogsNothing() {
        remindersOn()
        alarmComes(at(9, 0))

        press(WaterReminders.DRANK, at(9, 0), pressedAt = at(9, 3), value = 3_001)

        assertEquals(emptyList<Drink>(), drinksToday())
        assertNull(water.reminder())
    }

    // Later.

    @Test
    fun laterSetsASnoozeOfFifteenMinutesAndRemovesTheReminder() {
        remindersOn()
        alarmComes(at(9, 0))

        press(WaterReminders.LATER, at(9, 0), pressedAt = at(9, 2, 40))

        assertNull(water.reminder())
        assertEquals(water.millisOf(at(9, 17)), reminders.entries.value.snooze)
        assertEquals(listOf(water.millisOf(at(9, 17))), water.waiting())
    }

    @Test
    fun aLaterWhoseSettingsCannotBeReadLeavesTheReminderAsItWas() {
        remindersOn()
        alarmComes(at(9, 0))
        clock.setTo(at(9, 2))
        // The settings cannot be read when Later is pressed. Nothing may be lost: not the reminder, and not the snooze.
        water.database.close()

        // Through the button's pending intent and core/notify, which holds the failure back.
        water.device.press(WaterReminders.KEY, 1)

        assertEquals("the reminder stays, with its buttons", listOf("Drank 150 ml", "Later"), checkNotNull(water.reminder()).buttons)
        assertEquals(water.millisOf(at(9, 0)), reminders.entries.value.showing)
        assertNull(reminders.entries.value.snooze)
    }

    @Test
    fun theSnoozedReminderComesAgainWithTheNumbersOfThatMoment() {
        remindersOn()
        alarmComes(at(9, 0))
        press(WaterReminders.LATER, at(9, 0), pressedAt = at(9, 2))
        // A drink entered with an earlier time leaves the snooze.
        clock.setTo(at(9, 5))
        drink(8, 30, 400)
        assertEquals(listOf(water.millisOf(at(9, 17))), water.waiting())

        alarmComes(at(9, 17))

        val shown = checkNotNull(water.reminder())
        assertEquals("400 of 2,000 ml today", shown.text)
        assertNull(reminders.entries.value.snooze)
        assertEquals(listOf(water.millisOf(at(10, 17))), water.waiting())
    }

    @Test
    fun laterWhenTheSnoozeWouldBeAfterUntilEndsTheRemindersOfToday() {
        remindersOn()
        dueAt(21)
        alarmComes(at(21, 0))
        checkNotNull(water.reminder())

        press(WaterReminders.LATER, at(21, 0), pressedAt = at(21, 50))

        assertNull(reminders.entries.value.snooze)
        assertEquals(listOf(water.millisOf(THE_DAY.plusDays(1).atTime(9, 0))), water.waiting())
    }

    // When the reminder is removed.

    @Test
    fun aDrinkLoggedInTheAppRemovesTheReminder() {
        remindersOn()
        alarmComes(at(9, 0))

        clock.setTo(at(9, 10))
        // Also a drink entered with an earlier time, or on another day.
        drink(7, 0, 100, on = THE_DAY.minusDays(1))

        assertNull(water.reminder())
    }

    @Test
    fun turningRemindersOffRemovesTheReminder() {
        remindersOn()
        alarmComes(at(9, 0))

        runBlocking { repository.changeSettings { it.copy(remindersOn = false) } }

        assertNull(water.reminder())
    }

    @Test
    fun aLowerGoalThatIsMetRemovesTheReminder() {
        remindersOn()
        drink(8, 30, 600)
        alarmComes(at(9, 30))

        runBlocking { repository.setGoal(THE_DAY, 500) }

        assertNull(water.reminder())
    }

    @Test
    fun anEditThatDoesNotMeetTheGoalLeavesTheReminder() {
        remindersOn()
        val earlier = drink(8, 30, 600)
        alarmComes(at(9, 30))

        runBlocking { repository.changeDrink(earlier.id, 8 * 60 + 30, 700) }

        checkNotNull(water.reminder())
    }

    @Test
    fun aReminderOfAnotherDayIsRemovedAtTheNextChange() {
        remindersOn()
        dueAt(21)
        alarmComes(at(21, 0))
        checkNotNull(water.reminder())

        clock.setTo(THE_DAY.plusDays(1).atTime(7, 0))
        runBlocking { repository.changeSettings { it.copy(cup3Ml = 600) } }

        assertNull(water.reminder())
        assertNull(reminders.entries.value.showing)
    }

    @Test
    fun theReminderLineKnowsTheNextTime() {
        remindersOn()

        assertEquals(at(9, 0), runBlocking { reminders.next() })
        assertTrue(water.reminders.state() == NotifyState.Ready)
    }

    // After a restore (spec, "After a restore").

    /**
     * Writes as a restore does: past the repository of the app, so that the
     * reminders are not told of each write, and then tells them once that
     * a backup was restored.
     */
    private fun restored(write: suspend WaterRepository.() -> Unit) = runBlocking {
        WaterRepository(water.database, clock, IdSource.RandomUuid).write()
        reminders.afterRestore()
    }

    @Test
    fun afterARestoreThatTurnsRemindersOffTheReminderGoesAndNoAlarmWaits() {
        remindersOn()
        alarmComes(at(9, 0))
        assertNotNull(water.reminder())
        assertEquals(listOf(water.millisOf(at(10, 0))), water.waiting())

        clock.setTo(at(9, 10))
        restored { changeSettings { it.copy(remindersOn = false) } }

        assertNull("a reminder that no longer fits is removed", water.reminder())
        assertEquals(emptyList<Long>(), water.waiting())
    }

    @Test
    fun afterARestoreThatMeetsTheGoalTheReminderGoesAndTheAlarmMovesToTomorrow() {
        remindersOn()
        alarmComes(at(9, 0))

        clock.setTo(at(9, 10))
        restored { addDrink(THE_DAY, 8 * 60 + 30, 2_000) }

        assertNull(water.reminder())
        assertEquals(listOf(water.millisOf(THE_DAY.plusDays(1).atTime(9, 0))), water.waiting())
    }

    @Test
    fun afterARestoreTheAlarmMovesToTheTimeOfTheRestoredSettingsAndAReminderThatStillFitsStays() {
        remindersOn()
        alarmComes(at(9, 0))
        assertEquals(listOf(water.millisOf(at(10, 0))), water.waiting())

        clock.setTo(at(9, 10))
        // A restored drink was not logged now: it does not answer the reminder by itself.
        restored {
            changeSettings { it.copy(intervalMinutes = 30) }
            addDrink(THE_DAY, 7 * 60, 100)
        }

        assertNotNull("the goal is not met and reminders are on", water.reminder())
        assertEquals("every 30 minutes now, counted from the reminder at 09:00", listOf(water.millisOf(at(9, 30))), water.waiting())
    }

    @Test
    fun afterARestoreThatTurnsRemindersOnTheAlarmIsSet() {
        assertEquals(emptyList<Long>(), water.waiting())

        clock.setTo(at(9, 10))
        restored { changeSettings { it.copy(remindersOn = true) } }

        assertEquals(listOf(water.millisOf(at(10, 0))), water.waiting())
    }
}
