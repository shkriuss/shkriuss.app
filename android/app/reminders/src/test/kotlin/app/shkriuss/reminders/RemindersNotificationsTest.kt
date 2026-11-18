package app.shkriuss.reminders

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
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.shkriuss.core.notify.R as NotifyR
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.feature.reminders.R
import app.shkriuss.feature.reminders.RemindersAlarms
import app.shkriuss.feature.reminders.Repeat
import app.shkriuss.feature.reminders.Schedule
import java.time.LocalDateTime
import java.time.ZoneOffset
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
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
 * Reminders' notifications from end to end, as on a phone
 * (docs/apps/reminders/spec.md, "The notification", "Upcoming", point 2,
 * and "As in Water", asking for notifications): Android's `AlarmManager`
 * fires the alarm as a broadcast to the receiver of core/notify in
 * Reminders' merged manifest, the notification shows, its buttons send
 * their pending intents to the button receiver, and a tap starts the real
 * activity with the reminder's id. Then the line on Upcoming, the
 * question before Android's own, and **Open settings**.
 *
 * On Monday 16 November 2026 from 09:30, in UTC, with the 24-hour clock.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = NotifyingRemindersApp::class, qualifiers = PHONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemindersNotificationsTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val app = ApplicationProvider.getApplicationContext<NotifyingRemindersApp>()
    private val device = NotifyTestDevice(app)
    private var scenario: ActivityScenario<RemindersActivity>? = null

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

    /** Starts Reminders with [intent], as the launcher or a tap does, and waits until it shows [ready]. */
    private fun start(ready: String, intent: Intent = Intent(app, RemindersActivity::class.java)) {
        scenario = ActivityScenario.launch(intent)
        compose.waitForText(ready)
    }

    /** What a tap on the notification of the reminder [id] starts. */
    private fun tapOn(id: String): Intent = Intent(app, RemindersActivity::class.java).setIdentifier(id)

    private fun destination(label: Int) = compose.onNode(
        hasText(words(label)) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Selected),
    )

    private fun nothingShows(text: String) =
        assertTrue("$text shows", compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isEmpty())

    // The notification.

    @Test
    fun atItsTimeAReminderShowsThroughAndroidsAlarmWithItsTitleAndButtons() {
        val pills = runBlocking { app.test.services.repository.addSaved("Pills", Schedule(Repeat.DAILY, TODAY, 9 * 60)) }
        assertEquals(listOf(millis(TODAY.plusDays(1).atTime(9, 0))), device.waitingAlarms())

        setClock(TODAY.plusDays(1).atTime(9, 0))
        device.fireTheAlarm()

        val shown = checkNotNull(device.shown(pills.id)) { "The reminder does not show" }
        assertEquals("Pills", shown.title)
        assertEquals("Every day", shown.text)
        assertEquals(listOf("Done", "Snooze 10 min"), shown.buttons)
        assertEquals(RemindersAlarms.CHANNEL.id, shown.channelId)
        val tap = checkNotNull(shown.tap)
        assertEquals(RemindersActivity::class.java.name, tap.component?.className)
        assertEquals(pills.id, tap.identifier)
        val newScreen = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        assertEquals("the screen starts anew", newScreen, tap.flags and newScreen)
    }

    @Test
    fun snoozeAndDoneOnTheNotificationWorkThroughTheButtonReceiver() {
        val pills = runBlocking { app.test.services.repository.addSaved("Pills", Schedule(Repeat.DAILY, TODAY, 9 * 60)) }
        setClock(TODAY.plusDays(1).atTime(9, 0))
        device.fireTheAlarm()

        setClock(TODAY.plusDays(1).atTime(9, 2))
        device.press(pills.id, 1)
        assertNull(device.shown(pills.id))
        assertEquals(listOf(millis(TODAY.plusDays(1).atTime(9, 12))), device.waitingAlarms())

        setClock(TODAY.plusDays(1).atTime(9, 12))
        device.fireTheAlarm()
        assertEquals("Snoozed. It was due at 09:00.", device.shown(pills.id)?.text)
        device.press(pills.id, 0)

        assertNull(device.shown(pills.id))
        assertEquals(listOf(millis(TODAY.plusDays(2).atTime(9, 0))), device.waitingAlarms())
    }

    @Test
    fun afterANewStartOfTheAppTheAlarmsAreSetAgain() {
        runBlocking { app.test.services.repository.addSaved("Pills", Schedule(Repeat.DAILY, TODAY, 9 * 60)) }
        device.forgetTheAlarms()

        app.test.notify.start()

        assertEquals(listOf(millis(TODAY.plusDays(1).atTime(9, 0))), device.waitingAlarms())
    }

    // A tap on a notification.

    @Test
    fun aTapOpensTheFormOfAReminderThatRepeatsOnUpcoming() {
        val pills = runBlocking { app.test.services.repository.addSaved("Pills", Schedule(Repeat.DAILY, TODAY, 9 * 60)) }

        start(ready = words(R.string.reminders_edit_reminder), intent = tapOn(pills.id))

        destination(R.string.reminders_upcoming).assertIsSelected()
        compose.field(words(R.string.reminders_title)).assert(hasText("Pills"))
    }

    @Test
    fun aTapOnAOneTimeReminderThatShowedOpensItsFormOnPast() {
        val bank = runBlocking { app.test.services.repository.addSaved("Call the bank", Schedule(Repeat.ONCE, TODAY, 10 * 60)) }
        setClock(TODAY.atTime(10, 0))
        device.fireTheAlarm()

        start(ready = words(R.string.reminders_edit_reminder), intent = tapOn(bank.id))

        destination(R.string.reminders_past).assertIsSelected()
        compose.field(words(R.string.reminders_title)).assert(hasText("Call the bank"))
    }

    @Test
    fun aTapForAReminderThatIsGoneOpensUpcoming() {
        val pills = runBlocking { app.test.services.repository.addSaved("Pills", Schedule(Repeat.DAILY, TODAY, 9 * 60)) }
        runBlocking { app.test.services.repository.delete(listOf(pills.id)) }

        start(ready = words(R.string.reminders_upcoming_empty_title), intent = tapOn(pills.id))

        destination(R.string.reminders_upcoming).assertIsSelected()
        nothingShows(words(R.string.reminders_edit_reminder))
    }

    @Test
    fun aTapOnTheNoticeOfCoreNotifyStartsRemindersAnewWithTheFormOfItsReminder() {
        val pills = runBlocking { app.test.services.repository.addSaved("Pills", Schedule(Repeat.DAILY, TODAY, 9 * 60)) }
        // A reminder whose tap would open another app is refused: the handler fails while it shows it.
        app.restart(open = Intent().setComponent(ComponentName("org.example.other", "org.example.other.Screen")))
        setClock(TODAY.plusDays(1).atTime(9, 0))
        device.fireTheAlarm()

        val notice = checkNotNull(device.shown(pills.id)) { "The notice does not show" }
        assertEquals(app.getString(NotifyR.string.notify_reminder_failed), notice.text)
        val tap = checkNotNull(notice.tap)
        assertEquals(RemindersActivity::class.java.name, tap.component?.className)
        assertEquals("the alarm's id, which is the reminder's", pills.id, tap.identifier)
        val newScreen = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        assertEquals("Reminders starts anew, with no second screen on top", newScreen, tap.flags and newScreen)

        start(ready = words(R.string.reminders_edit_reminder), intent = tap)

        compose.field(words(R.string.reminders_title)).assert(hasText("Pills"))
    }

    @Test
    fun afterATapTurningThePhoneLeavesTheFormAsTheUserLeftIt() {
        val pills = runBlocking { app.test.services.repository.addSaved("Pills", Schedule(Repeat.DAILY, TODAY, 9 * 60)) }
        start(ready = words(R.string.reminders_edit_reminder), intent = tapOn(pills.id))
        compose.tap(R.string.reminders_cancel)
        compose.waitForGone(hasText(words(R.string.reminders_edit_reminder)))

        checkNotNull(scenario).recreate()

        compose.waitForText("Pills")
        nothingShows(words(R.string.reminders_edit_reminder))
    }

    @Test
    fun openingRemindersAgainFromRecentsDoesNotOpenTheFormOfAnOldTap() {
        val pills = runBlocking { app.test.services.repository.addSaved("Pills", Schedule(Repeat.DAILY, TODAY, 9 * 60)) }
        // The tap started the task, so Android passes its intent again when the user opens Reminders from Recents.
        val fromRecents = tapOn(pills.id).addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY)

        start(ready = "Pills", intent = fromRecents)

        destination(R.string.reminders_upcoming).assertIsSelected()
        nothingShows(words(R.string.reminders_edit_reminder))
    }

    // The line on Upcoming and the question.

    @Test
    fun beforeAndroidAskedUpcomingSaysSoAndAllowExplainsFirst() {
        device.allowNotifications(false)
        seed { addSaved("Pills", Schedule(Repeat.DAILY, TODAY, 9 * 60)) }
        start(ready = "Pills")
        compose.waitForText(words(R.string.reminders_line_not_asked))

        compose.tap(R.string.reminders_allow)
        compose.waitForText(words(R.string.reminders_question_title))
        compose.waitForText(words(R.string.reminders_question_text))
        compose.tap(R.string.reminders_not_now)

        compose.waitForGone(hasText(words(R.string.reminders_question_text)))
        compose.waitForText(words(R.string.reminders_line_not_asked))
        checkNotNull(scenario).onActivity { assertNull("Android was not asked", shadowOf(it).lastRequestedPermission) }
    }

    @Test
    fun theLineAndItsButtonComeBeforeTheList() {
        device.allowNotifications(false)
        seed { addSaved("Pills", Schedule(Repeat.DAILY, TODAY, 9 * 60)) }
        start(ready = "Pills")

        val line = compose.onNode(hasText(words(R.string.reminders_line_not_asked))).fetchSemanticsNode().boundsInRoot
        val allow = compose.onNode(hasText(words(R.string.reminders_allow)) and hasClickAction()).fetchSemanticsNode().boundsInRoot
        val row = compose.onNode(hasText("Pills") and hasClickAction()).fetchSemanticsNode().boundsInRoot
        assertTrue("its button is under the line", allow.top >= line.bottom)
        assertTrue("the list is under both", row.top >= allow.bottom)
    }

    @Test
    fun withNoUpcomingReminderThereIsNoLine() {
        device.allowNotifications(false)

        start(ready = words(R.string.reminders_upcoming_empty_title))

        nothingShows(words(R.string.reminders_line_not_asked))
    }

    @Test
    fun aSaveBeforeAndroidAskedExplainsAndContinueStartsAndroidsQuestion() {
        device.allowNotifications(false)
        start(ready = words(R.string.reminders_upcoming_empty_title))
        compose.tap(R.string.reminders_add)
        compose.field(words(R.string.reminders_title)).performTextInput("Pills")
        compose.tap(R.string.reminders_save)

        compose.waitForText(words(R.string.reminders_question_text))
        compose.tap(R.string.reminders_continue)

        checkNotNull(scenario).onActivity { activity ->
            val asked = checkNotNull(shadowOf(activity).lastRequestedPermission) { "Android's question was not asked" }
            assertEquals(listOf(Manifest.permission.POST_NOTIFICATIONS), asked.requestedPermissions.toList())
        }
        // Robolectric shows no question: the request comes back without a yes, as a no does.
        compose.waitForText(words(R.string.reminders_line_denied))
        compose.waitForText(words(R.string.reminders_open_settings))
    }

    @Test
    fun aSaveWhileNotificationsShowAsksNothing() {
        start(ready = words(R.string.reminders_upcoming_empty_title))
        compose.tap(R.string.reminders_add)
        compose.field(words(R.string.reminders_title)).performTextInput("Pills")
        compose.tap(R.string.reminders_save)

        compose.waitForText("Pills")
        nothingShows(words(R.string.reminders_question_text))
    }

    @Test
    fun afterANoOpenSettingsOpensAndroidsNotificationPageForReminders() {
        device.allowNotifications(false)
        app.test.notify.permissionAnswered()
        seed { addSaved("Pills", Schedule(Repeat.DAILY, TODAY, 9 * 60)) }
        start(ready = "Pills")
        compose.waitForText(words(R.string.reminders_line_denied))

        compose.tap(R.string.reminders_open_settings)

        val opened = checkNotNull(shadowOf(app).nextStartedActivity)
        assertEquals(Settings.ACTION_APP_NOTIFICATION_SETTINGS, opened.action)
        assertEquals(app.packageName, opened.getStringExtra(Settings.EXTRA_APP_PACKAGE))
    }

    @Test
    fun withTheChannelOffTheLineSaysSoAndOpenSettingsOpensTheChannel() {
        seed { addSaved("Pills", Schedule(Repeat.DAILY, TODAY, 9 * 60)) }
        device.turnOff(RemindersAlarms.CHANNEL)
        start(ready = "Pills")
        compose.waitForText(words(R.string.reminders_line_channel_off))

        compose.tap(R.string.reminders_open_settings)

        val opened = checkNotNull(shadowOf(app).nextStartedActivity)
        assertEquals(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS, opened.action)
        assertEquals(RemindersAlarms.CHANNEL.id, opened.getStringExtra(Settings.EXTRA_CHANNEL_ID))
    }
}

/** The day the tests start on: Monday 16 November 2026. */
private val TODAY = THE_TIME.toLocalDate()

/** A phone, close to the Pixel 9 Pro, as in the screenshots. */
private const val PHONE = "w411dp-h914dp-normal-long-notround-port-420dpi"
