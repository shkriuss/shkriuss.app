package app.shkriuss.water

import android.content.ComponentName
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import app.shkriuss.feature.water.Drink
import app.shkriuss.feature.water.WaterReminders
import app.shkriuss.feature.water.WaterSettings
import app.shkriuss.core.notify.R as NotifyR
import app.shkriuss.core.notify.fixtures.NotifyTestDevice
import app.shkriuss.core.notify.fixtures.ShownNotification
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.feature.water.BackupStep
import java.time.LocalDateTime
import java.time.ZoneOffset
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Water's reminders from end to end, as on a phone: Android's
 * `AlarmManager` fires the alarm as a broadcast to the receiver of
 * core/notify in Water's merged manifest, the reminder shows, and its
 * buttons send their pending intents to the button receiver. Every hour
 * from 08:00 until 22:00, on Friday 13 November 2026, in UTC.
 *
 * The cases of the grace of one minute (the owner's decision): Android
 * starts Water for the alarm, a change in the seconds before it comes, and
 * an alarm that comes more than a minute late.
 *
 * After a restore: the alarm moves to the time the restored
 * data gives, and a reminder that no longer fits is removed.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = RemindersWaterApp::class)
class WaterRemindersTest {
    private val app = ApplicationProvider.getApplicationContext<RemindersWaterApp>()
    private val device = NotifyTestDevice(app)

    @Before
    fun at0800WithNotificationsAllowed() {
        device.allowNotifications(true)
        setClock(THE_DAY.atTime(8, 0))
    }

    @After
    fun closeTheDatabase() = app.test.database.close()

    private fun millis(time: LocalDateTime): Long = time.toInstant(ZoneOffset.UTC).toEpochMilli()

    private fun setClock(time: LocalDateTime) {
        app.test.clock.nowMillis = millis(time)
    }

    private fun at(hour: Int, minute: Int, second: Int = 0): LocalDateTime = THE_DAY.atTime(hour, minute, second)

    private fun change(change: (WaterSettings) -> WaterSettings) =
        runBlocking { app.test.services.repository.changeSettings(change) }

    private fun remindersOn() = change { it.copy(remindersOn = true) }

    /** The times of the alarms that wait at Android. */
    private fun waiting(): List<Long> = device.waitingAlarms()

    /** Android fires Water's alarm now, as a broadcast to the receiver of core/notify. */
    private fun androidFiresTheAlarm() = device.fireTheAlarm()

    private fun reminder(): ShownNotification? = device.shown(WaterReminders.KEY)

    /** The user presses button [index] of the reminder, after the phone's unlock: Android sends its pending intent. */
    private fun press(index: Int) = device.press(WaterReminders.KEY, index)

    private fun drinksToday(): List<Drink> = runBlocking { app.test.services.repository.drinksOf(THE_DAY).first() }

    /** Restores the backup of [writeABackup] as the screen does: the file is checked, then taken, and the reminders follow. */
    private fun restoreTheBackup() = runBlocking {
        val backups = app.test.services.backups
        val document = TestDocuments.uri(BACKUP_NAME)
        check(backups.look(document) is BackupStep.Question) { "The backup of the test does not pass its check" }
        assertEquals(BackupStep.Restored, backups.restore(document))
    }

    @Test
    fun afterARestoreOnAPhoneWithNoDataTheAlarmIsSetForTheRestoredSettings() {
        pickerDocuments()
        remindersOn()
        runBlocking { app.test.services.repository.addDrink(THE_DAY, 8 * 60, 300) }
        writeABackup()

        // A second phone with the same recovery words and no data: no reminders, so no alarm.
        setClock(at(8, 20))
        app.startOnAPhoneWithNoData()
        assertEquals(emptyList<Long>(), waiting())

        restoreTheBackup()

        assertEquals("reminders are on again, every hour, counted from the drink at 08:00", listOf(millis(at(9, 0))), waiting())
        assertEquals(listOf(300), drinksToday().map { it.amountMl })
    }

    @Test
    fun afterARestoreAReminderThatNoLongerFitsIsRemovedAndTheAlarmMoves() {
        pickerDocuments()
        // The first phone met today's goal, and made a backup.
        runBlocking { app.test.services.repository.addDrink(THE_DAY, 8 * 60, 2_000) }
        writeABackup()

        // The second phone has no drink yet, and shows a reminder at 09:00.
        setClock(at(8, 20))
        app.startOnAPhoneWithNoData()
        remindersOn()
        assertEquals(listOf(millis(at(9, 0))), waiting())
        setClock(at(9, 0))
        androidFiresTheAlarm()
        assertEquals("0 of 2,000 ml today", checkNotNull(reminder()).text)
        assertEquals(listOf(millis(at(10, 0))), waiting())

        setClock(at(9, 10))
        restoreTheBackup()

        assertNull("the goal is met by the restored drink, so the reminder is removed", reminder())
        assertEquals("no more reminder today", listOf(millis(THE_DAY.plusDays(1).atTime(9, 0))), waiting())
    }

