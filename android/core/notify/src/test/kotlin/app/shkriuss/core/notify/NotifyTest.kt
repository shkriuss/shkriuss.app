package app.shkriuss.core.notify

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.os.Looper
import android.provider.Settings
import app.shkriuss.core.testing.TestClock
import java.time.LocalTime
import java.util.concurrent.Executor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * [Notify] as an app uses it, on Robolectric's Android: the channels, the
 * state a screen shows, a notification when an alarm fires, and the
 * alarms after a reboot, an app update and a change of the time or the
 * time zone.
 *
 * The alarms go to Android's `AlarmManager` and come back as broadcasts
 * to the receivers of this module's manifest. The clock is the test's.
 * It starts at 2026-01-01T00:00:00Z.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class)
class NotifyTest {
    private val context = RuntimeEnvironment.getApplication() as TestApp
    private val clock = TestClock()
    private val app = TestReminders(clock)
    private val alarmManager = shadowOf(context.getSystemService(AlarmManager::class.java))
    private val notificationManager = context.getSystemService(NotificationManager::class.java)
    private val shownBy = shadowOf(notificationManager)

    private val reminders = NotifyChannel("reminders", android.R.string.ok, android.R.string.cancel, ChannelImportance.Urgent)
    private val summaries = NotifyChannel("summaries", android.R.string.copy, android.R.string.paste, ChannelImportance.Quiet)
    private val open = Intent().setComponent(ComponentName(context, "app.shkriuss.core.notify.SomeScreen"))

    private val start = TestClock.START_MILLIS
    private val a = AlarmId("a")

    /** The app's handler: it shows the reminder, as an app would. */
    private val handler = AlarmHandler { alarm, notifications ->
        app.onAlarm(alarm, notifications)
        notifications.show(
            ShkNotification(alarm.id.value, reminders, "Water the plants", "In the kitchen", android.R.drawable.ic_dialog_info, open, alarm.atMillis),
        )
    }

    @Before
    fun anAppSetUpForNotify() {
        shownBy.setNotificationsEnabled(true)
        context.notify = newNotify()
    }

    /** What the app class builds when the app starts. The worker runs each piece at once, so a test needs no waiting. */
    private fun newNotify() = Notify(context, listOf(reminders, summaries), app, handler, clock, worker = Executor { it.run() })

    private fun waiting() = alarmManager.waiting()

    /** Time passes: the clock moves, and Android fires what is due, as broadcasts to the manifest's receiver. */
    private fun advanceBy(millis: Long) {
        clock.advanceBy(millis)
        while (true) {
            val due = alarmManager.scheduledAlarms.filter { it.triggerAtMs <= clock.nowMillis() }.minByOrNull { it.triggerAtMs } ?: return
            alarmManager.fireAlarm(due)
            shadowOf(Looper.getMainLooper()).idle()
        }
    }

    /** Android sends one of its own broadcasts to the app. */
    private fun androidSends(action: String) {
        context.sendBroadcast(Intent(action).setPackage(context.packageName))
        shadowOf(Looper.getMainLooper()).idle()
    }

    // Start.

