package app.shkriuss.feature.reminders

import android.content.ComponentName
import android.content.Intent
import app.shkriuss.core.notify.Alarm
import app.shkriuss.core.notify.AlarmId
import app.shkriuss.core.notify.ButtonPress
import app.shkriuss.core.notify.ChannelImportance
import app.shkriuss.core.notify.R as NotifyR
import app.shkriuss.core.notify.ShkNotification
import java.time.LocalDate
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
 * Reminders' notifications (docs/apps/reminders/spec.md, "When a reminder
 * shows" and "The notification"), with the spec's examples: the alarm of
 * each reminder, what its notification shows, **Done** and **Snooze 10
 * min**, late reminders after the phone was off, a new time zone, summer
 * time, a clock set back or forward, and the changes in the app. On a real
 * database in memory and Robolectric's Android, in Tbilisi unless a test
 * says otherwise, in British English with the 24-hour clock of the spec's
 * examples. Android fires the alarms and sends the presses through the
 * receivers of `core/notify`.
 *
 * "Pills": every day at 09:00. "Call the bank": once, Monday 16 November
 * 2026 at 14:00. "Gym": every Monday, Wednesday and Friday at 18:30.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = NotifyTestApp::class, qualifiers = "en-rGB")
class RemindersAlarmsTest {
    private val setup = AlarmsSetup()

    @After
    fun closeTheDatabase() = setup.database.close()

    /** "Pills", saved on Sunday at 09:30, so that it first shows on Monday at 09:00. */
    private fun savePills(): Reminder = setup.add("Pills", pills(), savedAt = day(-1, 9, 30))

    /** "Call the bank", saved on Monday at 08:00. */
    private fun saveCallTheBank(): Reminder = setup.add("Call the bank", CALL_THE_BANK, savedAt = monday(8))

    private fun shownOf(reminder: Reminder) = checkNotNull(setup.shown(reminder)) { "The notification of ${reminder.title} does not show" }

    // The alarm of each reminder.

    @Test
    fun pillsSavedOnSundayAt0930FirstShowOnMondayAt0900() {
        savePills()

        assertEquals(listOf(setup.millisOf(monday(9))), setup.waiting())
    }

    @Test
    fun gymSavedOnMondayAt1900FirstShowsOnWednesdayAt1830() {
        setup.add("Gym", gym(), savedAt = monday(19))

        assertEquals(listOf(setup.millisOf(day(2, 18, 30))), setup.waiting())
    }

    @Test
    fun eachUpcomingReminderHasItsOwnAlarm() {
        savePills()
        saveCallTheBank()

        assertEquals(listOf(setup.millisOf(monday(9)), setup.millisOf(monday(14))), setup.waiting())
    }

    @Test
    fun aReminderTheSourceSeesFirstGetsTheCurrentMinuteAsItsMark() {
        val pills = savePills()
        // This phone has no entry for it, as after a restore.
        ReminderBook.of(setup.app).remove(listOf(pills.id))

        setup.setClock(monday(9, 30, 20))
        setup.startTheApp()

        assertEquals(monday(9, 30), setup.entryOf(pills).mark)
        assertEquals("it counts from now", listOf(setup.millisOf(day(1, 9))), setup.waiting())
    }

    @Test
    fun undoCountsFromNow() {
        val pills = savePills()
        runBlocking { setup.repository.delete(listOf(pills.id)) }

        setup.setClock(monday(9, 30, 20))
        runBlocking { setup.repository.bringBack(listOf(pills.id)) }

        assertEquals(ReminderEntry(mark = monday(9, 30)), setup.entryOf(pills))
        assertEquals(listOf(setup.millisOf(day(1, 9))), setup.waiting())
    }

    @Test
    fun aMarkLaterThanNowBecomesTheCurrentMinute() {
        val pills = savePills()
        ReminderBook.of(setup.app).update(pills.id) { it.copy(mark = day(3, 9)) }
        setup.startTheApp()

        assertEquals(day(-1, 9, 30), setup.entryOf(pills).mark)
        assertEquals(listOf(setup.millisOf(monday(9))), setup.waiting())
    }

