package app.shkriuss.feature.reminders

import android.provider.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The line about notifications, the question for notifications and a tap
 * on a notification (docs/apps/reminders/spec.md, "Upcoming", point 2,
 * "As in Water", asking for notifications, and "The notification", point
 * 6), on Robolectric's Android, where a test allows notifications or not
 * and turns the channel off.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = NotifyTestApp::class)
class NotificationsViewModelTest {
    private val setup = AlarmsSetup()

    @After
    fun closeTheDatabase() = setup.database.close()

    private fun model() = NotificationsViewModel(setup.alarms, setup.repository, setup.services.time, Dispatchers.Unconfined)

    @Test
    fun whileNotificationsShowThereIsNoLine() {
        assertNull(model().state.value.line)
    }

    @Test
    fun beforeAndroidAskedTheLineOffersAllowAndAfterANoOpenSettings() {
        setup.device.allowNotifications(false)
        val model = model()
        assertEquals(NotificationLine.NOT_ASKED, model.state.value.line)

        model.allow()
        assertTrue(model.state.value.asking)
        model.continueAsking()
        assertFalse(model.state.value.asking)
        // Android's question came back with a no.
        model.answered()

        assertEquals(NotificationLine.DENIED, model.state.value.line)
        assertEquals(Settings.ACTION_APP_NOTIFICATION_SETTINGS, model.settingsIntent().action)
        model.allow()
        assertFalse("after one answer Reminders never asks again", model.state.value.asking)
    }

    @Test
    fun withTheChannelOffTheLineSaysSoAndOpensTheChannelsPage() {
        val model = model()
        setup.device.turnOff(RemindersAlarms.CHANNEL)

        model.refresh()

        assertEquals(NotificationLine.CHANNEL_OFF, model.state.value.line)
        val page = model.settingsIntent()
        assertEquals(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS, page.action)
        assertEquals(RemindersAlarms.CHANNEL.id, page.getStringExtra(Settings.EXTRA_CHANNEL_ID))
    }

    @Test
    fun theQuestionComesAfterEverySaveWhileAndroidHasNotAsked() {
        setup.device.allowNotifications(false)
        val model = model()

        model.saved()
        assertTrue(model.state.value.asking)
        model.notNow()
        assertFalse(model.state.value.asking)
        assertEquals(NotificationLine.NOT_ASKED, model.state.value.line)

        // The owner's decision: after Not now, the next save asks again.
        model.saved()
        assertTrue(model.state.value.asking)
    }

    @Test
    fun noQuestionAfterASaveWhileNotificationsShowOrAfterAnAnswer() {
        val model = model()
        model.saved()
        assertFalse(model.state.value.asking)

        setup.device.allowNotifications(false)
        model.answered()
        model.saved()
        assertFalse(model.state.value.asking)
    }

    @Test
    fun aTapOpensTheReminderOnTheListItIsIn() {
        val pills = setup.add("Pills", pills(), savedAt = day(-1, 9, 30))
        val bank = setup.add("Call the bank", CALL_THE_BANK, savedAt = monday(8))
        // Pills at 09:00 first, then Call the bank at 14:00.
        setup.fireAt(monday(14))
        setup.fireAt(monday(14))
        checkNotNull(setup.shown(bank))
        val model = model()

        model.open(pills.id)
        assertEquals(TappedReminder.Open(pills, past = false), model.state.await { it.tapped != null }.tapped)
        model.tapOpened()
        // The screen's state follows on the thread that last changed it, here the database's: it is awaited, not read at once.
        assertNull(model.state.await { it.tapped == null }.tapped)

        model.open(bank.id)
        assertEquals("a one-time reminder that showed is past", TappedReminder.Open(bank, past = true), model.state.await { it.tapped != null }.tapped)
    }

    @Test
    fun aTapForADeletedReminderOrAnUnknownIdOpensUpcoming() {
        val pills = setup.add("Pills", pills(), savedAt = day(-1, 9, 30))
        runBlocking { setup.repository.delete(listOf(pills.id)) }
        val model = model()

        model.open(pills.id)
        assertEquals(TappedReminder.Missing, model.state.await { it.tapped != null }.tapped)
        model.tapOpened()
        // Gone first, so that the next answer is the one for the unknown id.
        model.state.await { it.tapped == null }
        model.open("no-such-reminder")
        assertEquals(TappedReminder.Missing, model.state.await { it.tapped != null }.tapped)
    }
}
