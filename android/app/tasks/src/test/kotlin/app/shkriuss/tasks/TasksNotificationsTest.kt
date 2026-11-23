package app.shkriuss.tasks

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.shkriuss.core.notify.R as NotifyR
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.feature.tasks.Due
import app.shkriuss.feature.tasks.R
import app.shkriuss.feature.tasks.Repeat
import app.shkriuss.feature.tasks.TaskRepeat
import app.shkriuss.feature.tasks.TasksAlarms
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Tasks' reminders from end to end, as on a phone
 * (docs/apps/tasks/spec.md, "Reminders of a task", "The notification",
 * "Today", point 2, and "As in Water and Reminders", asking for
 * notifications): Android's `AlarmManager` fires the alarm as a broadcast
 * to the receiver of core/notify in Tasks' merged manifest, the
 * notification shows, its buttons send their pending intents to the
 * button receiver, and a tap starts the real activity with the task's id.
 * Then the line on Today, the question before Android's own, and **Open
 * settings**.
 *
 * On Monday 16 November 2026 from 09:30, in UTC, with the 24-hour clock.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = NotifyingTasksApp::class, qualifiers = PHONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TasksNotificationsTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val app = ApplicationProvider.getApplicationContext<NotifyingTasksApp>()
    private val device = NotifyTestDevice(app)
    private var scenario: ActivityScenario<TasksActivity>? = null

    @Before
    fun withNotificationsAllowed() {
        use24HourClock()
        device.allowNotifications(true)
    }

    @After
    fun closeTheScreen() {
        scenario?.close()
    }

    private fun millis(time: LocalDateTime): Long = time.toInstant(ZoneOffset.UTC).toEpochMilli()

    private fun setClock(time: LocalDateTime) {
        app.test.clock.nowMillis = millis(time)
    }

    /** Starts Tasks with [intent], as the launcher or a tap does, and waits until it shows [ready]. */
    private fun start(ready: String, intent: Intent = Intent(app, TasksActivity::class.java)) {
        scenario = ActivityScenario.launch(intent)
        compose.waitForText(ready)
    }

    /** What a tap on the notification of the task [id] starts. */
    private fun tapOn(id: String): Intent = Intent(app, TasksActivity::class.java).setIdentifier(id)

    private fun destination(label: Int) = compose.onNode(
        hasText(words(label)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected),
    )

    private fun nothingShows(text: String) =
        assertTrue("$text shows", compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isEmpty())

    /** "Pills": every day from today, due today at 10:00, saved at 09:30. */
    private fun savePills() = seed { addTask("Pills", Due(TODAY, TaskRepeat(Repeat.DAILY, TODAY), 10 * 60)) }

    // The notification.

    @Test
    fun atItsTimeATaskShowsThroughAndroidsAlarmWithItsTitleAndButtons() {
        val pills = savePills()
        assertEquals(listOf(millis(TODAY.atTime(10, 0))), device.waitingAlarms())

        setClock(TODAY.atTime(10, 0))
        device.fireTheAlarm()

        val shown = checkNotNull(device.shown(pills.id)) { "The reminder does not show" }
        assertEquals("Pills", shown.title)
        assertEquals("Due today · Every day", shown.text)
        assertEquals(listOf("Done", "Snooze 10 min"), shown.buttons)
        assertEquals(TasksAlarms.CHANNEL.id, shown.channelId)
        val tap = checkNotNull(shown.tap)
        assertEquals(TasksActivity::class.java.name, tap.component?.className)
        assertEquals(pills.id, tap.identifier)
        val newScreen = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        assertEquals("the screen starts anew", newScreen, tap.flags and newScreen)
    }

    @Test
    fun snoozeAndDoneOnTheNotificationWorkThroughTheButtonReceiver() {
        val pills = savePills()
        setClock(TODAY.atTime(10, 0))
        device.fireTheAlarm()

        setClock(TODAY.atTime(10, 2))
        device.press(pills.id, 1)
        assertNull(device.shown(pills.id))
        assertEquals(listOf(millis(TODAY.atTime(10, 12))), device.waitingAlarms())

        setClock(TODAY.atTime(10, 12))
        device.fireTheAlarm()
        assertEquals("Snoozed. It was due at 10:00.", device.shown(pills.id)?.text)
        device.press(pills.id, 0)

        assertNull(device.shown(pills.id))
        assertEquals("Done moved Pills to tomorrow", TODAY.plusDays(1), storedTasks().single().due?.day)
        assertEquals(listOf(millis(TODAY.plusDays(1).atTime(10, 0))), device.waitingAlarms())
    }

    @Test
    fun afterANewStartOfTheAppTheAlarmsAreSetAgain() {
        savePills()
        device.forgetTheAlarms()

        app.test.notify.start()

        assertEquals(listOf(millis(TODAY.atTime(10, 0))), device.waitingAlarms())
    }

    // A tap on a notification.

    @Test
    fun aTapOpensTheTasksListWithItsForm() {
        val bank = seed {
            val home = addAList("Home")
            addTask("Call the bank", Due(TODAY, null, 14 * 60), listId = home.id)
        }

        start(ready = words(R.string.tasks_edit_task), intent = tapOn(bank.id))

        destination(R.string.tasks_lists).assertIsSelected()
        compose.waitFor(hasText("Home") and isHeading())
        compose.field(words(R.string.tasks_title)).assert(hasText("Call the bank"))
    }

    @Test
    fun aTapOnATaskInInboxOpensInbox() {
        val pills = savePills()

        start(ready = words(R.string.tasks_edit_task), intent = tapOn(pills.id))

        destination(R.string.tasks_lists).assertIsSelected()
        compose.waitFor(hasText(words(R.string.tasks_inbox)) and isHeading())
        compose.field(words(R.string.tasks_title)).assert(hasText("Pills"))
    }

    @Test
    fun aTapForATaskThatIsGoneOpensToday() {
        val pills = savePills()
        runBlocking { app.test.services.repository.deleteTask(pills.id) }

        start(ready = words(R.string.tasks_nothing_due_today), intent = tapOn(pills.id))

        destination(R.string.tasks_today).assertIsSelected()
        nothingShows(words(R.string.tasks_edit_task))
    }

    @Test
    fun aTapOnTheNoticeOfCoreNotifyStartsTasksAnewWithTheFormOfItsTask() {
        val pills = savePills()
        // A reminder whose tap would open another app is refused: the handler fails while it shows it.
        app.restart(open = Intent().setComponent(ComponentName("org.example.other", "org.example.other.Screen")))
        setClock(TODAY.atTime(10, 0))
        device.fireTheAlarm()

        val notice = checkNotNull(device.shown(pills.id)) { "The notice does not show" }
        assertEquals(app.getString(NotifyR.string.notify_reminder_failed), notice.text)
        val tap = checkNotNull(notice.tap)
        assertEquals(TasksActivity::class.java.name, tap.component?.className)
        assertEquals("the alarm's id, which is the task's", pills.id, tap.identifier)

        start(ready = words(R.string.tasks_edit_task), intent = tap)

        compose.field(words(R.string.tasks_title)).assert(hasText("Pills"))
    }

    @Test
    fun afterATapTurningThePhoneLeavesTheScreenAsTheUserLeftIt() {
        val pills = savePills()
        start(ready = words(R.string.tasks_edit_task), intent = tapOn(pills.id))
        compose.tap(R.string.tasks_cancel)
        compose.waitForGone(hasText(words(R.string.tasks_edit_task)))

        checkNotNull(scenario).recreate()

        compose.waitForText("Pills")
        nothingShows(words(R.string.tasks_edit_task))
    }

    @Test
    fun openingTasksAgainFromRecentsDoesNotOpenTheFormOfAnOldTap() {
        val pills = savePills()
        // The tap started the task, so Android passes its intent again when the user opens Tasks from Recents.
        val fromRecents = tapOn(pills.id).addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY)

        start(ready = "Pills", intent = fromRecents)

        destination(R.string.tasks_today).assertIsSelected()
        nothingShows(words(R.string.tasks_edit_task))
    }

    // The line on Today and the question.

    @Test
    fun beforeAndroidAskedTodaySaysSoAndAllowExplainsFirst() {
        device.allowNotifications(false)
        savePills()
        start(ready = "Pills")
        compose.waitForText(words(R.string.tasks_line_not_asked))

        compose.tap(R.string.tasks_allow)
        compose.waitForText(words(R.string.tasks_question_title))
        compose.waitForText(words(R.string.tasks_question_text))
        compose.tap(R.string.tasks_not_now)

        compose.waitForGone(hasText(words(R.string.tasks_question_text)))
        compose.waitForText(words(R.string.tasks_line_not_asked))
        checkNotNull(scenario).onActivity { assertNull("Android was not asked", shadowOf(it).lastRequestedPermission) }
    }

    @Test
    fun theLineAndItsButtonComeBeforeTheSections() {
        device.allowNotifications(false)
        savePills()
        start(ready = "Pills")

        val line = compose.onNode(hasText(words(R.string.tasks_line_not_asked))).fetchSemanticsNode().boundsInRoot
        val allow = compose.onNode(hasText(words(R.string.tasks_allow)) and hasClickAction()).fetchSemanticsNode().boundsInRoot
        val row = compose.onNode(rowMatcher("Pills")).fetchSemanticsNode().boundsInRoot
        assertTrue("its button is under the line", allow.top >= line.bottom)
        assertTrue("the sections are under both", row.top >= allow.bottom)
    }

    @Test
    fun aReminderToComeOnAnotherDayShowsTheLineOverNothingDueToday() {
        device.allowNotifications(false)
        seed { addTask("Call the bank", Due(TODAY.plusDays(3), null, 14 * 60)) }

        start(ready = words(R.string.tasks_nothing_due_today))

        compose.waitForText(words(R.string.tasks_line_not_asked))
    }

    @Test
    fun withNoReminderToComeThereIsNoLine() {
        device.allowNotifications(false)
        // Due today with no reminder, and a reminder at 09:00 that passed before it was saved.
        seed {
            addTask("Water the plants", Due(TODAY))
            addTask("Pills", Due(TODAY, null, 9 * 60))
        }

        start(ready = "Pills")

        nothingShows(words(R.string.tasks_line_not_asked))
    }

    @Test
    fun aSaveThatSetsAReminderBeforeAndroidAskedExplainsAndContinueStartsAndroidsQuestion() {
        device.allowNotifications(false)
        start(ready = words(R.string.tasks_nothing_due_today))
        compose.tap(R.string.tasks_add)
        compose.field(words(R.string.tasks_title)).performTextInput("Pills")
        compose.tap(R.string.tasks_remind_me)
        compose.tap(R.string.tasks_save)

        compose.waitForText(words(R.string.tasks_question_text))
        compose.tap(R.string.tasks_continue)

        checkNotNull(scenario).onActivity { activity ->
            val asked = checkNotNull(shadowOf(activity).lastRequestedPermission) { "Android's question was not asked" }
            assertEquals(listOf(Manifest.permission.POST_NOTIFICATIONS), asked.requestedPermissions.toList())
        }
        // Robolectric shows no question: the request comes back without a yes, as a no does.
        compose.waitForText(words(R.string.tasks_line_denied))
        compose.waitForText(words(R.string.tasks_open_settings))
    }

    @Test
    fun aSaveWithNoReminderAsksNothing() {
        device.allowNotifications(false)
        start(ready = words(R.string.tasks_nothing_due_today))
        compose.tap(R.string.tasks_add)
        compose.field(words(R.string.tasks_title)).performTextInput("Water the plants")
        compose.tap(R.string.tasks_save)

        compose.waitForText("Water the plants")
        nothingShows(words(R.string.tasks_question_text))
        assertNotNull(storedTasks().singleOrNull())
    }

    @Test
    fun aSaveWhileNotificationsShowAsksNothing() {
        start(ready = words(R.string.tasks_nothing_due_today))
        compose.tap(R.string.tasks_add)
        compose.field(words(R.string.tasks_title)).performTextInput("Pills")
        compose.tap(R.string.tasks_remind_me)
        compose.tap(R.string.tasks_save)

        compose.waitForText("Pills")
        nothingShows(words(R.string.tasks_question_text))
    }

    @Test
    fun afterANoOpenSettingsOpensAndroidsNotificationPageForTasks() {
        device.allowNotifications(false)
        app.test.notify.permissionAnswered()
        savePills()
        start(ready = "Pills")
        compose.waitForText(words(R.string.tasks_line_denied))

        compose.tap(R.string.tasks_open_settings)

        val opened = checkNotNull(shadowOf(app).nextStartedActivity)
        assertEquals(Settings.ACTION_APP_NOTIFICATION_SETTINGS, opened.action)
        assertEquals(app.packageName, opened.getStringExtra(Settings.EXTRA_APP_PACKAGE))
    }

    @Test
    fun withTheChannelOffTheLineSaysSoAndOpenSettingsOpensTheChannel() {
        savePills()
        device.turnOff(TasksAlarms.CHANNEL)
        start(ready = "Pills")
        compose.waitForText(words(R.string.tasks_line_channel_off))

        compose.tap(R.string.tasks_open_settings)

        val opened = checkNotNull(shadowOf(app).nextStartedActivity)
        assertEquals(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS, opened.action)
        assertEquals(TasksAlarms.CHANNEL.id, opened.getStringExtra(Settings.EXTRA_CHANNEL_ID))
    }
}

/** The day the tests start on: Monday 16 November 2026. */
private val TODAY: LocalDate = THE_TIME.toLocalDate()

/** A phone, close to the Pixel 9 Pro, as in the screenshots. */
private const val PHONE = "w411dp-h914dp-normal-long-notround-port-420dpi"