    // What a notification shows.

    @Test
    fun atItsTimeTheReminderShowsItsTitleItsRepeatAndTheTwoButtons() {
        val pills = savePills()

        setup.fireAt(monday(9))

        val shown = shownOf(pills)
        assertEquals("Pills", shown.title)
        assertEquals("Every day", shown.text)
        assertEquals(listOf("Done", "Snooze 10 min"), shown.buttons)
        assertTrue("each button asks for the phone's unlock", shown.buttonsNeedUnlock)
        assertEquals(setup.millisOf(monday(9)), shown.atMillis)
        assertEquals("no end", 0L, shown.timeoutAfterMillis)
        assertEquals(RemindersAlarms.CHANNEL.id, shown.channelId)
        assertEquals("the next one waits", listOf(setup.millisOf(day(1, 9))), setup.waiting())
    }

    @Test
    fun aTapCarriesTheIdOfTheReminderAndNoTitle() {
        val pills = savePills()

        setup.fireAt(monday(9))

        val tap = checkNotNull(shownOf(pills).tap)
        assertEquals(setup.open.component, tap.component)
        assertEquals(pills.id, tap.identifier)
        assertNull("no extras", tap.extras)
    }

    @Test
    fun everyWeekNamesItsDays() {
        val gym = setup.add("Gym", gym(), savedAt = monday(8))

        setup.fireAt(monday(18, 30))

        assertEquals("Every Mon, Wed, Fri", shownOf(gym).text)
    }

    @Test
    fun aOneTimeReminderHasNoTextOnTimeAndThenIsPast() {
        val bank = saveCallTheBank()

        setup.fireAt(monday(14))

        assertEquals("Call the bank", shownOf(bank).title)
        assertNull(shownOf(bank).text)
        assertEquals(emptyList<Long>(), setup.waiting())
        val lists = ReminderLists.of(listOf(bank), setup.repository.entries.value, readingAt(monday(14, 1)))
        assertEquals(listOf(bank), lists.past.map { it.reminder })
    }

    @Test
    fun at090040ItIsOnTime() {
        val pills = savePills()

        setup.fireAt(monday(9, 0, 40))

        assertEquals("Every day", shownOf(pills).text)
    }

    @Test
    fun at090105ItSaysMissed() {
        val pills = savePills()

        setup.fireAt(monday(9, 1, 5))

        assertEquals("Missed: 09:00", shownOf(pills).text)
        assertEquals("the time of the notification is that of its alarm", setup.millisOf(monday(9)), shownOf(pills).atMillis)
    }

    @Test
    fun aReminderMissedOnAnotherDaySaysItsDate() {
        val bank = saveCallTheBank()
        setup.device.forgetTheAlarms()

        setup.setClock(day(1, 10))
        setup.device.send(Intent.ACTION_BOOT_COMPLETED)
        setup.device.fireTheAlarm()

        assertEquals("Missed: Mon 16 Nov, 14:00", shownOf(bank).text)
    }

    @Test
    fun theChannelIsRemindersAndStartsUrgent() {
        val channel = checkNotNull(setup.device.channel(RemindersAlarms.CHANNEL.id))

        assertEquals("Reminders", channel.name)
        assertEquals("Shows each reminder at its time.", channel.description)
        assertEquals(ChannelImportance.Urgent, channel.importance)
    }

    @Test
    fun whileTheAppLockHidesTheTextAReminderShowsOnlyTheChannelAndNoButtons() {
        val pills = savePills()
        setup.hidesText = true

        setup.fireAt(monday(9))

        val shown = shownOf(pills)
        assertEquals("Reminders", shown.title)
        assertEquals(setup.app.getString(NotifyR.string.notify_text_hidden), shown.text)
        assertEquals(emptyList<String>(), shown.buttons)
    }

