package app.shkriuss.feature.tasks

import android.content.ComponentName
import android.content.Intent
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.core.notify.Alarm
import app.shkriuss.core.notify.AlarmId
import app.shkriuss.core.notify.ButtonPress
import app.shkriuss.core.notify.ChannelImportance
import app.shkriuss.core.notify.R as NotifyR
import app.shkriuss.core.notify.ShkNotification
import app.shkriuss.core.testing.TestIdSource
import java.time.LocalDate
import java.time.LocalDateTime
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
 * Tasks' reminders (docs/apps/tasks/spec.md, "Reminders of a task" and
 * "The notification"): the alarm of each task, what its notification
 * shows, **Done** and **Snooze 10 min**, late reminders after the phone
 * was off, the review at every start, a new time zone, summer time, a
 * clock set back or forward, and the changes in the app. On a real
 * database in memory and Robolectric's Android, in Tbilisi unless a test
 * says otherwise, in British English with the 24-hour clock of the spec's
 * examples. Android fires the alarms and sends the presses through the
 * receivers of `core/notify`.
 *
 * "Call the bank": due Monday 16 November 2026, once, with a reminder at
 * 14:00. "Pills": every day from Monday, due Monday, at 09:00. Both are
 * saved on Monday at 08:00.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = NotifyTestApp::class, qualifiers = "en-rGB")
class TasksAlarmsTest {
    private val setup = AlarmsSetup()

    @After
    fun closeTheDatabase() = setup.database.close()

    private fun saveCallTheBank(): Task = setup.add("Call the bank", Due(MONDAY, null, 14 * 60), savedAt = monday(8))

    private fun savePills(): Task = setup.add("Pills", Due(MONDAY, PILLS, 9 * 60), savedAt = monday(8))

    private fun shownOf(task: Task) = checkNotNull(setup.shown(task)) { "The notification of ${task.title} does not show" }

    private fun numberOf(task: Task): Long = checkNotNull(setup.find(task)?.let(TaskReminders::numberOf))

    /** [MONDAY] plus [days], at [hour]:[minute]:[second]. */
    private fun day(days: Long, hour: Int, minute: Int = 0, second: Int = 0): LocalDateTime = day(days).atTime(hour, minute, second)

    // The alarm of each task.

    @Test
    fun aTaskWithAReminderHasOneAlarmAtItsMoment() {
        saveCallTheBank()
        savePills()

        assertEquals(listOf(setup.millisOf(monday(9)), setup.millisOf(monday(14))), setup.waiting())
    }

    @Test
    fun aTaskWithNoReminderOrNoDueDayHasNoAlarm() {
        setup.add("Water the plants", Due(MONDAY), savedAt = monday(8))
        setup.add("Read a book", null, savedAt = monday(8))

        assertEquals(emptyList<Long>(), setup.waiting())
    }

    @Test
    fun aTaskTheSourceSeesFirstGetsTheCurrentMinuteAsItsMark() {
        val pills = savePills()
        // This phone has no entry for it, as after a restore.
        TaskBook.of(setup.app).remove(listOf(pills.id))

        setup.setClock(monday(9, 30, 20))
        setup.startTheApp()

        assertEquals(TaskEntry(numberOf(pills), mark = monday(9, 30)), setup.entryOf(pills))
        assertEquals("09:00 has passed, and the reminder counts from now", emptyList<Long>(), setup.waiting())
    }

    @Test
    fun anEntryWrittenForAnotherReminderNumberCountsAsMissing() {
        val bank = saveCallTheBank()
        // A snooze from before the time was changed: Tasks stopped after the write of the task, before the entries.
        TaskBook.of(setup.app).update(listOf(bank.id)) { _, _ ->
            TaskEntry(number = 1L, mark = monday(7), snoozeMillis = setup.millisOf(monday(10)), showingMillis = setup.millisOf(monday(7)))
        }

        setup.setClock(monday(9))
        setup.startTheApp()

        assertEquals("the snooze of the old number never fires", listOf(setup.millisOf(monday(14))), setup.waiting())
        assertEquals(TaskEntry(numberOf(bank), mark = monday(9)), setup.entryOf(bank))
    }