    @Test
    fun startTellsAndroidTheChannels() {
        context.notify.start()

        val channel = notificationManager.getNotificationChannel("reminders")
        assertEquals(context.getString(android.R.string.ok), channel.name)
        assertEquals(context.getString(android.R.string.cancel), channel.description)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, channel.importance)
        assertEquals(Notification.VISIBILITY_PRIVATE, channel.lockscreenVisibility)
        assertEquals(NotificationManager.IMPORTANCE_LOW, notificationManager.getNotificationChannel("summaries").importance)
        assertEquals(2, notificationManager.notificationChannels.size)
    }

    @Test
    fun startRegistersTheAlarms() {
        app.reminders += TestReminder.Once(a, start + HOUR)

        context.notify.start()

        assertEquals(mapOf<String?, Long>("a" to start + HOUR), waiting())
    }

    @Test
    fun startFailsWhenTheAppClassIsNoNotifyHost() {
        // An app whose app class is some other class.
        val otherApp = object : ContextWrapper(context) {
            override fun getApplicationContext(): Context = this
        }
        val notify = Notify(otherApp, listOf(reminders), app, handler, clock, FakeAlarmScheduler(), Executor { it.run() })

        assertThrows(IllegalStateException::class.java) { notify.start() }
        assertEquals(0, notificationManager.notificationChannels.size)
    }

    @Test
    fun thePermissionAScreenAsksForIsTheNotificationPermission() {
        assertEquals(Manifest.permission.POST_NOTIFICATIONS, Notify.PERMISSION)
        assertEquals("android.permission.POST_NOTIFICATIONS", Notify.PERMISSION)
    }

    // An alarm fires.

    @Test
    fun whenAnAlarmFiresTheAppShowsItsNotification() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        context.notify.start()

        advanceBy(HOUR - 1)
        assertEquals(0, shownBy.size())

        advanceBy(1)

        assertEquals(listOf(Alarm(a, start + HOUR)), app.handled)
        val shown = shownBy.getNotification("a", 0)
        assertEquals("Water the plants", shown.extras.getString(Notification.EXTRA_TITLE))
        assertEquals("In the kitchen", shown.extras.getString(Notification.EXTRA_TEXT))
        assertEquals("reminders", shown.channelId)
        assertEquals(start + HOUR, shown.`when`)
        assertEquals(Notification.VISIBILITY_PRIVATE, shown.visibility)
        assertEquals(Notification.CATEGORY_REMINDER, shown.category)
        assertTrue(shown.flags and Notification.FLAG_AUTO_CANCEL != 0)
    }

    @Test
    fun aTapOpensTheScreenTheAppNamed() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        context.notify.start()
        advanceBy(HOUR)

        val tap = shadowOf(shownBy.getNotification("a", 0).contentIntent)

        assertTrue(tap.isActivity)
        assertTrue(tap.isImmutable)
        assertEquals(open.component, tap.savedIntent.component)
        assertEquals("a", tap.savedIntent.identifier)
    }

    @Test
    fun aNotificationOpensOnlyAScreenOfThisApp() {
        val notifications = context.notify.notifications
        val elsewhere = Intent().setComponent(ComponentName("org.example.other", "org.example.other.Screen"))
        val unnamed = Intent(Intent.ACTION_VIEW)

        listOf(elsewhere, unnamed).forEach { target ->
            assertThrows(IllegalArgumentException::class.java) {
                notifications.show(ShkNotification("k", reminders, "t", null, android.R.drawable.ic_dialog_info, target, start))
            }
        }
        assertEquals(0, shownBy.size())
    }

    @Test
    fun aNotificationWithTheSameKeyReplacesTheOldOneAndCancelRemovesIt() {
        context.notify.start()
        val notifications = context.notify.notifications
        fun show(key: String, title: String) =
            notifications.show(ShkNotification(key, reminders, title, null, android.R.drawable.ic_dialog_info, open, start))

        show("one", "First")
        show("two", "Second")
        show("one", "First, changed")

        assertEquals(2, shownBy.size())
        assertEquals("First, changed", shownBy.getNotification("one", 0).extras.getString(Notification.EXTRA_TITLE))

        notifications.cancel("one")
        notifications.cancel("never shown")

        assertEquals(1, shownBy.size())
        assertNull(shownBy.getNotification("one", 0))
    }

    @Test
    fun aReminderThatRepeatsKeepsFiringDayAfterDay() {
        app.reminders += TestReminder.Daily(a, LocalTime.of(9, 0))
        context.notify.start()

        advanceBy(9 * HOUR)
        advanceBy(DAY)
        advanceBy(DAY)

        assertEquals(List(3) { day -> Alarm(a, start + day * DAY + 9 * HOUR) }, app.handled)
        assertEquals(mapOf<String?, Long>("a" to start + 3 * DAY + 9 * HOUR), waiting())
    }

    @Test
    fun syncRegistersWhatChangedInTheApp() {
        context.notify.start()
        assertTrue(waiting().isEmpty())

        app.reminders += TestReminder.Once(a, start + HOUR)
        context.notify.sync()
        assertEquals(mapOf<String?, Long>("a" to start + HOUR), waiting())

        app.reminders.clear()
        context.notify.sync()
        assertTrue(waiting().isEmpty())
    }

    // Reboot, update, time and time zone.

    @Test
    fun afterARebootAnUpdateAndAChangeOfTimeOrTimeZoneTheAlarmsAreRegisteredAgain() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        context.notify.start()

        listOf(
            "android.intent.action.BOOT_COMPLETED",
            "android.intent.action.MY_PACKAGE_REPLACED",
            "android.intent.action.TIME_SET",
            "android.intent.action.TIMEZONE_CHANGED",
        ).forEach { event ->
            // Android forgot the alarms.
            context.getSystemService(AlarmManager::class.java).forgetEverything()
            assertTrue(waiting().isEmpty())
            val askedBefore = app.asked

            androidSends(event)

            assertEquals(event, mapOf<String?, Long>("a" to start + HOUR), waiting())
            assertEquals(event, askedBefore + 1, app.asked)
        }
    }

    @Test
    fun afterARebootANewStartOfTheAppFindsItsStateAgain() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        app.reminders += TestReminder.Once(AlarmId("b"), start + 2 * HOUR)
        context.notify.start()
        advanceBy(HOUR)
        assertEquals(1, app.handled.size)

        // The device is off for a day. Then it starts and is unlocked.
        context.getSystemService(AlarmManager::class.java).forgetEverything()
        clock.advanceBy(DAY)
        context.notify = newNotify()
        context.notify.start()
        androidSends("android.intent.action.BOOT_COMPLETED")
        advanceBy(0)

        // The one that was missed fires late. The one that fired before the reboot does not fire again.
        assertEquals(listOf(Alarm(a, start + HOUR), Alarm(AlarmId("b"), start + 2 * HOUR)), app.handled)
        assertTrue(waiting().isEmpty())
    }

    @Test
    fun afterANewTimeZoneADailyReminderIsRegisteredForTheNewLocalTime() {
        app.reminders += TestReminder.Daily(a, LocalTime.of(9, 0))
        context.notify.start()
        assertEquals(mapOf<String?, Long>("a" to start + 9 * HOUR), waiting())

        app.zone = java.time.ZoneId.of("Asia/Tbilisi")
        androidSends("android.intent.action.TIMEZONE_CHANGED")

        assertEquals(mapOf<String?, Long>("a" to start + 5 * HOUR), waiting())
    }

    @Test
    fun afterTheClockIsSetForwardWhatIsDueFires() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        context.notify.start()

        clock.advanceBy(2 * HOUR)
        androidSends("android.intent.action.TIME_SET")
        advanceBy(0)

        assertEquals(listOf(Alarm(a, start + HOUR)), app.handled)
        assertEquals(1, shownBy.size())
    }

    @Test
    fun aBroadcastThatIsNotOneOfTheFourIsIgnored() {
        context.notify.start()
        val askedBefore = app.asked

        SystemEventReceiver().onReceive(context, Intent("android.intent.action.LOCKED_BOOT_COMPLETED"))
        SystemEventReceiver().onReceive(context, Intent("org.example.SOMETHING"))
        AlarmReceiver().onReceive(context, Intent("org.example.SOMETHING").setIdentifier("a"))
        AlarmReceiver().onReceive(context, Intent(AlarmReceiver.ACTION_ALARM))

        assertEquals(askedBefore, app.asked)
    }

    // The state a screen shows.

    @Test
    fun beforeTheUserWasAskedTheStateIsNotAsked() {
        shownBy.setNotificationsEnabled(false)
        context.notify.start()

        assertEquals(NotifyState.NotAsked, context.notify.state(reminders))
    }

    @Test
    fun afterTheUserSaidYesTheStateIsReady() {
        shownBy.setNotificationsEnabled(false)
        context.notify.start()

        shownBy.setNotificationsEnabled(true)
        context.notify.permissionAnswered()

        assertEquals(NotifyState.Ready, context.notify.state(reminders))
    }

    @Test
    fun afterTheUserSaidNoTheStateIsDeniedAndStaysSoInANewStart() {
        shownBy.setNotificationsEnabled(false)
        context.notify.start()

        context.notify.permissionAnswered()

        assertEquals(NotifyState.Denied, context.notify.state(reminders))
        assertEquals(NotifyState.Denied, newNotify().state(reminders))
        val settings = context.notify.settingsIntent(reminders)
        assertEquals(Settings.ACTION_APP_NOTIFICATION_SETTINGS, settings.action)
        assertEquals(context.packageName, settings.getStringExtra(Settings.EXTRA_APP_PACKAGE))
    }

    @Test
    fun whenTheUserAllowsNotificationsInTheSettingsLaterTheStateIsReady() {
        shownBy.setNotificationsEnabled(false)
        context.notify.start()
        context.notify.permissionAnswered()

        shownBy.setNotificationsEnabled(true)

        assertEquals(NotifyState.Ready, context.notify.state(reminders))
    }

    @Test
    fun whenTheUserTurnsNotificationsOffInTheSettingsLaterTheStateIsDenied() {
        context.notify.start()
        context.notify.permissionAnswered()
        assertEquals(NotifyState.Ready, context.notify.state(reminders))

        shownBy.setNotificationsEnabled(false)

        assertEquals(NotifyState.Denied, context.notify.state(reminders))
    }

    @Test
    fun aChannelTheUserTurnedOffIsChannelOffAndTheOtherChannelIsReady() {
        context.notify.start()

        // What Android's settings do when the user turns the channel off.
        notificationManager.getNotificationChannel("reminders").importance = NotificationManager.IMPORTANCE_NONE

        assertEquals(NotifyState.ChannelOff, context.notify.state(reminders))
        assertEquals(NotifyState.Ready, context.notify.state(summaries))
        val settings = context.notify.settingsIntent(reminders)
        assertEquals(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS, settings.action)
        assertEquals("reminders", settings.getStringExtra(Settings.EXTRA_CHANNEL_ID))
        assertEquals(context.packageName, settings.getStringExtra(Settings.EXTRA_APP_PACKAGE))
    }

    @Test
    fun aNewStartKeepsTheUsersChoiceForAChannel() {
        context.notify.start()
        notificationManager.getNotificationChannel("reminders").importance = NotificationManager.IMPORTANCE_NONE

        newNotify().start()

        assertEquals(NotifyState.ChannelOff, context.notify.state(reminders))
    }

    @Test
    fun anAlarmFiresAlsoWhenTheUserSaidNo() {
        shownBy.setNotificationsEnabled(false)
        app.reminders += TestReminder.Once(a, start + HOUR)
        context.notify.start()
        context.notify.permissionAnswered()

        advanceBy(HOUR)

        // The app handled it, so a reminder that repeats moves on. Android itself drops the notification.
        assertEquals(listOf(Alarm(a, start + HOUR)), app.handled)
    }
}