    @Test
    fun theNextOccurrenceReplacesTheOldNotification() {
        val pills = savePills()
        setup.fireAt(monday(9))

        setup.fireAt(day(1, 9))

        assertEquals(1, setup.device.shownCount())
        assertEquals(setup.millisOf(day(1, 9)), shownOf(pills).atMillis)
    }

    @Test
    fun severalRemindersShowAtOnceEachWithItsOwnNotification() {
        val pills = savePills()
        val bank = setup.add("Call the bank", schedule(Repeat.ONCE, MONDAY, 9), savedAt = monday(8))

        setup.fireAt(monday(9))
        setup.fireAt(monday(9, 0, 1))

        assertNotNull(setup.shown(pills))
        assertNotNull(setup.shown(bank))
        assertEquals(2, setup.device.shownCount())
    }

    // The buttons.

    @Test
    fun snoozeAt0902ShowsItAgainAt0912AndAnotherSnoozeAt0922() {
        val pills = savePills()
        setup.fireAt(monday(9))

        setup.press(pills, SNOOZE, monday(9, 2))

        assertNull("the notification goes", setup.shown(pills))
        assertEquals(listOf(setup.millisOf(monday(9, 12))), setup.waiting())
        setup.fireAt(monday(9, 12))
        assertEquals("Snoozed. It was due at 09:00.", shownOf(pills).text)

        setup.press(pills, SNOOZE, monday(9, 12))
        assertEquals(listOf(setup.millisOf(monday(9, 22))), setup.waiting())
        setup.fireAt(monday(9, 22))
        assertEquals("the first snooze's end never shows", "Snoozed. It was due at 09:00.", shownOf(pills).text)
    }

    @Test
    fun aSnoozeThatArrivesTwiceStaysAt0912() {
        val pills = savePills()
        setup.fireAt(monday(9))
        val again = setup.device.keepButton(pills.id, SNOOZE)

        setup.press(pills, SNOOZE, monday(9, 2))
        setup.setClock(monday(9, 5))
        again()

        assertEquals(listOf(setup.millisOf(monday(9, 12))), setup.waiting())
        assertEquals(setup.millisOf(monday(9, 12)), setup.entryOf(pills).snoozeMillis)
    }

    @Test
    fun doneRemovesTheNotificationAndTheNextComesTomorrow() {
        val pills = savePills()
        setup.fireAt(monday(9))

        setup.press(pills, DONE, monday(9, 5))

        assertNull(setup.shown(pills))
        assertEquals(listOf(setup.millisOf(day(1, 9))), setup.waiting())
        assertNull(setup.entryOf(pills).showingMillis)
    }

    @Test
    fun aPressOnAnOlderNotificationLeavesTheNewerOneAndChangesNothing() {
        val pills = savePills()
        setup.fireAt(monday(9))
        val mondaysSnooze = setup.device.keepButton(pills.id, SNOOZE)
        setup.fireAt(day(1, 9))
        val entry = setup.entryOf(pills)

        setup.setClock(day(1, 9, 3))
        mondaysSnooze()

        assertEquals(setup.millisOf(day(1, 9)), shownOf(pills).atMillis)
        assertEquals(entry, setup.entryOf(pills))
        assertEquals(listOf(setup.millisOf(day(2, 9))), setup.waiting())
    }

    @Test
    fun aSnoozeOfYesterdaysReminderEndsWhenTodaysComesOnTime() {
        val pills = savePills()
        setup.fireAt(monday(9))

        setup.press(pills, SNOOZE, day(1, 8, 55))

        assertEquals("today's comes first", listOf(setup.millisOf(day(1, 9))), setup.waiting())
        setup.fireAt(day(1, 9))
        assertEquals("on time", "Every day", shownOf(pills).text)
        assertNull("the snooze ends", setup.entryOf(pills).snoozeMillis)
        assertEquals(listOf(setup.millisOf(day(2, 9))), setup.waiting())
    }