    @Test
    fun theSourceDropsTheEntriesOfATaskThatIsDoneDeletedOrNotStored() {
        val bank = saveCallTheBank()
        val pills = savePills()
        val book = TaskBook.of(setup.app)
        // Tasks stopped after the database write and before the entries went.
        val writer = RecordWriter(setup.database, setup.database.tasks(), setup.clock, TestIdSource())
        runBlocking {
            writer.update(bank.id) { it.copy(doneAt = setup.millisOf(monday(8, 30))) }
            writer.markDeleted(pills.id)
        }
        book.update(listOf("4b3c2a10-0000-4000-8000-000000000000")) { _, _ -> TaskEntry(number = 5L, mark = monday(7)) }

        setup.startTheApp()

        assertEquals(emptyMap<String, TaskEntry>(), setup.repository.entries.value)
        assertEquals(emptyList<Long>(), setup.waiting())
    }

    @Test
    fun aMarkLaterThanNowBecomesTheCurrentMinute() {
        val pills = savePills()
        TaskBook.of(setup.app).update(listOf(pills.id)) { _, it -> it.copy(mark = day(3, 9)) }

        setup.setClock(monday(8, 10))
        setup.startTheApp()

        assertEquals(monday(8, 10), setup.entryOf(pills).mark)
        assertEquals(listOf(setup.millisOf(monday(9))), setup.waiting())
    }

    // What a notification shows.

    @Test
    fun atItsTimeTheReminderShowsItsTitleDueTodayAndTheTwoButtons() {
        val bank = saveCallTheBank()

        setup.fireAt(monday(14))

        val shown = shownOf(bank)
        assertEquals("Call the bank", shown.title)
        assertEquals("Due today", shown.text)
        assertEquals(listOf("Done", "Snooze 10 min"), shown.buttons)
        assertTrue("each button asks for the phone's unlock", shown.buttonsNeedUnlock)
        assertEquals(setup.millisOf(monday(14)), shown.atMillis)
        assertEquals("no end", 0L, shown.timeoutAfterMillis)
        assertEquals(TasksAlarms.CHANNEL.id, shown.channelId)
        assertEquals("it is dealt with: no alarm waits", emptyList<Long>(), setup.waiting())
    }

    @Test
    fun aRepeatingTaskSaysItsRepeatAfterDueToday() {
        val pills = savePills()

        setup.fireAt(monday(9))

        assertEquals("Due today · Every day", shownOf(pills).text)
    }

    @Test
    fun aTapCarriesTheIdOfTheTaskAndNoTitle() {
        val bank = saveCallTheBank()

        setup.fireAt(monday(14))

        val tap = checkNotNull(shownOf(bank).tap)
        assertEquals(setup.open.component, tap.component)
        assertEquals(bank.id, tap.identifier)
        assertNull("no extras", tap.extras)
    }

    @Test
    fun at140040ItIsOnTime() {
        val bank = saveCallTheBank()

        setup.fireAt(monday(14, 0, 40))

        assertEquals("Due today", shownOf(bank).text)
    }

