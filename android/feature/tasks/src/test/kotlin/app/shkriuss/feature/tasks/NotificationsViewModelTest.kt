package app.shkriuss.feature.tasks

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
 * on a notification (docs/apps/tasks/spec.md, "Today", point 2, "As in
 * Water and Reminders", asking for notifications, and "The notification",
 * point 2), on Robolectric's Android, where a test allows notifications
 * or not and turns the channel off.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = NotifyTestApp::class)
class NotificationsViewModelTest {
    private val setup = AlarmsSetup()

    @After
    fun closeTheDatabase() = setup.database.close()

    private fun model() = NotificationsViewModel(setup.alarms, setup.repository, Dispatchers.Unconfined)

    private fun task(due: Due?): Task = setup.add("Call the bank", due, savedAt = monday(8))

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
        assertFalse("after one answer Tasks never asks again", model.state.value.asking)
    }

    @Test
    fun withTheChannelOffTheLineSaysSoAndOpensTheChannelsPage() {
        val model = model()
        setup.device.turnOff(TasksAlarms.CHANNEL)

        model.refresh()

        assertEquals(NotificationLine.CHANNEL_OFF, model.state.value.line)
        val page = model.settingsIntent()
        assertEquals(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS, page.action)
        assertEquals(TasksAlarms.CHANNEL.id, page.getStringExtra(Settings.EXTRA_CHANNEL_ID))
    }

    @Test
    fun theQuestionComesAfterEverySaveThatSetsAReminderWhileAndroidHasNotAsked() {
        setup.device.allowNotifications(false)
        val model = model()
        val bank = task(Due(MONDAY, null, 14 * 60))

        model.saved(bank)
        assertTrue(model.state.value.asking)
        model.notNow()
        assertFalse(model.state.value.asking)
        assertEquals(NotificationLine.NOT_ASKED, model.state.value.line)

        // As in Reminders: after Not now, the next save asks again.
        model.saved(bank)
        assertTrue(model.state.value.asking)
    }

    @Test
    fun noQuestionAfterASaveOfATaskWithNoReminder() {
        setup.device.allowNotifications(false)
        val model = model()

        model.saved(task(Due(MONDAY)))
        model.saved(task(null))

        assertFalse(model.state.value.asking)
    }

    @Test
    fun noQuestionAfterASaveWhileNotificationsShowOrAfterAnAnswer() {
        val model = model()
        val bank = task(Due(MONDAY, null, 14 * 60))
        model.saved(bank)
        assertFalse(model.state.value.asking)

        setup.device.allowNotifications(false)
        model.answered()
        model.saved(bank)
        assertFalse(model.state.value.asking)
    }

    @Test
    fun aTapOpensTheTasksListWithItsForm() {
        val home = runBlocking { checkNotNull(setup.repository.addList("Home")) }
        val bank = setup.add("Call the bank", Due(MONDAY, null, 14 * 60), savedAt = monday(8), listId = home.id)
        val pills = setup.add("Pills", Due(MONDAY, PILLS, 9 * 60), savedAt = monday(8))
        val model = model()

        model.open(bank.id)
        assertEquals(TappedTask.Open(bank, home.id), model.state.await { it.tapped != null }.tapped)
        model.tapOpened()
        // The screen's state follows on the thread that last changed it, here the database's: it is awaited, not read at once.
        assertNull(model.state.await { it.tapped == null }.tapped)

        model.open(pills.id)
        assertEquals(TappedTask.Open(pills, INBOX), model.state.await { it.tapped != null }.tapped)
    }

    @Test
    fun aTapOnATaskWhoseListIsGoneOpensInbox() {
        val home = runBlocking { checkNotNull(setup.repository.addList("Home")) }
        val bank = setup.add("Call the bank", Due(MONDAY, null, 14 * 60), savedAt = monday(8), listId = home.id)
        setup.database.deleteOnlyTheList(home.id, setup.clock)

        val model = model()
        model.open(bank.id)

        assertEquals(TappedTask.Open(bank, INBOX), model.state.await { it.tapped != null }.tapped)
    }

    @Test
    fun aTapForADeletedTaskOrAnUnknownIdOpensToday() {
        val bank = task(Due(MONDAY, null, 14 * 60))
        runBlocking { setup.repository.deleteTask(bank.id) }
        val model = model()

        model.open(bank.id)
        assertEquals(TappedTask.Missing, model.state.await { it.tapped != null }.tapped)
        model.tapOpened()
        // Gone first, so that the next answer is the one for the unknown id.
        model.state.await { it.tapped == null }
        model.open("no-such-task")
        assertEquals(TappedTask.Missing, model.state.await { it.tapped != null }.tapped)
    }
}