    @Test
    fun aSnoozeOfAReminderFromAnotherDaySaysItsDate() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))

        setup.press(bank, SNOOZE, day(1, 10))
        setup.fireAt(day(1, 10, 10))

        assertEquals("Snoozed. It was due at Mon 16 Nov, 14:00.", shownOf(bank).text)
    }

    @Test
    fun doneAfterAStopBeforeTheMarkWasWrittenEndsTheSnoozeAndTheTimeShowsNoMore() {
        val pills = savePills()
        setup.fireAt(monday(9))
        setup.press(pills, SNOOZE, day(1, 8, 55))
        setup.fireAt(day(1, 9))
        // Reminders was stopped after it showed Tuesday's and before it wrote the mark: the file holds what it held then.
        ReminderBook.of(setup.app).update(pills.id) {
            ReminderEntry(mark = monday(9), snoozeMillis = setup.millisOf(day(1, 9, 5)), showingMillis = setup.millisOf(day(1, 9)))
        }
        setup.setClock(day(1, 9, 2))
        setup.startTheApp()

        setup.press(pills, DONE, day(1, 9, 2))

        assertEquals(ReminderEntry(mark = day(1, 9)), setup.entryOf(pills))
        assertEquals("nothing more until Wednesday at 09:00", listOf(setup.millisOf(day(2, 9))), setup.waiting())
    }

    @Test
    fun aButtonThisVersionDoesNotKnowDoesNothing() {
        val pills = savePills()
        setup.fireAt(monday(9))
        val entry = setup.entryOf(pills)

        setup.alarms.onButton(ButtonPress(pills.id, "later", setup.millisOf(monday(9)), 0), setup.app.notify.notifications)
        setup.alarms.onButton(ButtonPress(pills.id, RemindersAlarms.SNOOZE, setup.millisOf(monday(9)), 15), setup.app.notify.notifications)

        assertNotNull(setup.shown(pills))
        assertEquals(entry, setup.entryOf(pills))
    }

    // Late reminders.

    @Test
    fun withThePhoneOffFromMondayToWednesdayOnlyWednesdaysShowsLate() {
        val pills = savePills()
        setup.setClock(monday(8))
        setup.device.forgetTheAlarms()

        setup.setClock(day(2, 11))
        setup.device.send(Intent.ACTION_BOOT_COMPLETED)
        assertEquals(listOf(setup.millisOf(day(2, 9))), setup.waiting())
        setup.device.fireTheAlarm()

        assertEquals("Missed: 09:00", shownOf(pills).text)
        assertEquals(setup.millisOf(day(2, 9)), shownOf(pills).atMillis)
        assertEquals("Monday and Tuesday are skipped", 1, setup.device.shownCount())
        assertEquals(listOf(setup.millisOf(day(3, 9))), setup.waiting())
    }

    @Test
    fun aRestartAt1300AndTheUnlockAt1510ShowCallTheBankLate() {
        val bank = saveCallTheBank()
        setup.setClock(monday(13))
        setup.device.forgetTheAlarms()

        setup.setClock(monday(15, 10))
        setup.device.send(Intent.ACTION_BOOT_COMPLETED)
        setup.device.fireTheAlarm()

        assertEquals("Missed: 14:00", shownOf(bank).text)
    }

    @Test
    fun afterAForceStopAt0800OpeningTheAppAt1200ShowsPillsLate() {
        val pills = savePills()
        setup.setClock(monday(8))
        setup.device.forgetTheAlarms()

        setup.setClock(monday(12))
        setup.startTheApp()
        setup.device.fireTheAlarm()

        assertEquals("Missed: 09:00", shownOf(pills).text)
    }

    @Test
    fun aReminderStoppedWhileItWasBeingShownShowsAtTheNextStart() {
        val bank = saveCallTheBank()
        // Reminders was stopped in the handler at 14:00, after step 1: its alarm never counted as fired.
        setup.setClock(monday(14))
        ReminderBook.of(setup.app).update(bank.id) { it.copy(showingMillis = setup.millisOf(monday(14))) }
        setup.device.forgetTheAlarms()

        setup.setClock(monday(14, 5))
        setup.startTheApp()
        setup.device.fireTheAlarm()

        assertEquals("Missed: 14:00", shownOf(bank).text)
        assertEquals(emptyList<Long>(), setup.waiting())
    }

    @Test
    fun aSnoozeThatEndedWhileThePhoneWasOffShowsAfterTheUnlock() {
        val pills = savePills()
        setup.fireAt(monday(9))
        setup.press(pills, SNOOZE, monday(9, 2))
        setup.setClock(monday(9, 10))
        setup.device.forgetTheAlarms()

        setup.setClock(monday(10))
        setup.device.send(Intent.ACTION_BOOT_COMPLETED)
        setup.device.fireTheAlarm()

        assertEquals("Snoozed. It was due at 09:00.", shownOf(pills).text)
        assertEquals(listOf(setup.millisOf(day(1, 9))), setup.waiting())
    }

    @Test
    fun withNotificationsNotAllowedTheAlarmsStillFireAndTheMarksMoveOn() {
        val pills = savePills()
        setup.device.allowNotifications(false)

        setup.fireAt(monday(9))

        assertEquals(monday(9), setup.entryOf(pills).mark)
        assertEquals(listOf(setup.millisOf(day(1, 9))), setup.waiting())
    }

    // Time zones and the clock.

    @Test
    fun pillsShownAt0900FollowTheMoveToBerlinAt1300ToTuesday() {
        savePills()
        setup.fireAt(monday(9))

        setup.setClock(monday(13))
        setup.zone = BERLIN
        setup.device.send(Intent.ACTION_TIMEZONE_CHANGED)

        assertEquals(listOf(millisAt(day(1, 9), BERLIN)), setup.waiting())
    }

    @Test
    fun pillsShownAt0900ShowAgainAt0900BerlinTimeAfterAMoveAt1100() {
        val pills = savePills()
        setup.fireAt(monday(9))

        // 11:00 in Tbilisi is 08:00 in Berlin.
        setup.setClock(monday(11))
        setup.zone = BERLIN
        setup.device.send(Intent.ACTION_TIMEZONE_CHANGED)

        assertEquals(monday(8), setup.entryOf(pills).mark)
        assertEquals(listOf(millisAt(monday(9), BERLIN)), setup.waiting())
    }

    @Test
    fun withThePhoneOffFromBerlinToTbilisiPillsShowLateAt1500() {
        setup.zone = BERLIN
        val pills = setup.add("Pills", pills(), savedAt = day(-1, 9, 30))
        setup.setClock(monday(7))
        setup.device.forgetTheAlarms()

        setup.zone = TBILISI
        setup.setClock(monday(15))
        setup.device.send(Intent.ACTION_BOOT_COMPLETED)
        setup.device.fireTheAlarm()

        assertEquals("Missed: 09:00", shownOf(pills).text)
    }

    @Test
    fun callTheBankMadeInTbilisiShowsAt1400BerlinTime() {
        saveCallTheBank()
        setup.setClock(monday(8, 30))
        setup.zone = BERLIN
        setup.device.send(Intent.ACTION_TIMEZONE_CHANGED)

        assertEquals(listOf(millisAt(monday(14), BERLIN)), setup.waiting())
    }

    @Test
    fun afterTheClockIsSetBackFrom0930To0830PillsShowAgainAt0900() {
        savePills()
        setup.fireAt(monday(9))

        setup.setClock(monday(8, 30))
        setup.device.send(Intent.ACTION_TIME_CHANGED)

        assertEquals(listOf(setup.millisOf(monday(9))), setup.waiting())
    }

    @Test
    fun afterTheClockIsSetForwardFrom1000To1500CallTheBankShowsAtOnceLate() {
        val bank = saveCallTheBank()
        setup.setClock(monday(10))

        setup.setClock(monday(15))
        setup.device.send(Intent.ACTION_TIME_CHANGED)
        setup.device.fireTheAlarm()

        assertEquals("Missed: 14:00", shownOf(bank).text)
    }

    @Test
    fun inBerlinOnTheDayTheClocksGoForward0230ShowsAt0330AndTheNextAt0230() {
        setup.zone = BERLIN
        val spring = LocalDate.of(2027, 3, 28)
        val early = setup.add("Early", schedule(Repeat.DAILY, spring.minusDays(1), 2, 30), savedAt = spring.minusDays(1).atTime(12, 0))
        assertEquals(listOf(millisAt(spring.atTime(3, 30), BERLIN)), setup.waiting())

        setup.fireAt(spring.atTime(3, 30))

        assertEquals("Every day", shownOf(early).text)
        assertEquals(listOf(millisAt(spring.plusDays(1).atTime(2, 30), BERLIN)), setup.waiting())
    }

    @Test
    fun inBerlinOnTheDayTheClocksGoBack0230ShowsOnceAtTheFirst() {
        setup.zone = BERLIN
        val autumn = LocalDate.of(2027, 10, 31)
        setup.add("Early", schedule(Repeat.DAILY, autumn.minusDays(1), 2, 30), savedAt = autumn.minusDays(1).atTime(12, 0))
        val first = millisAt(autumn.atTime(2, 30), BERLIN)
        assertEquals(listOf(first), setup.waiting())

        setup.clock.nowMillis = first
        setup.device.fireTheAlarm()
        // The second 02:30, an hour later.
        setup.clock.nowMillis = first + 60 * 60_000
        setup.device.send(Intent.ACTION_TIME_CHANGED)

        assertEquals(listOf(millisAt(autumn.plusDays(1).atTime(2, 30), BERLIN)), setup.waiting())
    }

    // Changes in the app.

    @Test
    fun aDeleteRemovesTheNotificationTheAlarmAndTheEntries() {
        val pills = savePills()
        setup.fireAt(monday(9))

        runBlocking { setup.repository.delete(listOf(pills.id)) }

        assertNull(setup.shown(pills))
        assertEquals(emptyList<Long>(), setup.waiting())
        assertEquals(ReminderEntry(), setup.entryOf(pills))
    }

    @Test
    fun aNewTimeRemovesTheNotificationAndCountsFromNow() {
        val pills = savePills()
        setup.fireAt(monday(9))
        setup.press(pills, SNOOZE, monday(9, 2))
        setup.fireAt(monday(9, 12))

        setup.setClock(monday(9, 20))
        runBlocking { setup.repository.change(pills.id, "Pills", schedule(Repeat.DAILY, MONDAY, 9, 30)) }

        assertNull(setup.shown(pills))
        assertEquals(ReminderEntry(mark = monday(9, 20)), setup.entryOf(pills))
        assertEquals(listOf(setup.millisOf(monday(9, 30))), setup.waiting())
    }

    @Test
    fun aNotificationThatShowedAfterTheEntryWasResetStays() {
        val pills = savePills()
        setup.fireAt(monday(9))
        assertNotNull(setup.shown(pills))

        // The handler showed it after a write reset the entry, and before that write's notification was to go.
        runBlocking { setup.alarms.afterChange(ReminderChange(ReminderChange.Kind.NEW_TIME, listOf(pills.id))) }

        assertNotNull("a notification whose showing counts stays", setup.shown(pills))
    }

    @Test
    fun theHandlerStoresShowingBeforeItPostsAndMovesTheMarkOnlyAfter() {
        val pills = savePills()
        setup.setClock(monday(9))
        val at = setup.millisOf(monday(9))
        var atThePost: ReminderEntry? = null

        setup.alarms.handle(Alarm(AlarmId(pills.id), at)) { atThePost = ReminderBook.of(setup.app).entryOf(pills.id) }

        assertEquals(
            "stored as it posts: showing is T, and the mark has not moved, so a stop here shows it again",
            ReminderEntry(mark = day(-1, 9, 30), showingMillis = at),
            atThePost,
        )
        assertEquals("after the post, the mark is T", ReminderEntry(mark = monday(9), showingMillis = at), setup.entryOf(pills))
    }

    @Test
    fun anAlarmWhoseTimeIsStillToComeAfterTheClockWasSetBackShowsNothingYet() {
        val pills = savePills()
        // core/notify found 09:00 due. Before the handler reads the clock, it is set back to 08:00.
        setup.setClock(monday(8))
        val shown = mutableListOf<ShkNotification>()

        setup.alarms.handle(Alarm(AlarmId(pills.id), setup.millisOf(monday(9)))) { shown += it }

        assertEquals(emptyList<ShkNotification>(), shown)
        assertEquals("nothing is written", ReminderEntry(mark = day(-1, 9, 30)), setup.entryOf(pills))
    }

    @Test
    fun aNewTitleAloneLeavesTheNotificationWithTheOldTitle() {
        val pills = savePills()
        setup.fireAt(monday(9))

        setup.setClock(monday(9, 10))
        runBlocking { setup.repository.change(pills.id, "Vitamins", pills.schedule) }

        assertEquals("Pills", shownOf(pills).title)
        assertEquals(listOf(setup.millisOf(day(1, 9))), setup.waiting())
    }

    @Test
    fun aPressOnTheNotificationOfADeletedReminderOnlyRemovesIt() {
        val pills = savePills()
        setup.fireAt(monday(9))
        val done = setup.device.keepButton(pills.id, DONE)
        runBlocking { setup.repository.delete(listOf(pills.id)) }

        done()

        assertEquals(ReminderEntry(), setup.entryOf(pills))
        assertEquals(emptyList<Long>(), setup.waiting())
    }

    @Test
    fun anAlarmOfADeletedReminderShowsNothing() {
        val pills = savePills()
        setup.setClock(monday(9))

        runBlocking { setup.repository.delete(listOf(pills.id)) }
        setup.alarms.onAlarm(Alarm(AlarmId(pills.id), setup.millisOf(monday(9))), setup.app.notify.notifications)

        assertNull(setup.shown(pills))
        assertEquals(ReminderEntry(), setup.entryOf(pills))
    }

    @Test
    fun aSecondRunForTheSameTimeShowsNothingMore() {
        val pills = savePills()
        setup.fireAt(monday(9))
        setup.press(pills, DONE, monday(9, 1))

        setup.alarms.onAlarm(Alarm(AlarmId(pills.id), setup.millisOf(monday(9))), setup.app.notify.notifications)

        assertNull(setup.shown(pills))
    }

    // When the handler fails.

    @Test
    fun whenReadingFailsTheMarkMovesAndAnOlderPressNoLongerCounts() {
        val pills = savePills()
        setup.fireAt(monday(9))
        val mondaysDone = setup.device.keepButton(pills.id, DONE)
        setup.database.close()

        setup.setClock(day(1, 9))
        assertThrows(Exception::class.java) {
            setup.alarms.onAlarm(Alarm(AlarmId(pills.id), setup.millisOf(day(1, 9))), setup.app.notify.notifications)
        }

        assertEquals(ReminderEntry(mark = day(1, 9), showingMillis = setup.millisOf(day(1, 9))), setup.entryOf(pills))
        mondaysDone()
        assertNotNull("the press is not current, so it removes nothing", setup.shown(pills))
        assertEquals(setup.millisOf(day(1, 9)), setup.entryOf(pills).showingMillis)
    }

    @Test
    fun whenShowingFailsTheNoticeOfCoreNotifyTakesItsPlaceAndTheNextStillComes() {
        val pills = savePills()
        setup.open = Intent().setComponent(ComponentName("org.example.other", "org.example.other.Screen"))
        setup.startTheApp()

        setup.fireAt(monday(9))

        val notice = shownOf(pills)
        assertEquals("Reminders", notice.title)
        assertEquals(setup.app.getString(NotifyR.string.notify_reminder_failed), notice.text)
        assertEquals(ReminderEntry(mark = monday(9), showingMillis = setup.millisOf(monday(9))), setup.entryOf(pills))
        assertEquals(listOf(setup.millisOf(day(1, 9))), setup.waiting())
    }
}