    @Test
    fun at140105ItSaysMissed() {
        val bank = saveCallTheBank()

        setup.fireAt(monday(14, 1, 5))

        assertEquals("Missed: 14:00", shownOf(bank).text)
        assertEquals("the time of the notification is that of its alarm", setup.millisOf(monday(14)), shownOf(bank).atMillis)
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
    fun theChannelIsTaskRemindersAndStartsUrgent() {
        val channel = checkNotNull(setup.device.channel(TasksAlarms.CHANNEL.id))

        assertEquals("tasks", TasksAlarms.CHANNEL.id)
        assertEquals("Task reminders", channel.name)
        assertEquals("Shows a task's reminder at its time.", channel.description)
        assertEquals(ChannelImportance.Urgent, channel.importance)
    }

    @Test
    fun whileTheAppLockHidesTheTextAReminderShowsOnlyTheChannelAndNoButtons() {
        val bank = saveCallTheBank()
        setup.hidesText = true

        setup.fireAt(monday(14))

        val shown = shownOf(bank)
        assertEquals("Task reminders", shown.title)
        assertEquals(setup.app.getString(NotifyR.string.notify_text_hidden), shown.text)
        assertEquals(emptyList<String>(), shown.buttons)
    }

    @Test
    fun severalTasksShowAtOnceEachWithItsOwnNotification() {
        val pills = savePills()
        val bank = setup.add("Call the bank", Due(MONDAY, null, 9 * 60), savedAt = monday(8))

        setup.fireAt(monday(9))
        setup.fireAt(monday(9, 0, 1))

        assertNotNull(setup.shown(pills))
        assertNotNull(setup.shown(bank))
        assertEquals(2, setup.device.shownCount())
    }

    // Snooze 10 min.

    @Test
    fun snoozeAt1402ShowsItAgainAt1412AndAnotherSnoozeAt1422() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))

        setup.press(bank, SNOOZE, monday(14, 2))

        assertNull("the notification goes", setup.shown(bank))
        assertEquals(listOf(setup.millisOf(monday(14, 12))), setup.waiting())
        setup.fireAt(monday(14, 12))
        assertEquals("Snoozed. It was due at 14:00.", shownOf(bank).text)

        setup.press(bank, SNOOZE, monday(14, 12))
        assertEquals(listOf(setup.millisOf(monday(14, 22))), setup.waiting())
        setup.fireAt(monday(14, 22))
        assertEquals("the first snooze's end never shows", "Snoozed. It was due at 14:00.", shownOf(bank).text)
    }

    @Test
    fun aSnoozeThatArrivesTwiceStaysAt1412() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))
        val again = setup.device.keepButton(bank.id, SNOOZE)

        setup.press(bank, SNOOZE, monday(14, 2))
        setup.setClock(monday(14, 5))
        again()

        assertEquals(listOf(setup.millisOf(monday(14, 12))), setup.waiting())
        assertEquals(setup.millisOf(monday(14, 12)), setup.entryOf(bank).snoozeMillis)
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
    fun aSnoozeEndsWhenTheTaskGetsANewTime() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))
        setup.press(bank, SNOOZE, monday(14, 2))

        setup.setClock(monday(14, 5))
        runBlocking { setup.repository.changeTask(bank.id, TaskEdit(due = DueEdit(Due(day(1), null, 9 * 60), true, true))) }

        assertEquals("only the new day's reminder waits", listOf(setup.millisOf(day(1, 9))), setup.waiting())
        assertEquals(TaskEntry(numberOf(bank), mark = monday(14, 5)), setup.entryOf(bank))
    }

    // Done.

    @Test
    fun doneOnATaskWithoutARepeatMarksItDoneAndEverythingGoes() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))

        setup.press(bank, DONE, monday(14, 5))

        assertEquals(setup.millisOf(monday(14, 5)), setup.find(bank)?.doneAt)
        assertNull(setup.shown(bank))
        assertEquals(emptyList<Long>(), setup.waiting())
        assertEquals(TaskEntry(), setup.entryOf(bank))
    }

    @Test
    fun doneOnARepeatingTaskMovesItToItsNextDateWhereItRemindsAtTheSameTime() {
        val pills = savePills()
        setup.fireAt(monday(9))

        setup.press(pills, DONE, monday(9, 5))

        val moved = checkNotNull(setup.find(pills))
        assertTrue("it stays open", moved.isOpen)
        assertEquals(day(1), moved.due?.day)
        assertNull(setup.shown(pills))
        assertEquals(TaskEntry(numberOf(pills), mark = monday(9, 5)), setup.entryOf(pills))
        assertEquals(listOf(setup.millisOf(day(1, 9))), setup.waiting())
    }

    @Test
    fun doneTwiceMovesARepeatingTaskOneDate() {
        val pills = savePills()
        setup.fireAt(monday(9))
        val again = setup.device.keepButton(pills.id, DONE)

        setup.press(pills, DONE, monday(9, 5))
        again()

        assertEquals(day(1), setup.find(pills)?.due?.day)
    }

    @Test
    fun doneAfterTheReminderWasTurnedOffIsNotCurrent() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))
        val done = setup.device.keepButton(bank.id, DONE)

        runBlocking { setup.repository.changeTask(bank.id, TaskEdit(due = DueEdit(Due(MONDAY), false, true))) }
        done()

        assertTrue("the task stays open", setup.find(bank)?.isOpen == true)
        assertNull(setup.shown(bank))
    }

    @Test
    fun doneAfterTheTimeChangedIsNotCurrentAndLeavesTheTask() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))
        val done = setup.device.keepButton(bank.id, DONE)

        setup.setClock(monday(14, 3))
        runBlocking { setup.repository.changeTask(bank.id, TaskEdit(due = DueEdit(Due(MONDAY, null, 15 * 60), false, true))) }
        done()

        assertTrue(setup.find(bank)?.isOpen == true)
        assertEquals(listOf(setup.millisOf(monday(15))), setup.waiting())
    }

    @Test
    fun doneCarriesTheReminderNumberWhenItShowed() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))
        val at = setup.millisOf(monday(14))

        // The same time on screen, with another number: not current.
        setup.alarms.onButton(ButtonPress(bank.id, TasksAlarms.DONE, at, numberOf(bank) + 1), setup.app.notify.notifications)
        assertTrue(setup.find(bank)?.isOpen == true)
        assertNotNull("the notification of the number now stays", setup.shown(bank))

        setup.alarms.onButton(ButtonPress(bank.id, TasksAlarms.DONE, at, numberOf(bank)), setup.app.notify.notifications)
        assertNotNull(setup.find(bank)?.doneAt)
    }

    @Test
    fun anOldDoneLeavesTheNotificationOfTheNextDate() {
        val pills = savePills()
        setup.fireAt(monday(9))
        val mondaysDone = setup.device.keepButton(pills.id, DONE)
        // The tick in the app moves Pills to Tuesday, where it shows at 09:00.
        runBlocking { setup.repository.tick(pills.id, MONDAY, Repeat.DAILY) }
        setup.fireAt(day(1, 9))

        mondaysDone()

        assertEquals("Tuesday's stays", setup.millisOf(day(1, 9)), shownOf(pills).atMillis)
        assertEquals(day(1), setup.find(pills)?.due?.day)
    }

    @Test
    fun aPressOnTheNotificationOfADeletedTaskOnlyRemovesIt() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))
        val done = setup.device.keepButton(bank.id, DONE)
        runBlocking { setup.repository.deleteTask(bank.id) }

        done()

        assertEquals(TaskEntry(), setup.entryOf(bank))
        assertNull(setup.shown(bank))
        assertEquals(emptyList<Long>(), setup.waiting())
    }

    @Test
    fun aButtonThisVersionDoesNotKnowDoesNothing() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))
        val entry = setup.entryOf(bank)
        val at = setup.millisOf(monday(14))

        setup.alarms.onButton(ButtonPress(bank.id, "later", at, 0), setup.app.notify.notifications)
        setup.alarms.onButton(ButtonPress(bank.id, TasksAlarms.SNOOZE, at, 15), setup.app.notify.notifications)

        assertNotNull(setup.shown(bank))
        assertEquals(entry, setup.entryOf(bank))
        assertTrue(setup.find(bank)?.isOpen == true)
    }

    // Late reminders.

    @Test
    fun withThePhoneOffFromMondayToWednesdayTheReminderShowsLateOnce() {
        val pills = savePills()
        setup.setClock(monday(8, 30))
        setup.device.forgetTheAlarms()

        setup.setClock(day(2, 11))
        setup.device.send(Intent.ACTION_BOOT_COMPLETED)
        setup.device.fireTheAlarm()

        assertEquals("Missed: Mon 16 Nov, 09:00", shownOf(pills).text)
        assertEquals(1, setup.device.shownCount())
        assertEquals("shown once", emptyList<Long>(), setup.waiting())
    }

    @Test
    fun aTaskStoppedWhileItWasBeingShownShowsAtTheNextStart() {
        val bank = saveCallTheBank()
        // Tasks was stopped in the handler at 14:00, after step 1: its alarm never counted as fired.
        setup.setClock(monday(14))
        TaskBook.of(setup.app).update(listOf(bank.id)) { _, it -> it.copy(showingMillis = setup.millisOf(monday(14))) }
        setup.device.forgetTheAlarms()

        setup.setClock(monday(14, 5))
        setup.startTheApp()
        setup.device.fireTheAlarm()

        assertEquals("Missed: 14:00", shownOf(bank).text)
        assertEquals(emptyList<Long>(), setup.waiting())
    }

    @Test
    fun withNotificationsNotAllowedTheAlarmsStillFireAndTheMarksMoveOn() {
        val bank = saveCallTheBank()
        setup.device.allowNotifications(false)

        setup.fireAt(monday(14))

        assertEquals(monday(14), setup.entryOf(bank).mark)
        assertEquals(emptyList<Long>(), setup.waiting())
    }

    // The review at every start.

    @Test
    fun aNotificationOfATaskDeletedJustBeforeAStopGoesAtTheNextStart() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))
        // The delete is stored, and Tasks stops before it removes the notification.
        runBlocking { RecordWriter(setup.database, setup.database.tasks(), setup.clock, TestIdSource()).markDeleted(bank.id) }
        shownOf(bank)

        setup.startTheApp()

        assertNull("the title left the notification shade", setup.shown(bank))
    }

    @Test
    fun aNotificationOfATaskDoneJustBeforeAStopGoesAtTheNextStart() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))
        runBlocking {
            RecordWriter(setup.database, setup.database.tasks(), setup.clock, TestIdSource()).update(bank.id) {
                it.copy(doneAt = setup.millisOf(monday(14, 1)))
            }
        }

        setup.startTheApp()

        assertNull(setup.shown(bank))
        assertEquals(TaskEntry(), setup.entryOf(bank))
    }

    @Test
    fun theNotificationOfALiveTaskStaysAtTheNextStart() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))

        setup.startTheApp()

        assertEquals("Call the bank", shownOf(bank).title)
    }

    @Test
    fun aNotificationWhoseDoneCarriesAnotherNumberGoesAndItsShowingToo() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))
        val at = setup.millisOf(monday(14))
        // The task got another time, and its entry for the new number has the same showing time: only the review can tell.
        runBlocking {
            RecordWriter(setup.database, setup.database.tasks(), setup.clock, TestIdSource()).update(bank.id) { it.copy(remindMinute = 15 * 60) }
        }
        TaskBook.of(setup.app).update(listOf(bank.id)) { _, _ -> TaskEntry(numberOf(bank), mark = monday(14), showingMillis = at) }

        setup.startTheApp()

        assertNull(setup.shown(bank))
        assertNull("a press kept from it is not current", setup.entryOf(bank).showingMillis)
    }

    @Test
    fun aNotificationThatLostItsTextWhenTheAppLockWentOnStaysAtTheNextStart() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))
        setup.hidesText = true

        setup.startTheApp()

        val shown = shownOf(bank)
        assertEquals("Task reminders", shown.title)
        assertEquals(setup.app.getString(NotifyR.string.notify_text_hidden), shown.text)
    }

    // Time zones and the clock.

    @Test
    fun aReminderAt0900ComesAt0900InTheNewZone() {
        savePills()

        setup.setClock(monday(8, 30))
        setup.zone = BERLIN
        setup.device.send(Intent.ACTION_TIMEZONE_CHANGED)

        assertEquals(listOf(monday(9).atZone(BERLIN).toInstant().toEpochMilli()), setup.waiting())
    }

    @Test
    fun theClockSetForwardPastAReminderShowsItAtOnceLate() {
        val bank = saveCallTheBank()
        setup.setClock(monday(10))

        setup.setClock(monday(15))
        setup.device.send(Intent.ACTION_TIME_CHANGED)
        setup.device.fireTheAlarm()

        assertEquals("Missed: 14:00", shownOf(bank).text)
    }

    @Test
    fun theClockSetBackAfterTheReminderShowedShowsItAgain() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))

        setup.setClock(monday(13, 30))
        setup.device.send(Intent.ACTION_TIME_CHANGED)

        assertEquals(listOf(setup.millisOf(monday(14))), setup.waiting())
    }

    @Test
    fun inBerlinOnTheDayTheClocksGoForward0230ShowsAt0330() {
        setup.zone = BERLIN
        val spring = LocalDate.of(2027, 3, 28)
        val early = setup.add("Early", Due(spring, null, 2 * 60 + 30), savedAt = spring.minusDays(1).atTime(12, 0))

        assertEquals(listOf(setup.millisOf(spring.atTime(3, 30))), setup.waiting())
        setup.fireAt(spring.atTime(3, 30))
        assertEquals("Due today", shownOf(early).text)
    }

    // Changes in the app.

    @Test
    fun aDeleteRemovesTheNotificationTheAlarmAndTheEntries() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))

        runBlocking { setup.repository.deleteTask(bank.id) }

        assertNull(setup.shown(bank))
        assertEquals(emptyList<Long>(), setup.waiting())
        assertEquals(TaskEntry(), setup.entryOf(bank))
    }

    @Test
    fun deletingAListRemovesTheNotificationsOfItsTasks() {
        val home = runBlocking { checkNotNull(setup.repository.addList("Home")) }
        val bank = setup.add("Call the bank", Due(MONDAY, null, 14 * 60), savedAt = monday(8), listId = home.id)
        setup.fireAt(monday(14))

        runBlocking { setup.repository.deleteList(home.id) }

        assertNull(setup.shown(bank))
        assertEquals(TaskEntry(), setup.entryOf(bank))
    }

    @Test
    fun aNewTimeRemovesTheNotificationAndCountsFromNow() {
        val pills = savePills()
        setup.fireAt(monday(9))

        setup.setClock(monday(9, 20))
        runBlocking { setup.repository.changeTask(pills.id, TaskEdit(due = DueEdit(Due(MONDAY, PILLS, 9 * 60 + 30), false, true))) }

        assertNull(setup.shown(pills))
        assertEquals(TaskEntry(numberOf(pills), mark = monday(9, 20)), setup.entryOf(pills))
        assertEquals(listOf(setup.millisOf(monday(9, 30))), setup.waiting())
    }

    @Test
    fun aNewTitleOrListAloneLeavesTheNotificationWithTheOldTitle() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))
        val entry = setup.entryOf(bank)

        runBlocking { setup.repository.changeTask(bank.id, TaskEdit(title = "Call the bank about the card")) }

        assertEquals("Call the bank", shownOf(bank).title)
        assertEquals(entry, setup.entryOf(bank))
    }

    @Test
    fun remindMeTurnedOffRemovesTheAlarmTheEntriesAndTheNotification() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))
        setup.press(bank, SNOOZE, monday(14, 2))

        runBlocking { setup.repository.changeTask(bank.id, TaskEdit(due = DueEdit(Due(MONDAY), false, true))) }

        assertEquals(emptyList<Long>(), setup.waiting())
        assertEquals(TaskEntry(), setup.entryOf(bank))
    }

    @Test
    fun aTickOnARepeatingTaskRemovesItsNotificationAndItRemindsOnTheNewDay() {
        val pills = savePills()
        setup.fireAt(monday(9))

        setup.setClock(monday(9, 10))
        runBlocking { setup.repository.tick(pills.id, MONDAY, Repeat.DAILY) }

        assertNull(setup.shown(pills))
        assertEquals(listOf(setup.millisOf(day(1, 9))), setup.waiting())
    }

    @Test
    fun undoOfADeleteCountsFromNow() {
        val bank = saveCallTheBank()
        val undo = runBlocking { checkNotNull(setup.repository.deleteTask(bank.id)) }

        setup.setClock(monday(14, 30))
        runBlocking { setup.repository.undo(undo) }

        assertEquals(TaskEntry(numberOf(bank), mark = monday(14, 30)), setup.entryOf(bank))
        assertEquals("14:00 passed while it was deleted: no late reminder", emptyList<Long>(), setup.waiting())
    }

    @Test
    fun aDoneTaskOpenedAgainCountsFromNow() {
        val bank = saveCallTheBank()
        setup.setClock(monday(9))
        runBlocking { setup.repository.tick(bank.id, MONDAY, Repeat.ONCE) }
        assertEquals(emptyList<Long>(), setup.waiting())

        setup.setClock(monday(10))
        runBlocking { setup.repository.reopen(bank.id) }

        assertEquals(TaskEntry(numberOf(bank), mark = monday(10)), setup.entryOf(bank))
        assertEquals(listOf(setup.millisOf(monday(14))), setup.waiting())
    }

    @Test
    fun aNotificationThatShowedAfterTheEntryWasResetStays() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))

        // The handler showed it after a write reset the entry, and before that write's notification was to go.
        runBlocking { setup.alarms.afterChange(TaskChange(TaskChange.Kind.NEW_TIME, listOf(bank.id))) }

        assertNotNull("a notification whose showing counts stays", setup.shown(bank))
    }

    // The handler.

    @Test
    fun theHandlerStoresShowingBeforeItPostsAndMovesTheMarkOnlyAfter() {
        val bank = saveCallTheBank()
        setup.setClock(monday(14))
        val at = setup.millisOf(monday(14))
        var atThePost: TaskEntry? = null

        setup.alarms.handle(Alarm(AlarmId(bank.id), at)) { atThePost = TaskBook.of(setup.app).storedOf(bank.id) }

        assertEquals(
            "stored as it posts: showing is T, and the mark has not moved, so a stop here shows it again",
            TaskEntry(numberOf(bank), mark = monday(8), showingMillis = at),
            atThePost,
        )
        assertEquals("after the post, the mark is T", TaskEntry(numberOf(bank), mark = monday(14), showingMillis = at), setup.entryOf(bank))
    }

    @Test
    fun anAlarmWhoseTimeIsStillToComeAfterTheClockWasSetBackShowsNothingYet() {
        val bank = saveCallTheBank()
        // core/notify found 14:00 due. Before the handler reads the clock, it is set back to 13:00.
        setup.setClock(monday(13))
        val shown = mutableListOf<ShkNotification>()

        setup.alarms.handle(Alarm(AlarmId(bank.id), setup.millisOf(monday(14)))) { shown += it }

        assertEquals(emptyList<ShkNotification>(), shown)
        assertEquals("nothing is written", TaskEntry(numberOf(bank), mark = monday(8)), setup.entryOf(bank))
    }

    @Test
    fun anAlarmOfADeletedOrDoneTaskShowsNothing() {
        val bank = saveCallTheBank()
        val pills = savePills()
        setup.setClock(monday(14))

        runBlocking {
            setup.repository.deleteTask(bank.id)
            setup.repository.tick(pills.id, MONDAY, Repeat.DAILY)
        }
        setup.alarms.onAlarm(Alarm(AlarmId(bank.id), setup.millisOf(monday(14))), setup.app.notify.notifications)
        setup.alarms.onAlarm(Alarm(AlarmId(pills.id), setup.millisOf(monday(9))), setup.app.notify.notifications)

        assertNull(setup.shown(bank))
        assertNull(setup.shown(pills))
    }

    @Test
    fun aSecondRunForTheSameTimeShowsNothingMore() {
        val bank = saveCallTheBank()
        setup.fireAt(monday(14))
        setup.press(bank, SNOOZE, monday(14, 1))

        setup.alarms.onAlarm(Alarm(AlarmId(bank.id), setup.millisOf(monday(14))), setup.app.notify.notifications)

        assertNull(setup.shown(bank))
    }

    @Test
    fun whenReadingFailsTheMarkMovesAndShowingIsTheTimeThatFailed() {
        val bank = saveCallTheBank()
        val number = numberOf(bank)
        setup.database.close()

        setup.setClock(monday(14))
        assertThrows(Exception::class.java) {
            setup.alarms.onAlarm(Alarm(AlarmId(bank.id), setup.millisOf(monday(14))), setup.app.notify.notifications)
        }

        assertEquals(TaskEntry(number, mark = monday(14), showingMillis = setup.millisOf(monday(14))), setup.entryOf(bank))
    }

    @Test
    fun whenShowingFailsTheNoticeOfCoreNotifyTakesItsPlace() {
        val bank = saveCallTheBank()
        setup.open = Intent().setComponent(ComponentName("org.example.other", "org.example.other.Screen"))
        setup.startTheApp()

        setup.fireAt(monday(14))

        val notice = shownOf(bank)
        assertEquals("Task reminders", notice.title)
        assertEquals(setup.app.getString(NotifyR.string.notify_reminder_failed), notice.text)
        assertEquals(TaskEntry(numberOf(bank), mark = monday(14), showingMillis = setup.millisOf(monday(14))), setup.entryOf(bank))
        setup.startTheApp()
        assertEquals("the notice stays at the next start", setup.app.getString(NotifyR.string.notify_reminder_failed), shownOf(bank).text)
    }
}