    @Test
    fun whenAndroidStartsWaterForTheAlarmTheReminderShows() {
        remindersOn()
        assertEquals(listOf(millis(at(9, 0))), waiting())

        // Water's process is not running. Android starts it for the alarm, and the start of the app syncs first.
        setClock(at(9, 0, 1))
        app.restart()
        assertEquals(listOf(millis(at(9, 0))), waiting())
        androidFiresTheAlarm()

        assertEquals("0 of 2,000 ml today", checkNotNull(reminder()).text)
        assertEquals(listOf(millis(at(10, 0))), waiting())
    }

    @Test
    fun aChangeInTheSecondsBeforeTheAlarmComesLeavesIt() {
        remindersOn()

        setClock(at(9, 0, 2))
        change { it.copy(cup3Ml = 600) }
        assertEquals(listOf(millis(at(9, 0))), waiting())
        androidFiresTheAlarm()

        checkNotNull(reminder())
    }

    @Test
    fun anAlarmThatComesMoreThanAMinuteLateIsSkipped() {
        remindersOn()

        setClock(at(9, 1, 1))
        androidFiresTheAlarm()

        assertNull(reminder())
        assertEquals(listOf(millis(at(10, 0))), waiting())
    }

    @Test
    fun drankOnTheReminderLogsTheDrinkThroughItsButton() {
        remindersOn()
        setClock(at(9, 0))
        androidFiresTheAlarm()
        assertEquals("Drank 150 ml", checkNotNull(reminder()).buttons.first())

        setClock(at(9, 2))
        press(0)

        assertEquals(listOf(9 * 60 + 2 to 150), drinksToday().map { it.minuteOfDay to it.amountMl })
        assertNull(reminder())
        assertEquals(listOf(millis(at(10, 2))), waiting())
    }

    @Test
    fun aButtonOfAnOlderReminderThatIsPressedLateDoesNothingAndLeavesTheNewerOne() {
        remindersOn()
        setClock(at(9, 0))
        androidFiresTheAlarm()
        // A press that arrives late, or an app with notification access, holds the buttons of the 09:00 reminder.
        val oldDrank = device.keepButton(WaterReminders.KEY, 0)
        val oldLater = device.keepButton(WaterReminders.KEY, 1)
        setClock(at(10, 0))
        androidFiresTheAlarm()
        assertEquals(millis(at(10, 0)), checkNotNull(reminder()).atMillis)

        setClock(at(10, 1))
        oldDrank()
        oldLater()

        assertEquals("no drink is logged", emptyList<Drink>(), drinksToday())
        assertEquals("the 10:00 reminder stays", millis(at(10, 0)), checkNotNull(reminder()).atMillis)
        assertEquals("and no snooze is set", listOf(millis(at(11, 0))), waiting())
    }

    @Test
    fun laterOnTheReminderSnoozesThroughItsButtonAndTheReminderComesAgain() {
        remindersOn()
        setClock(at(9, 0))
        androidFiresTheAlarm()

        setClock(at(9, 2))
        press(1)

        assertNull(reminder())
        assertEquals(listOf(millis(at(9, 17))), waiting())
        setClock(at(9, 17))
        androidFiresTheAlarm()
        assertEquals(millis(at(9, 17)), checkNotNull(reminder()).atMillis)
    }

    @Test
    fun afterARestartOfThePhoneMissedRemindersAreSkipped() {
        remindersOn()

        // The phone is off from 08:30 to 12:20. Then it starts and is unlocked.
        device.forgetTheAlarms()
        setClock(at(12, 20))
        app.restart()
        device.send(Intent.ACTION_BOOT_COMPLETED)

        assertNull("no old reminder appears", reminder())
        assertEquals(listOf(millis(at(13, 0))), waiting())
    }

    @Test
    fun aTapOnTheReminderOpensTodayAsANewScreen() {
        remindersOn()
        setClock(at(9, 0))
        androidFiresTheAlarm()

        val tap = checkNotNull(checkNotNull(reminder()).tap)

        assertEquals(ComponentName(app, WaterActivity::class.java), tap.component)
        assertEquals(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK, tap.flags and (Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
    }

    @Test
    fun whenTheReminderCannotBeShownANoticeShowsAndTheNextOneStillComes() {
        // A reminder whose tap would open another app is refused: the handler fails while it shows it.
        app.restart(open = Intent().setComponent(ComponentName("org.example.other", "org.example.other.Screen")))
        remindersOn()
        setClock(at(9, 0))

        androidFiresTheAlarm()

        val notice = checkNotNull(reminder())
        assertEquals("Drink reminders", notice.title)
        assertEquals(app.getString(NotifyR.string.notify_reminder_failed), notice.text)
        assertEquals(ComponentName(app, WaterActivity::class.java), notice.tap?.component)
        assertEquals(listOf(millis(at(10, 0))), waiting())
    }
}
