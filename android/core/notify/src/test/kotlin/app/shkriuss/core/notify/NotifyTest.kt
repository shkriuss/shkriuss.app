package app.shkriuss.core.notify

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.IntentFilter
import android.os.Looper
import android.provider.Settings
import app.shkriuss.core.testing.TestClock
import java.time.LocalTime
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
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
 * to the receivers of this module's manifest. So do the presses of the
 * buttons on a notification (ADR 0034). The clock is the test's. It
 * starts at 2026-01-01T00:00:00Z.
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

    /** What the app lock answers about the text of notifications: hide it, show it, or fail. */
    private var hidesText: () -> Boolean = { false }

    /** How long each step of hiding the text waited for, in milliseconds, in order. */
    private val pauses = mutableListOf<Long>()

    /** What happens while a step waits, besides being counted. Nothing waits for real. */
    private var duringPause: (Long) -> Unit = {}

    /** True to keep the steps in [heldSteps] instead of running them, as the timer of core/notify does. */
    private var holdSteps = false

    /** The steps that wait, in order, while [holdSteps] is true. */
    private val heldSteps = mutableListOf<() -> Unit>()

    /** What the tests' Notify does for a step that comes later: it counts the wait, and runs the step at once or holds it. */
    private val testLater: (Long, () -> Unit) -> Unit = { millis, step ->
        pauses += millis
        duringPause(millis)
        if (holdSteps) heldSteps += step else step()
    }

    /** What the app reviews on screen, and whether the time changed, for each call of its review. */
    private val reviews = mutableListOf<Pair<List<OnScreen>, Boolean>>()

    /** What the app does with its notifications on screen when asked. */
    private var onReview: (List<OnScreen>, Notifications) -> Unit = { _, _ -> }

    /** What the app class builds when the app starts. The worker runs each piece at once, so a test needs no waiting. */
    private fun newNotify() = Notify(
        context,
        listOf(reminders, summaries),
        app,
        handler,
        clock,
        hidesText = { hidesText() },
        worker = Executor { it.run() },
        review = { onScreen, notifications, timeChanged ->
            reviews += onScreen to timeChanged
            onReview(onScreen, notifications)
        },
        later = testLater,
    )

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
        val notify = Notify(otherApp, listOf(reminders), app, handler, clock, { false }, FakeAlarmScheduler(), Executor { it.run() })

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

    // While the app lock hides the text.

    /** Every text a notification carries, so a test can look for user content anywhere in it. */
    private fun textsOf(shown: Notification): List<String> =
        shown.extras.keySet().mapNotNull { shown.extras.getCharSequence(it)?.toString() } + listOfNotNull(shown.tickerText?.toString())

    private fun assertHidden(shown: Notification, channelName: String) {
        assertEquals(channelName, shown.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals(context.getString(R.string.notify_text_hidden), shown.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        textsOf(shown).forEach { text ->
            assertFalse("user content in $text", "plants" in text || "kitchen" in text)
        }
    }

    @Test
    fun whileTheAppLockHidesTheTextANotificationShowsOnlyItsChannel() {
        hidesText = { true }
        app.reminders += TestReminder.Once(a, start + HOUR)
        context.notify.start()

        advanceBy(HOUR)

        val shown = shownBy.getNotification("a", 0)
        assertHidden(shown, context.getString(android.R.string.ok))
        assertEquals("the tap still opens the app's screen", open.component, shadowOf(shown.contentIntent).savedIntent.component)
        assertEquals(Notification.VISIBILITY_PRIVATE, shown.visibility)
        assertEquals(start + HOUR, shown.`when`)
    }

    @Test
    fun whenTheStateOfTheAppLockCannotBeReadTheTextIsHidden() {
        hidesText = { throw IllegalStateException("The keyset file cannot be read now") }
        app.reminders += TestReminder.Once(a, start + HOUR)
        context.notify.start()

        advanceBy(HOUR)

        assertHidden(shownBy.getNotification("a", 0), context.getString(android.R.string.ok))
    }

    @Test
    fun hideShownTextPostsTheShownNotificationsAgainInTheHiddenForm() {
        context.notify.start()
        val notifications = context.notify.notifications
        notifications.show(ShkNotification("one", reminders, "Water the plants", "In the kitchen", android.R.drawable.ic_dialog_info, open, start))
        notifications.show(ShkNotification("two", summaries, "Two plants", null, android.R.drawable.ic_dialog_info, open, start + 1))
        val tapBefore = shownBy.getNotification("one", 0).contentIntent

        hidesText = { true }
        context.notify.hideShownText()

        assertEquals(2, shownBy.size())
        val one = shownBy.getNotification("one", 0)
        assertHidden(one, context.getString(android.R.string.ok))
        assertHidden(shownBy.getNotification("two", 0), context.getString(android.R.string.copy))
        assertEquals("reminders", one.channelId)
        assertEquals(start, one.`when`)
        assertEquals(tapBefore, one.contentIntent)
        assertEquals("one", shadowOf(one.contentIntent).savedIntent.identifier)
        assertTrue("no new sound or vibration", one.flags and Notification.FLAG_ONLY_ALERT_ONCE != 0)
        assertTrue(one.flags and Notification.FLAG_AUTO_CANCEL != 0)
    }

    @Test
    fun hideShownTextPostsFourASecondAndThenLooksAgain() {
        context.notify.start()
        val notifications = context.notify.notifications
        listOf("one", "two", "three").forEach { key ->
            notifications.show(ShkNotification(key, reminders, "Water the plants", null, android.R.drawable.ic_dialog_info, open, start))
        }

        hidesText = { true }
        context.notify.hideShownText()

        // Android drops updates that come faster than about five a second.
        assertEquals(listOf(250L, 250L, 1_000L), pauses)
        listOf("one", "two", "three").forEach { assertHidden(shownBy.getNotification(it, 0), context.getString(android.R.string.ok)) }
    }

    @Test
    fun aNotificationWhoseHiddenFormDidNotLandIsRemoved() {
        context.notify.start()
        val notifications = context.notify.notifications
        notifications.show(ShkNotification("one", reminders, "Water the plants", "In the kitchen", android.R.drawable.ic_dialog_info, open, start))
        notifications.show(ShkNotification("two", summaries, "Two plants", null, android.R.drawable.ic_dialog_info, open, start + 1))
        val oldOne = shownBy.getNotification("one", 0)
        // Android dropped the update of "one": the old one, with its text, is what it shows.
        duringPause = { millis -> if (millis == 1_000L) notificationManager.notify("one", 0, oldOne) }

        hidesText = { true }
        context.notify.hideShownText()

        assertNull("the old text left the shade, with its notification", shownBy.getNotification("one", 0))
        assertHidden(shownBy.getNotification("two", 0), context.getString(android.R.string.copy))
    }

    @Test
    fun hidingTheTextDoesNotHoldTheWorkerBetweenItsPosts() {
        context.notify.start()
        val notifications = context.notify.notifications
        notifications.show(ShkNotification("one", reminders, "Water the plants", null, android.R.drawable.ic_dialog_info, open, start))
        notifications.show(ShkNotification("two", reminders, "Two plants", null, android.R.drawable.ic_dialog_info, open, start))
        holdSteps = true

        hidesText = { true }
        context.notify.hideShownText()

        // One is posted again, and the next waits for the timer: the worker is free for alarms and presses meanwhile.
        val hidden = listOf("one", "two").filter { shownBy.getNotification(it, 0).extras.getBoolean(Notifications.EXTRA_HIDDEN, false) }
        assertEquals(1, hidden.size)
        assertEquals(listOf(250L), pauses)
        assertEquals(1, heldSteps.size)

        while (heldSteps.isNotEmpty()) heldSteps.removeAt(0)()
        assertEquals(listOf(250L, 1_000L), pauses)
        listOf("one", "two").forEach { assertHidden(shownBy.getNotification(it, 0), context.getString(android.R.string.ok)) }
    }

    @Test
    fun aBroadcastHandledWhileTheTextIsBeingHiddenEndsOnlyAfterTheLastStep() {
        context.notify.start()
        val notifications = context.notify.notifications
        notifications.show(ShkNotification("one", reminders, "Water the plants", null, android.R.drawable.ic_dialog_info, open, start))
        notifications.show(ShkNotification("two", reminders, "Two plants", null, android.R.drawable.ic_dialog_info, open, start))
        holdSteps = true
        hidesText = { true }
        context.notify.hideShownText()
        var ended = 0

        // Android started the app for these. Each ends its broadcast with its answer.
        context.notify.alarmFired(AlarmId("plants")) { ended++ }
        context.notify.systemEvent { ended++ }
        context.notify.buttonPressed(ButtonPress("one", "drank", start, 250)) { ended++ }

        assertEquals("the app keeps running while text is left in the shade", 0, ended)
        heldSteps.removeAt(0)()
        assertEquals("the check a second later is still to come", 0, ended)
        heldSteps.removeAt(0)()
        assertEquals(3, ended)

        context.notify.alarmFired(AlarmId("plants")) { ended++ }
        assertEquals("with nothing to hide, a broadcast ends at once", 4, ended)
    }

    @Test
    fun theTimerOfNotifyHandsEachStepOfHidingBackToTheWorker() {
        val worker = Executors.newSingleThreadExecutor()
        try {
            // As the apps build it: the real timer of core/notify, and a worker thread of its own.
            val notify = Notify(context, listOf(reminders, summaries), app, handler, clock, hidesText = { hidesText() }, worker = worker)
            notify.start()
            worker.submit {}.get()
            notify.notifications.show(ShkNotification("one", reminders, "Water the plants", null, android.R.drawable.ic_dialog_info, open, start))
            notify.notifications.show(ShkNotification("two", reminders, "Two plants", null, android.R.drawable.ic_dialog_info, open, start))
            hidesText = { true }
            val busy = CountDownLatch(1)

            notify.hideShownText()
            // An alarm or a press that takes long holds the worker, past the time of the next step.
            worker.execute { busy.await() }
            Thread.sleep(PAST_THE_NEXT_STEP_MILLIS)

            assertEquals("the next post waits for the worker", 1, hidden("one", "two"))
            busy.countDown()
            assertTrue("then it comes, on the worker", hiddenOnTheWorker(worker, expected = 2))
        } finally {
            worker.shutdownNow()
        }
    }

    /** How many of [keys] show the hidden form now. */
    private fun hidden(vararg keys: String): Int =
        keys.count { shownBy.getNotification(it, 0).extras.getBoolean(Notifications.EXTRA_HIDDEN, false) }

    /** True once [expected] notifications show the hidden form, as read on [worker], within two seconds. */
    private fun hiddenOnTheWorker(worker: ExecutorService, expected: Int): Boolean {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
        while (System.nanoTime() < deadline) {
            if (worker.submit<Int> { hidden("one", "two") }.get() == expected) return true
            Thread.sleep(20)
        }
        return false
    }

    @Test
    fun theAppReviewsWhatIsOnScreenAtStartAndAfterTheTimeChanged() {
        context.notify.start()
        context.notify.notifications.show(
            ShkNotification("one", reminders, "Water the plants", null, android.R.drawable.ic_dialog_info, open, start, endsAtMillis = start + HOUR),
        )
        reviews.clear()

        context.notify = newNotify()
        context.notify.start()
        androidSends("android.intent.action.TIMEZONE_CHANGED")

        val seen = listOf(OnScreen("one", start, start + HOUR))
        assertEquals(listOf(seen to false, seen to true), reviews)
    }

    @Test
    fun theReviewCanRemoveANotificationAndOneThatFailsLeavesTheAlarms() {
        context.notify.start()
        context.notify.notifications.show(ShkNotification("gone", reminders, "Old", null, android.R.drawable.ic_dialog_info, open, start))
        onReview = { onScreen, notifications -> onScreen.forEach { notifications.cancel(it.key) } }

        androidSends("android.intent.action.TIME_SET")
        assertNull(shownBy.getNotification("gone", 0))

        // A new reminder, and at the next start a review that fails: the alarms are registered all the same.
        app.reminders += TestReminder.Once(a, start + HOUR)
        onReview = { _, _ -> error("the records cannot be read") }
        context.notify = newNotify()
        context.notify.start()
        assertEquals(listOf(start + HOUR), waiting().values.toList())
    }

    @Test
    fun aQuietNotificationMakesNoNewSound() {
        val notifications = context.notify.notifications
        notifications.show(ShkNotification("one", reminders, "Water the plants", null, android.R.drawable.ic_dialog_info, open, start))
        assertTrue("an ordinary one alerts", shownBy.getNotification("one", 0).flags and Notification.FLAG_ONLY_ALERT_ONCE == 0)

        notifications.show(ShkNotification("one", reminders, "Water the plants", null, android.R.drawable.ic_dialog_info, open, start, quiet = true))

        assertTrue(shownBy.getNotification("one", 0).flags and Notification.FLAG_ONLY_ALERT_ONCE != 0)
    }

    @Test
    fun aNotificationTheAppRemovesDuringAPauseDoesNotComeBack() {
        context.notify.start()
        val notifications = context.notify.notifications
        notifications.show(ShkNotification("one", reminders, "Water the plants", null, android.R.drawable.ic_dialog_info, open, start))
        notifications.show(ShkNotification("two", reminders, "Two plants", null, android.R.drawable.ic_dialog_info, open, start))
        // While the first is posted again, the reminder of the other one is deleted: the app removes its notification,
        // from its own thread. Which one is first is Android's order.
        var removed: String? = null
        duringPause = { millis ->
            if (millis == 250L) {
                removed = notificationManager.activeNotifications
                    .single { !it.notification.extras.getBoolean(Notifications.EXTRA_HIDDEN, false) }.tag
                notifications.cancel(removed!!)
            }
        }

        hidesText = { true }
        context.notify.hideShownText()

        val kept = listOf("one", "two").single { it != removed }
        assertHidden(shownBy.getNotification(kept, 0), context.getString(android.R.string.ok))
        assertNull("the removed notification stays removed", shownBy.getNotification(removed, 0))
    }

    @Test
    fun aNotificationShownInTheHiddenFormMeanwhileStaysWhenTheShadeIsCheckedAgain() {
        context.notify.start()
        val notifications = context.notify.notifications
        notifications.show(ShkNotification("one", reminders, "Water the plants", null, android.R.drawable.ic_dialog_info, open, start))
        duringPause = { millis ->
            if (millis == 1_000L) {
                notifications.show(ShkNotification("two", reminders, "Two plants", null, android.R.drawable.ic_dialog_info, open, start))
            }
        }

        hidesText = { true }
        context.notify.hideShownText()

        assertHidden(shownBy.getNotification("one", 0), context.getString(android.R.string.ok))
        assertHidden(shownBy.getNotification("two", 0), context.getString(android.R.string.ok))
    }

    @Test
    fun aStartWithEveryNotificationHiddenAlreadyPostsNothingAndWaitsForNothing() {
        hidesText = { true }
        context.notify.start()
        val notifications = context.notify.notifications
        notifications.show(ShkNotification("one", reminders, "Water the plants", null, android.R.drawable.ic_dialog_info, open, start))
        notifications.show(ShkNotification("two", reminders, "Two plants", null, android.R.drawable.ic_dialog_info, open, start))
        val before = shownBy.getNotification("one", 0)

        context.notify = newNotify()
        context.notify.start()

        assertEquals("the alarms that wait behind it are not held up", emptyList<Long>(), pauses)
        assertTrue("not posted again", before === shownBy.getNotification("one", 0))
        assertHidden(shownBy.getNotification("two", 0), context.getString(android.R.string.ok))
    }

    @Test
    fun startHidesTheTextOfNotificationsLeftFromBeforeAStop() {
        context.notify.start()
        context.notify.notifications.show(
            ShkNotification("one", reminders, "Water the plants", "In the kitchen", android.R.drawable.ic_dialog_info, open, start),
        )
        // The app lock was turned on, and the app stopped before it hid the shown notifications.
        hidesText = { true }

        context.notify = newNotify()
        context.notify.start()

        assertHidden(shownBy.getNotification("one", 0), context.getString(android.R.string.ok))
    }

    @Test
    fun startLeavesTheTextWhenItIsNotToBeHidden() {
        context.notify.start()
        context.notify.notifications.show(
            ShkNotification("one", reminders, "Water the plants", "In the kitchen", android.R.drawable.ic_dialog_info, open, start),
        )

        context.notify = newNotify()
        context.notify.start()

        assertEquals("Water the plants", shownBy.getNotification("one", 0).extras.getString(Notification.EXTRA_TITLE))
    }

    @Test
    fun hideShownTextLeavesTheTextWhenItIsNotToBeHidden() {
        context.notify.start()
        context.notify.notifications.show(
            ShkNotification("one", reminders, "Water the plants", "In the kitchen", android.R.drawable.ic_dialog_info, open, start),
        )

        context.notify.hideShownText()

        assertEquals("Water the plants", shownBy.getNotification("one", 0).extras.getString(Notification.EXTRA_TITLE))
    }

    // Buttons on a notification (ADR 0034).

    /** Every press the app's button handler got, in order. */
    private val presses = mutableListOf<ButtonPress>()

    /** What the app's button handler does, as an app would: it takes the press and removes the notification. */
    private var onPress: (ButtonPress, Notifications) -> Unit = { press, notifications ->
        presses += press
        notifications.cancel(press.key)
    }

    /** The app class of an app with buttons: it passes a button handler. */
    private fun newNotifyWithButtons() = Notify(
        context,
        listOf(reminders, summaries),
        app,
        handler,
        clock,
        hidesText = { hidesText() },
        worker = Executor { it.run() },
        buttons = { press, notifications -> onPress(press, notifications) },
        later = testLater,
    )

    private val drank = ShkNotificationButton("Drank 250 ml", "drank", 250)
    private val later = ShkNotificationButton("Later", "later")

    private fun withButtons(buttons: List<ShkNotificationButton> = listOf(drank, later), endsAt: Long? = null) =
        ShkNotification("next", reminders, "Water the plants", "In the kitchen", android.R.drawable.ic_dialog_info, open, start + HOUR, buttons, endsAt)

    private fun actionsOf(shown: Notification): List<Notification.Action> = shown.actions?.toList().orEmpty()

    /** The user presses the button [index] of the notification [key]: Android sends its pending intent. */
    private fun press(key: String, index: Int) {
        actionsOf(shownBy.getNotification(key, 0))[index].actionIntent.send()
        shadowOf(Looper.getMainLooper()).idle()
    }

    @Test
    fun aNotificationShowsItsButtonsInOrderAndEachAsksForTheUnlockFirst() {
        context.notify = newNotifyWithButtons()
        context.notify.start()

        context.notify.notifications.show(withButtons())

        val actions = actionsOf(shownBy.getNotification("next", 0))
        assertEquals(listOf("Drank 250 ml", "Later"), actions.map { it.title.toString() })
        actions.forEach { assertTrue(it.title.toString(), it.isAuthenticationRequired) }
    }

    @Test
    fun aButtonIsABroadcastOnlyToThisAppThatCarriesTheKeyTheActionTheTimeAndTheValueAndNoText() {
        context.notify = newNotifyWithButtons()
        context.notify.start()
        context.notify.notifications.show(withButtons())
        val actions = actionsOf(shownBy.getNotification("next", 0))

        val first = shadowOf(actions[0].actionIntent)
        assertTrue(first.isBroadcast)
        assertTrue(first.isImmutable)
        val sent = first.savedIntent
        assertEquals(ComponentName(context, ButtonReceiver::class.java), sent.component)
        assertEquals(ButtonReceiver.ACTION_BUTTON, sent.action)
        assertEquals("next/drank/${start + HOUR}/250", sent.identifier)
        val extras = checkNotNull(sent.extras)
        assertEquals(
            setOf(ButtonReceiver.EXTRA_KEY, ButtonReceiver.EXTRA_ACTION, ButtonReceiver.EXTRA_AT, ButtonReceiver.EXTRA_VALUE),
            extras.keySet(),
        )
        assertEquals("next", extras.getString(ButtonReceiver.EXTRA_KEY))
        assertEquals("drank", extras.getString(ButtonReceiver.EXTRA_ACTION))
        assertEquals(start + HOUR, extras.getLong(ButtonReceiver.EXTRA_AT))
        assertEquals(250L, extras.getLong(ButtonReceiver.EXTRA_VALUE))
        // The two buttons are two presses.
        assertNotEquals(actions[0].actionIntent, actions[1].actionIntent)
        assertEquals("next/later/${start + HOUR}/0", shadowOf(actions[1].actionIntent).savedIntent.identifier)
    }

    @Test
    fun aPressReachesTheAppsButtonHandlerOnce() {
        context.notify = newNotifyWithButtons()
        context.notify.start()
        context.notify.notifications.show(withButtons())

        press("next", 0)

        assertEquals(listOf(ButtonPress("next", "drank", start + HOUR, 250)), presses)
        assertNull("the app removed it", shownBy.getNotification("next", 0))
    }

    @Test
    fun thePressOfTheSecondButtonCarriesItsOwnAction() {
        context.notify = newNotifyWithButtons()
        context.notify.start()
        context.notify.notifications.show(withButtons())

        press("next", 1)

        assertEquals(listOf(ButtonPress("next", "later", start + HOUR, 0)), presses)
    }

    @Test
    fun anOldButtonKeepsItsOwnTimeAndValueAfterTheNextNotificationWithTheSameKey() {
        context.notify = newNotifyWithButtons()
        context.notify.start()
        val notifications = context.notify.notifications
        notifications.show(withButtons())
        // What a late press sends, or what an app with notification access kept: the pending intent of the old button.
        val old = actionsOf(shownBy.getNotification("next", 0))[0].actionIntent

        // The next reminder has the same key, a later time and another amount.
        val next = ShkNotificationButton("Drank 300 ml", "drank", 300)
        notifications.show(
            ShkNotification("next", reminders, "Water the plants", null, android.R.drawable.ic_dialog_info, open, start + 2 * HOUR, listOf(next, later)),
        )
        val shown = actionsOf(shownBy.getNotification("next", 0))[0].actionIntent
        old.send()
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals("the old time and the old value, so the app can tell it is old", listOf(ButtonPress("next", "drank", start + HOUR, 250)), presses)
        presses.clear()
        shown.send()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("the button that shows has its own", listOf(ButtonPress("next", "drank", start + 2 * HOUR, 300)), presses)
    }

    @Test
    fun aButtonKeptFromBeforeKeepsItsValueWhenTheSameNotificationIsShownAgainWithAnother() {
        context.notify = newNotifyWithButtons()
        context.notify.start()
        val notifications = context.notify.notifications
        notifications.show(withButtons())
        val kept = actionsOf(shownBy.getNotification("next", 0))[0].actionIntent

        // The same notification, with the same key and time, shown again with another amount.
        notifications.show(withButtons(listOf(ShkNotificationButton("Drank 300 ml", "drank", 300), later)))
        kept.send()
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals("it does what its label said", listOf(ButtonPress("next", "drank", start + HOUR, 250)), presses)
    }

    @Test
    fun onScreenGivesTheValueOfEachButtonAndNoneInTheHiddenForm() {
        context.notify = newNotifyWithButtons()
        context.notify.start()
        val notifications = context.notify.notifications
        notifications.show(withButtons(endsAt = start + 2 * HOUR))

        assertEquals(
            listOf(OnScreen("next", start + HOUR, start + 2 * HOUR, mapOf("drank" to 250L, "later" to 0L))),
            notifications.onScreen(listOf(reminders, summaries)),
        )

        hidesText = { true }
        context.notify.hideShownText()

        assertEquals(listOf(OnScreen("next", start + HOUR, start + 2 * HOUR)), notifications.onScreen(listOf(reminders, summaries)))
    }

    @Test
    fun aButtonThatWasKeptDoesNothingWhileTheAppLockHidesTheText() {
        context.notify = newNotifyWithButtons()
        context.notify.start()
        context.notify.notifications.show(withButtons())
        // An app with notification access keeps the pending intent of the button.
        val kept = actionsOf(shownBy.getNotification("next", 0))[0].actionIntent

        hidesText = { true }
        context.notify.hideShownText()
        kept.send()
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals("the handler is not called", emptyList<ButtonPress>(), presses)
        assertHidden(shownBy.getNotification("next", 0), context.getString(android.R.string.ok))

        hidesText = { throw IllegalStateException("The keyset file cannot be read now") }
        kept.send()
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals("nor when the state of the app lock cannot be read", emptyList<ButtonPress>(), presses)
        assertEquals("the notification stays", 1, shownBy.size())
    }

    @Test
    fun whileTheAppLockHidesTheTextAPressInAnAppWithoutAButtonHandlerLeavesTheNotification() {
        context.notify.start()
        context.notify.notifications.show(withButtons(buttons = emptyList()))
        hidesText = { true }

        context.sendBroadcast(ButtonReceiver.intentFor(context, ButtonPress("next", "drank", start + HOUR, 250)))
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals(1, shownBy.size())
    }

    @Test
    fun aPressThatFailsChangesNothingMoreAndDoesNotStopTheApp() {
        context.notify = newNotifyWithButtons()
        context.notify.start()
        onPress = { _, _ -> throw IllegalStateException("the record cannot be written") }
        context.notify.notifications.show(withButtons())

        press("next", 0)

        assertEquals("the notification stays, so the user can open the app", 1, shownBy.size())
    }

    @Test
    fun aPressInAnAppWithoutAButtonHandlerOnlyRemovesTheNotification() {
        context.notify.start()
        context.notify.notifications.show(withButtons(buttons = emptyList()))

        context.sendBroadcast(ButtonReceiver.intentFor(context, ButtonPress("next", "drank", start + HOUR, 250)))
        shadowOf(Looper.getMainLooper()).idle()

        assertNull(shownBy.getNotification("next", 0))
    }

    @Test
    fun aBroadcastThatIsNoPressIsIgnored() {
        context.notify = newNotifyWithButtons()
        context.notify.start()

        ButtonReceiver().onReceive(context, Intent("org.example.SOMETHING"))
        ButtonReceiver().onReceive(context, Intent(ButtonReceiver.ACTION_BUTTON))
        ButtonReceiver().onReceive(context, Intent(ButtonReceiver.ACTION_BUTTON).putExtra(ButtonReceiver.EXTRA_KEY, "next"))

        assertEquals(emptyList<ButtonPress>(), presses)
    }

    @Test
    fun buttonsNeedAButtonHandler() {
        context.notify.start()

        assertThrows(IllegalArgumentException::class.java) { context.notify.notifications.show(withButtons()) }
        assertEquals(0, shownBy.size())
    }

    @Test
    fun aNotificationHasAtMostThreeButtonsEachWithItsOwnAction() {
        context.notify = newNotifyWithButtons()
        context.notify.start()
        val notifications = context.notify.notifications
        val four = List(4) { ShkNotificationButton("Button $it", "b$it") }

        assertThrows(IllegalArgumentException::class.java) { notifications.show(withButtons(buttons = four)) }
        assertThrows(IllegalArgumentException::class.java) { notifications.show(withButtons(buttons = listOf(drank, drank))) }
        notifications.show(withButtons(buttons = four.take(3)))
        assertEquals(3, actionsOf(shownBy.getNotification("next", 0)).size)
    }

    @Test
    fun aButtonsActionIsAFixedNameAndNeverText() {
        listOf("", "Drank 250 ml", "a".repeat(33), "drank/later").forEach { action ->
            assertThrows(action, IllegalArgumentException::class.java) { ShkNotificationButton("Label", action) }
        }
        ShkNotificationButton("Label", "drank.later_2-b")
    }

    @Test
    fun whileTheAppLockHidesTheTextANotificationHasNoButtons() {
        context.notify = newNotifyWithButtons()
        context.notify.start()
        hidesText = { true }

        context.notify.notifications.show(withButtons())

        val shown = shownBy.getNotification("next", 0)
        assertHidden(shown, context.getString(android.R.string.ok))
        assertEquals(emptyList<Notification.Action>(), actionsOf(shown))
    }

    @Test
    fun whenTheStateOfTheAppLockCannotBeReadANotificationHasNoButtons() {
        context.notify = newNotifyWithButtons()
        context.notify.start()
        hidesText = { throw IllegalStateException("The keyset file cannot be read now") }

        context.notify.notifications.show(withButtons())

        assertEquals(emptyList<Notification.Action>(), actionsOf(shownBy.getNotification("next", 0)))
    }

    @Test
    fun hideShownTextTakesTheButtonsAwayWithTheText() {
        context.notify = newNotifyWithButtons()
        context.notify.start()
        context.notify.notifications.show(withButtons())
        assertEquals(2, actionsOf(shownBy.getNotification("next", 0)).size)

        hidesText = { true }
        context.notify.hideShownText()

        val shown = shownBy.getNotification("next", 0)
        assertHidden(shown, context.getString(android.R.string.ok))
        assertEquals(emptyList<Notification.Action>(), actionsOf(shown))
    }

    // The end of a notification.

    @Test
    fun aNotificationWithAnEndIsRemovedByAndroidAtThatMoment() {
        context.notify.start()

        context.notify.notifications.show(withButtons(buttons = emptyList(), endsAt = start + 10 * HOUR))

        assertEquals(10 * HOUR, shownBy.getNotification("next", 0).timeoutAfter)
    }

    @Test
    fun aNotificationWithoutAnEndStaysUntilItIsRemoved() {
        context.notify.start()

        context.notify.notifications.show(withButtons(buttons = emptyList()))

        assertEquals(0L, shownBy.getNotification("next", 0).timeoutAfter)
    }

    @Test
    fun hideShownTextKeepsTheSameEnd() {
        context.notify.start()
        context.notify.notifications.show(withButtons(buttons = emptyList(), endsAt = start + 10 * HOUR))

        clock.advanceBy(HOUR)
        hidesText = { true }
        context.notify.hideShownText()

        assertEquals("the end is counted from the moment it is posted again", 9 * HOUR, shownBy.getNotification("next", 0).timeoutAfter)
    }

    @Test
    fun aNotificationWhoseEndHasPassedIsNotShownAndRemovesTheOldOne() {
        context.notify.start()
        val notifications = context.notify.notifications
        notifications.show(withButtons(buttons = emptyList()))

        notifications.show(withButtons(buttons = emptyList(), endsAt = start))

        assertEquals(0, shownBy.size())
    }

    // A handler that fails.

    /** Makes the screen [component] the app's start screen, as an app's launcher activity is. */
    private fun aStartScreen(component: ComponentName) {
        val packages = shadowOf(context.packageManager)
        packages.addActivityIfNotPresent(component)
        packages.addIntentFilterForActivity(
            component,
            IntentFilter(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER) },
        )
    }

    @Test
    fun whenTheHandlerFailsANoticeShowsInPlaceOfTheReminderAndTheNextOneStillComes() {
        val startScreen = ComponentName(context, "app.shkriuss.core.notify.StartScreen")
        aStartScreen(startScreen)
        app.reminders += TestReminder.Once(a, start + HOUR)
        app.reminders += TestReminder.Once(AlarmId("b"), start + 2 * HOUR)
        context.notify.start()
        app.failure = IllegalStateException("the record cannot be read")

        advanceBy(HOUR)

        val shown = shownBy.getNotification("a", 0)
        // The first channel's name, the fixed text, and nothing of the app's own.
        assertEquals(context.getString(android.R.string.ok), shown.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals(context.getString(R.string.notify_reminder_failed), shown.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        textsOf(shown).forEach { text -> assertFalse("user content in $text", "plants" in text || "kitchen" in text) }
        assertEquals("reminders", shown.channelId)
        assertEquals(start + HOUR, shown.`when`)
        assertEquals(emptyList<Notification.Action>(), actionsOf(shown))
        assertEquals(Notification.VISIBILITY_PRIVATE, shown.visibility)
        val tap = shadowOf(shown.contentIntent)
        assertTrue(tap.isActivity)
        assertTrue(tap.isImmutable)
        assertEquals(startScreen, tap.savedIntent.component)
        assertEquals("the alarm's id", "a", tap.savedIntent.identifier)
        val anew = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        assertEquals("the app starts anew, with no second screen on top", anew, tap.savedIntent.flags and anew)
        // The next one is registered, and comes.
        assertEquals(mapOf<String?, Long>("b" to start + 2 * HOUR), waiting())
        app.failure = null
        advanceBy(HOUR)
        assertEquals("Water the plants", shownBy.getNotification("b", 0).extras.getString(Notification.EXTRA_TITLE))
    }

    @Test
    fun theNextNotificationOfTheSameAlarmReplacesTheNotice() {
        app.reminders += TestReminder.Daily(a, LocalTime.of(9, 0))
        context.notify.start()
        app.failure = IllegalStateException("the record cannot be read")
        advanceBy(9 * HOUR)
        assertEquals(context.getString(R.string.notify_reminder_failed), shownBy.getNotification("a", 0).extras.getString(Notification.EXTRA_TEXT))

        // The app works again. Its next reminder for "a" has the same key.
        app.failure = null
        context.notify.notifications.show(
            ShkNotification("a", reminders, "Water the plants", "In the kitchen", android.R.drawable.ic_dialog_info, open, start + 9 * HOUR),
        )

        assertEquals(1, shownBy.size())
        assertEquals("Water the plants", shownBy.getNotification("a", 0).extras.getString(Notification.EXTRA_TITLE))
    }

    @Test
    fun aNoticeWithoutAStartScreenHasNoTapTarget() {
        app.reminders += TestReminder.Once(a, start + HOUR)
        context.notify.start()
        app.failure = IllegalStateException("the record cannot be read")

        advanceBy(HOUR)

        assertNull(shownBy.getNotification("a", 0).contentIntent)
    }

    @Test
    fun anAppNeedsAtLeastOneChannel() {
        assertThrows(IllegalArgumentException::class.java) {
            Notify(context, emptyList(), app, handler, clock, { false }, FakeAlarmScheduler(), Executor { it.run() })
        }
    }
}

/** Longer than the 250 ms between two posts of the hidden form, so the next step is due by then. */
private const val PAST_THE_NEXT_STEP_MILLIS = 600L
