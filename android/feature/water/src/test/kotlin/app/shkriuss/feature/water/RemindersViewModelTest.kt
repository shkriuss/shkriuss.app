package app.shkriuss.feature.water

import android.provider.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The reminder line of Today and Settings, and the question for
 * notifications (docs/apps/water/spec.md, "Today" and "Asking for
 * notifications"), at 08:00 on Friday, 13 November 2026, with reminders
 * every hour from 08:00 until 22:00.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = RemindersTestApp::class)
class RemindersViewModelTest {
    private val clock = clockAt(at(8, 0))
    private val water = RemindersSetup(clock)
    private val repository get() = water.repository

    @After
    fun closeTheDatabase() = water.database.close()

    private fun model() = RemindersViewModel(repository, water.reminders, water.time, Dispatchers.Unconfined)

    private fun remindersOn(change: (WaterSettings) -> WaterSettings = { it }) =
        runBlocking { repository.changeSettings { change(it.copy(remindersOn = true)) } }

    private fun RemindersViewModel.line(expected: ReminderLine?) = state.await { it.line == expected }.line

    // The line.

    @Test
    fun withRemindersOffThereIsNoLine() {
        val model = model()

        assertEquals(null, model.line(null))
        assertEquals(RemindersScreen(), model.state.value)
    }

    @Test
    fun aReminderLaterTodayIsNamedWithItsTime() {
        remindersOn()

        assertEquals(ReminderLine.NextAt(9 * 60), model().line(ReminderLine.NextAt(9 * 60)))
    }

    @Test
    fun theLineFollowsADrink() {
        remindersOn()
        val model = model()
        model.line(ReminderLine.NextAt(9 * 60))

        clock.setTo(at(8, 40))
        runBlocking { repository.addDrink(THE_DAY, 8 * 60 + 40, 250) }

        model.line(ReminderLine.NextAt(9 * 60 + 40))
    }

    @Test
    fun withTheGoalMetTheLineSaysSo() {
        remindersOn()
        runBlocking { repository.addDrink(THE_DAY, 7 * 60, 2_000) }

        model().line(ReminderLine.GoalReached)
    }

    @Test
    fun whenNoReminderFitsInTheRestOfTodayTheLineSaysNoMore() {
        remindersOn()
        clock.setTo(at(21, 30))
        runBlocking { repository.addDrink(THE_DAY, 21 * 60 + 30, 250) }

        model().line(ReminderLine.NoneLeftToday)
    }

    @Test
    fun whenNoReminderFitsOnAnyDayTheLineSaysNoMoreToday() {
        // Every 3 hours, from 08:00 until 10:00 (the owner's decision in step 2.4).
        remindersOn { it.copy(intervalMinutes = 180, untilMinute = 10 * 60) }

        model().line(ReminderLine.NoneLeftToday)
    }

    // The state of notifications comes first.

    @Test
    fun beforeAndroidAskedTheLineOffersAllow() {
        water.device.allowNotifications(false)
        remindersOn()

        model().line(ReminderLine.NotAsked)
    }

    @Test
    fun afterANoTheLineSaysRemindersAreSilentAndOpensTheAppsNotificationPage() {
        water.device.allowNotifications(false)
        remindersOn()
        val model = model()

        model.answered()

        model.line(ReminderLine.Denied)
        val page = model.settingsIntent()
        assertEquals(Settings.ACTION_APP_NOTIFICATION_SETTINGS, page.action)
        assertEquals(water.app.packageName, page.getStringExtra(Settings.EXTRA_APP_PACKAGE))
    }

    @Test
    fun aChannelTurnedOffIsNamedAndOpensTheChannelsPage() {
        remindersOn()
        val model = model()
        water.device.turnOff(WaterReminders.CHANNEL)

        model.refresh()

        model.line(ReminderLine.ChannelOff)
        assertEquals(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS, model.settingsIntent().action)
        assertEquals("drink-reminders", model.settingsIntent().getStringExtra(Settings.EXTRA_CHANNEL_ID))
    }

    @Test
    fun theStateIsReadAgainWhenTheScreenComesToTheFront() {
        water.device.allowNotifications(false)
        remindersOn()
        val model = model()
        model.line(ReminderLine.NotAsked)

        // The user allowed notifications in Android's settings.
        water.device.allowNotifications(true)
        model.refresh()

        model.line(ReminderLine.NextAt(9 * 60))
    }

    // The question.

    @Test
    fun turningRemindersOnBeforeAndroidAskedStartsTheQuestion() {
        water.device.allowNotifications(false)
        val model = model()
        remindersOn()

        model.remindersTurnedOn()

        assertTrue(model.state.await { it.asking }.asking)
    }

    @Test
    fun turningRemindersOnWhenNotificationsAreAllowedAsksNothing() {
        val model = model()
        remindersOn()

        model.remindersTurnedOn()

        assertFalse(model.state.await { it.line != null }.asking)
    }

    @Test
    fun notNowClosesTheQuestionAndRemindersStayOn() {
        water.device.allowNotifications(false)
        remindersOn()
        val model = model()
        model.remindersTurnedOn()

        model.notNow()

        val screen = model.state.await { !it.asking && it.line != null }
        assertEquals(ReminderLine.NotAsked, screen.line)
    }

    @Test
    fun allowOnTheLineStartsTheQuestionAndContinueClosesIt() {
        water.device.allowNotifications(false)
        remindersOn()
        val model = model()

        model.allow()
        model.state.await { it.asking }
        model.continueAsking()

        assertFalse(model.state.await { !it.asking }.asking)
    }

    @Test
    fun afterOneAnswerWaterNeverAsksAgain() {
        water.device.allowNotifications(false)
        remindersOn()
        val model = model()
        model.answered()

        model.allow()
        model.remindersTurnedOn()

        assertFalse(model.state.await { it.line == ReminderLine.Denied }.asking)
    }

    @Test
    fun aYesMakesTheLineNameTheNextReminder() {
        water.device.allowNotifications(false)
        remindersOn()
        val model = model()

        water.device.allowNotifications(true)
        model.answered()

        model.line(ReminderLine.NextAt(9 * 60))
    }
}
