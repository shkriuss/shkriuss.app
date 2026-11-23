package app.shkriuss.feature.tasks

import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.tasks.data.TaskEntity
import app.shkriuss.feature.tasks.data.TaskListEntity
import app.shkriuss.feature.tasks.data.TasksDatabase
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The ViewModels of Today, Lists, an open list, the name dialog and the
 * task form, on a real database in memory and a real preferences file,
 * at 09:30 on Monday 16 November 2026, in UTC. Their work runs at once on
 * the thread that starts it, and each test waits for the state it
 * expects: Room's reads come a moment later.
 */
@RunWith(RobolectricTestRunner::class)
class ViewModelsTest {
    private val database: TasksDatabase = memoryDatabase()
    private val clock = clockAt(monday(9, 30, 15))
    private val time = TasksTime(clock) { UTC }
    private val book = emptyBook()
    private val ids = TestIdSource()
    private val saved = mutableListOf<Task>()
    private val repository = TasksRepository(database, clock, ids, time, book, work = Dispatchers.Unconfined)

    private val waitEnds = Channel<Unit>(Channel.UNLIMITED)
    private val sourceScope = CoroutineScope(Dispatchers.Unconfined)

    /** The one clock of the screens, as `TasksServices` builds it, with a wait that the test ends. */
    private val now = TasksNow(time, sourceScope) { waitEnds.receive() }

    @After
    fun closeTheDatabase() {
        sourceScope.cancel()
        database.close()
    }

    private fun today() = TodayViewModel(repository, time, now, Dispatchers.Unconfined)

    /** The phone's language, for the order of the lists. */
    private var language: Locale = Locale.ENGLISH

    private fun lists() = ListsViewModel(repository, now, Dispatchers.Unconfined) { language }

    private fun names() = ListNameViewModel(repository, Dispatchers.Unconfined)

    private fun list() = ListViewModel(repository, time, now, Dispatchers.Unconfined)

    private fun form() = TaskFormViewModel(repository, time, now, Dispatchers.Unconfined) { saved += it }

    private fun add(title: String, due: Due? = null, listId: String = INBOX): Task =
        runBlocking { checkNotNull(repository.addTask(NewTask(title, listId, due))) }

    private fun addList(name: String): TaskList = runBlocking { checkNotNull(repository.addList(name)) }

    private fun find(id: String): Task? = runBlocking { repository.findTask(id) }

    /** Waits until the tasks that are not deleted are as [condition] says. A write starts and returns at once, so a test waits for it. */
    private fun tasksBecome(condition: (List<Task>) -> Boolean): List<Task> = runBlocking {
        withTimeout(5_000) { repository.tasks().first(condition) }
    }

    /** Moves the clock to [local] and lets the clock of the screens read it, as at a whole minute. */
    private fun clockTo(local: LocalDateTime) {
        clock.setTo(local)
        now.check()
    }

    private fun TaskFormViewModel.openForm(condition: (TaskForm) -> Boolean = { true }): TaskForm =
        state.await { screen -> screen.form?.let(condition) == true }.form!!

    // Today.

    @Test
    fun todayStartsEmpty() {
        val screen = today().state.await { it.loaded }
        assertTrue(screen.isEmpty)
        assertEquals(MONDAY, screen.today)
    }

    @Test
    fun todayShowsOverdueAndTodayWithTheNamesOfTheirLists() {
        val home = addList("Home")
        val late = add("Late", Due(day(-1)), home.id)
        val pills = add("Pills", Due(MONDAY, PILLS, 540))
        add("Tomorrow", Due(day(1)))
        add("Someday")

        val screen = today().state.await { it.loaded && it.dueToday.isNotEmpty() }

        assertEquals(listOf(TaskRow(late, "Home")), screen.overdue)
        assertEquals(listOf(TaskRow(pills, null)), screen.dueToday)
    }

    @Test
    fun fromMidnightATaskDueTodayIsOverdue() {
        val bank = add("Call the bank", Due(MONDAY))
        val model = today()
        model.state.await { it.dueToday.size == 1 }

        clockTo(day(1).atTime(0, 0, 5))

        val screen = model.state.await { it.overdue.size == 1 }
        assertEquals(listOf(bank.id), screen.overdue.map { it.task.id })
        assertEquals(day(1), screen.today)
    }

    @Test
    fun aTickShowsTaskDoneAndUndoBringsTheTaskBack() {
        val bank = add("Call the bank", Due(MONDAY))
        val model = today()
        val row = model.state.await { it.dueToday.size == 1 }.dueToday.single()

        model.tick(row)

        val done = model.state.await { it.snackbar != null && it.dueToday.isEmpty() }
        assertTrue(done.snackbar is TasksSnackbar.Done)
        model.undo()
        model.state.await { it.snackbar == null && it.dueToday.size == 1 }
        assertNull(find(bank.id)!!.doneAt)
    }

    @Test
    fun aTickOnARepeatingTaskShowsItsNextDate() {
        add("Pills", Due(MONDAY, PILLS, 540))
        val model = today()
        val row = model.state.await { it.dueToday.size == 1 }.dueToday.single()

        model.tick(row)

        val snackbar = model.state.await { it.snackbar != null }.snackbar
        assertEquals(day(1), (snackbar as TasksSnackbar.Next).date)
    }

    @Test
    fun aTickTwiceBeforeTheRowShowsTheChangeMovesOneDate() {
        val pills = add("Pills", Due(MONDAY, PILLS))
        val model = today()
        val row = model.state.await { it.dueToday.size == 1 }.dueToday.single()

        model.tick(row)
        model.tick(row)

        tasksBecome { tasks -> tasks.single().due?.day == day(1) }
        assertEquals(day(1), find(pills.id)!!.due!!.day)
    }

    @Test
    fun aTickTheDatabaseRefusesChangesNothingAndSaysSo() {
        val bank = add("Call the bank", Due(MONDAY))
        val model = today()
        val row = model.state.await { it.dueToday.size == 1 }.dueToday.single()
        database.refuseWritesTo(TaskEntity.TABLE)

        model.tick(row)

        assertEquals(TasksSnackbar.CouldNotChange, model.state.await { it.snackbar != null }.snackbar)
        assertTrue(find(bank.id)!!.isOpen)
        assertEquals(1, model.state.value.dueToday.size)
    }

    @Test
    fun aScreenThatCannotReadTheDatabaseSaysSo() {
        database.refuseReadsOf(TaskEntity.TABLE)

        assertTrue(today().state.await { it.loaded }.failed)
        assertTrue(lists().state.await { it.loaded }.failed)
        assertTrue(list().state.await { it.loaded }.failed)
        assertFalse("no task, but not empty either: an error", today().state.await { it.loaded }.isEmpty)
    }

    // Lists.

    @Test
    fun listsAreInboxFirstThenByNameWithTheirOpenCounts() {
        val work = addList("work")
        val home = addList("Home")
        add("Dishes", listId = home.id)
        add("Bins", listId = home.id)
        add("Call the bank")

        val rows = lists().state.await { it.loaded && it.rows.size == 3 && it.rows[1].openCount == 2 }.rows

        assertEquals(listOf(null, home, work), rows.map { it.list })
        assertEquals(listOf(1, 2, 0), rows.map { it.openCount })
    }

    @Test
    fun listsFollowANewLanguageOfThePhoneWhenTheScreenStartsAgain() {
        addList("Zebra")
        addList("Äpfel")
        val model = lists()
        // In English, Ä sorts as A.
        assertEquals(listOf(null, "Äpfel", "Zebra"), model.state.await { it.rows.size == 3 }.rows.map { it.list?.name })

        // In Swedish, Ä comes after Z. The screen starts again after the change, and reads the clock.
        language = Locale.forLanguageTag("sv")
        clockTo(monday(9, 31))

        val rows = model.state.await { it.rows.getOrNull(1)?.list?.name == "Zebra" }.rows
        assertEquals(listOf(null, "Zebra", "Äpfel"), rows.map { it.list?.name })
    }

    // The name dialog.

    @Test
    fun newListSavesAListAndCloses() {
        val model = names()
        model.openNew()
        model.onNameChange("  Home\n")
        model.save()

        model.state.await { it == null }
        assertEquals(listOf("Home"), runBlocking { repository.lists().first() }.map { it.name })
    }

    @Test
    fun aWrongNameShowsItsWordsAndSavesNothing() {
        val model = names()
        model.openNew()
        model.save()
        assertEquals(NameProblem.EMPTY, model.state.value!!.problem)

        model.onNameChange("h".repeat(61))
        assertEquals(NameProblem.TOO_LONG, model.state.value!!.problem)
        model.onNameChange("h".repeat(60))
        assertNull(model.state.value!!.problem)
    }

    @Test
    fun newListAddsNoListWhile100AreKept() {
        runBlocking { repeat(TaskLimits.MOST_LISTS) { repository.addList("List $it") } }
        val model = names()
        model.openNew()
        model.onNameChange("Number 101")
        model.save()

        assertEquals(NameProblem.TOO_MANY_LISTS, model.state.await { it?.problem != null }!!.problem)
        assertEquals("Number 101", model.state.value!!.name)
    }

    @Test
    fun aNameTheDatabaseRefusesKeepsTheDialogOpenWithTheName() {
        val home = addList("Home")
        database.refuseWritesTo(TaskListEntity.TABLE)
        val model = names()
        model.openRename(home)
        model.onNameChange("House")
        model.save()

        val dialog = model.state.await { it?.problem != null }!!
        assertEquals(NameProblem.COULD_NOT_SAVE, dialog.problem)
        assertEquals("House", dialog.name)
        assertFalse(dialog.saving)
    }

    @Test
    fun aRenameWithNoChangeClosesAndWritesNothing() {
        val home = addList("Home")
        val model = names()
        model.openRename(home)
        model.save()

        assertNull(model.state.value)
        assertEquals(1L, runBlocking { database.lists().find(home.id)!!.changeNumber })
    }

    // One list.

    @Test
    fun aListShowsItsOpenTasksAndItsDoneTasks() {
        val home = addList("Home")
        val dishes = add("Dishes", listId = home.id)
        val bins = add("Bins", listId = home.id)
        runBlocking { repository.tick(bins.id, null, Repeat.ONCE) }
        val model = list()

        model.open(home.id)

        val screen = model.state.await { it.loaded && it.done.size == 1 && it.open.size == 1 }
        assertEquals(home, screen.list)
        assertEquals(listOf(dishes.id), screen.open.map { it.task.id })
        assertEquals(listOf(bins.id), screen.done.map { it.task.id })
        assertTrue(screen.canRenameAndDelete)
        assertTrue(screen.canDeleteDone)
    }

    @Test
    fun aDoneTaskInAListIsDoneOnTheDayOfThePhonesTimeZone() {
        val home = addList("Home")
        val bins = add("Bins", listId = home.id)
        clock.setTo(monday(22, 0))
        runBlocking { repository.tick(bins.id, null, Repeat.ONCE) }
        var zone: ZoneId = UTC
        val zoned = TasksTime(clock) { zone }
        val zonedNow = TasksNow(zoned, sourceScope) { waitEnds.receive() }
        val model = ListViewModel(repository, zoned, zonedNow, Dispatchers.Unconfined)
        model.open(home.id)

        val inUtc = model.state.await { it.done.size == 1 }
        assertEquals(MONDAY, inUtc.doneOn(inUtc.done.single()))
        assertNull(inUtc.doneOn(TaskRow(bins, "Home")))
        // 22:00 in UTC is 02:00 on Tuesday in Tbilisi.
        zone = TBILISI
        zonedNow.check()
        val inTbilisi = model.state.await { it.zone == TBILISI }
        assertEquals(day(1), inTbilisi.doneOn(inTbilisi.done.single()))
    }

    @Test
    fun inboxCannotBeRenamedOrDeleted() {
        add("Call the bank")
        val model = list()
        model.open(INBOX)

        val screen = model.state.await { it.loaded && it.open.size == 1 }
        assertTrue(screen.isInbox)
        assertFalse(screen.canRenameAndDelete)
        model.askDeleteList()
        assertNull(model.state.value.question)
    }

    @Test
    fun aClearedTickOpensTheTaskAgainWithNoSnackbar() {
        val bins = add("Bins")
        runBlocking { repository.tick(bins.id, null, Repeat.ONCE) }
        val model = list()
        model.open(INBOX)
        val row = model.state.await { it.done.size == 1 }.done.single()

        model.reopen(row)

        val screen = model.state.await { it.open.size == 1 }
        assertNull(screen.snackbar)
    }

    @Test
    fun deleteListAsksWithItsCountClosesTheListAndUndoBringsItBack() {
        val home = addList("Home")
        add("Dishes", listId = home.id)
        add("Bins", listId = home.id)
        val model = list()
        model.open(home.id)
        model.state.await { it.open.size == 2 }

        model.askDeleteList()
        assertEquals(ListQuestion.DeleteList(home, 2), model.state.await { it.question != null }.question)
        model.confirmDelete()

        val closed = model.state.await { it.snackbar != null }
        assertNull(closed.listId)
        assertTrue(closed.snackbar is TasksSnackbar.ListDeleted)
        assertEquals(emptyList<Task>(), tasksBecome { it.isEmpty() })

        model.undo()
        assertEquals(2, tasksBecome { it.size == 2 }.size)
        assertNull("the list stays closed", model.state.value.listId)
    }

    @Test
    fun deleteDoneTasksAsksWithItsCountAndUndoBringsThemBack() {
        val dishes = add("Dishes")
        val bins = add("Bins")
        add("Open")
        runBlocking {
            repository.tick(dishes.id, null, Repeat.ONCE)
            repository.tick(bins.id, null, Repeat.ONCE)
        }
        val model = list()
        model.open(INBOX)
        model.state.await { it.done.size == 2 }

        model.askDeleteDone()
        assertEquals(2, (model.state.await { it.question != null }.question as ListQuestion.DeleteDone).count)
        model.confirmDelete()
        // A second press of Delete does nothing: the question closed at the first.
        model.confirmDelete()

        val snackbar = model.state.await { it.snackbar != null }.snackbar as TasksSnackbar.DoneTasksDeleted
        assertEquals(2, snackbar.count)
        assertEquals(1, tasksBecome { it.size == 1 }.size)
        model.undo()
        assertEquals(3, tasksBecome { it.size == 3 }.size)
    }

    @Test
    fun aListDeletedElsewhereClosesWithItsQuestionAndStaysClosedWhenItComesBack() {
        val home = addList("Home")
        val model = list()
        model.open(home.id)
        model.state.await { it.listId == home.id && it.list != null }
        model.askDeleteList()
        model.state.await { it.question != null }

        val undo = runBlocking { checkNotNull(repository.deleteList(home.id)) }
        model.state.await { it.listId == null }
        // Undo on another screen brings the list back: this screen stays on Lists, with no question.
        runBlocking { repository.undo(undo) }
        runBlocking { withTimeout(5_000) { repository.lists().first { it.isNotEmpty() } } }

        // The screen's own read of the lists comes a moment later. For a second, it must stay closed.
        val until = System.nanoTime() + 1_000_000_000L
        while (System.nanoTime() < until) {
            val screen = model.state.value
            assertNull(screen.listId)
            assertNull(screen.question)
            Thread.sleep(20)
        }
    }

    // The task form.

    @Test
    fun aNewTaskFromTodayIsDueTodayInInboxAndFromAListHasNoDueDay() {
        val home = addList("Home")
        val model = form()

        model.openNewDueToday()
        val fromToday = model.openForm()
        assertEquals(MONDAY, fromToday.date)
        assertEquals(INBOX, fromToday.listId)
        assertFalse(fromToday.remind)

        model.openNewIn(home.id)
        val fromList = model.openForm { it.listId == home.id }
        assertNull(fromList.date)
        assertEquals(home, model.state.await { it.list != null }.list)
    }

    @Test
    fun remindMeStartsAt0900OrAtTheNextFullHourToday() {
        val model = form()
        model.openNewDueToday()
        model.onRemindChange(true)
        assertEquals("09:00 has passed at 09:30: the next full hour", 10 * 60, model.openForm { it.remind }.remindMinute)

        model.onDateChange(day(1))
        model.onRemindChange(false)
        model.onRemindChange(true)
        model.openForm { it.date == day(1) && it.remindMinute == 9 * 60 }
    }

    @Test
    fun removeAlsoRemovesTheRepeatAndTheReminder() {
        val model = form()
        model.openNewDueToday()
        model.onRepeatChange(Repeat.WEEKLY)
        assertEquals("the day of the date", Weekdays.of(DayOfWeek.MONDAY), model.openForm { it.repeat == Repeat.WEEKLY }.weekdays)
        model.onRemindChange(true)
        model.openForm { it.remind }

        model.removeDate()

        val open = model.openForm { it.date == null }
        assertEquals(Repeat.ONCE, open.repeat)
        assertFalse(open.remind)
        // Without a due date there is no repeat or reminder to choose.
        model.onRepeatChange(Repeat.DAILY)
        model.onRemindChange(true)
        model.onTitleChange("Last change")
        val after = model.openForm { it.title == "Last change" }
        assertEquals(Repeat.ONCE, after.repeat)
        assertFalse(after.remind)
    }

    @Test
    fun aRepeatShowsItsFirstThreeDates() {
        val model = form()
        model.openNewDueToday()
        model.onRepeatChange(Repeat.WEEKLY)
        model.onDayChange(DayOfWeek.WEDNESDAY, true)
        model.onDayChange(DayOfWeek.FRIDAY, true)

        assertEquals(listOf(MONDAY, day(2), day(4)), model.state.await { it.dates.size == 3 }.dates)
    }

    @Test
    fun saveAddsTheTaskShowsTaskAddedAndCloses() {
        val model = form()
        model.openNewDueToday()
        model.onTitleChange("  Call the bank ")
        model.onRemindChange(true)
        model.onTimeChange(LocalTime.of(14, 0))

        model.save()

        val screen = model.state.await { it.form == null && it.snackbar != null }
        assertEquals(TasksSnackbar.TaskAdded, screen.snackbar)
        val task = tasksBecome { it.size == 1 }.single()
        assertEquals("Call the bank", task.title)
        assertEquals(Due(MONDAY, null, 14 * 60), task.due)
        assertEquals(listOf(task), saved)
    }

    @Test
    fun aWrongFieldShowsItsWordsAndSaveWritesNothing() {
        val model = form()
        model.openNewDueToday()
        model.onRepeatChange(Repeat.WEEKLY)
        model.onDayChange(DayOfWeek.MONDAY, false)
        model.save()

        val checked = model.openForm { it.titleError != null }
        assertEquals(TextProblem.EMPTY, checked.titleError)
        assertTrue(checked.daysError)
        model.onTitleChange("x".repeat(201))
        model.openForm { it.titleError == TextProblem.TOO_LONG }
        assertEquals(emptyList<Task>(), runBlocking { repository.tasks().first() })
    }

    @Test
    fun aReminderMomentThatHasPassedIsRefusedByThePickerAndAtSave() {
        val model = form()
        model.openNewDueToday()
        model.onTitleChange("Call the bank")
        model.onRemindChange(true)
        assertTrue(model.timeHasPassed(LocalTime.of(9, 30)))
        assertFalse(model.timeHasPassed(LocalTime.of(9, 31)))

        // The form stayed open past 10:00.
        clock.setTo(monday(10, 0, 5))
        model.save()

        assertTrue(model.openForm { it.timeError }.timeError)
    }

    @Test
    fun aChangeOfTheTitleOrTheListAloneKeepsAReminderThatPassed() {
        val bank = add("Call the bank", Due(MONDAY, null, 9 * 60))
        val home = addList("Home")
        val model = form()
        model.openEdit(bank)
        model.onTitleChange("Call the bank again")
        model.onListChange(home.id)

        model.save()

        model.state.await { it.form == null }
        val stored = tasksBecome { it.single().title == "Call the bank again" }.single()
        assertEquals(home.id, stored.listId)
        assertEquals(Due(MONDAY, null, 9 * 60), stored.due)
        assertNull("an edit shows no snackbar", model.state.value.snackbar)
    }

    @Test
    fun aSaveWithNoChangeClosesAndWritesNothing() {
        val bank = add("Call the bank", Due(MONDAY, null, 9 * 60))
        val model = form()
        model.openEdit(bank)
        model.openForm()
        model.save()

        model.state.await { it.form == null }
        assertEquals(1L, runBlocking { database.tasks().find(bank.id)!!.changeNumber })
        assertEquals(emptyList<Task>(), saved)
    }

    @Test
    fun theFormOfATaskInAListThatIsGoneShowsInboxAndKeepsItsListIdOnSave() {
        val home = addList("Home")
        val bank = add("Call the bank", listId = home.id)
        database.deleteOnlyTheList(home.id, clock)
        val model = form()
        model.openEdit(bank)

        assertNull(model.state.await { it.form != null && it.lists.isEmpty() }.list)
        model.onTitleChange("Call mum")
        model.save()

        assertEquals(home.id, tasksBecome { it.single().title == "Call mum" }.single().listId)
    }

    @Test
    fun aNewTaskWhile5000AreKeptIsRefused() {
        runBlocking { repeat(TaskLimits.MOST_TASKS) { repository.addTask(NewTask("Task $it", INBOX, null)) } }
        val model = form()
        model.openNewIn(INBOX)
        model.onTitleChange("One more")
        model.save()

        assertTrue(model.openForm { it.limitError }.limitError)
    }

    @Test
    fun aSaveTheDatabaseRefusesKeepsTheFormOpenWithWhatWasTyped() {
        database.refuseWritesTo(TaskEntity.TABLE)
        val model = form()
        model.openNewIn(INBOX)
        model.onTitleChange("Call the bank")
        model.save()

        // The form is a sheet over the bottom of the screen, so it says so itself, not in a snackbar.
        val screen = model.state.await { it.form?.saveFailed == true }
        assertNull(screen.snackbar)
        assertEquals("Call the bank", screen.form!!.title)
        assertFalse(screen.form.saving)
        assertTrue(tasksBecome { it.isEmpty() }.isEmpty())

        // The next Save tries again, and the words go.
        database.acceptWritesTo(TaskEntity.TABLE)
        model.save()
        assertEquals("Call the bank", tasksBecome { it.isNotEmpty() }.single().title)
        assertEquals(TasksSnackbar.TaskAdded, model.state.await { it.form == null }.snackbar)
    }

    @Test
    fun saveTakesOnePressAtATime() {
        val held = CountDownLatch(1)
        val slow = TasksRepository(database, clock, { held.await(); ids.newId() }, time, book, work = Dispatchers.Unconfined)
        val model = TaskFormViewModel(slow, time, now, Dispatchers.IO)
        model.openNewIn(INBOX)
        model.onTitleChange("Call the bank")
        // The form has read the lists before the write holds the database.
        model.openForm { it.title == "Call the bank" }

        try {
            model.save()
            model.openForm { it.saving }
            model.save()
            model.cancel()
            assertTrue("the form stays while it writes", model.state.value.form!!.saving)
        } finally {
            held.countDown()
        }

        model.state.await { it.form == null }
        assertEquals(1, tasksBecome { it.isNotEmpty() }.size)
    }

    @Test
    fun deleteClosesTheFormAndUndoBringsTheTaskBack() {
        val bank = add("Call the bank")
        val model = form()
        model.openEdit(bank)

        model.openForm()
        model.delete()
        model.delete()

        val deleted = model.state.await { it.snackbar != null }
        assertTrue(deleted.snackbar is TasksSnackbar.TaskDeleted)
        assertNull(deleted.form)
        tasksBecome { it.isEmpty() }
        model.undo()
        assertEquals(listOf(bank.id), tasksBecome { it.isNotEmpty() }.map { it.id })
    }

    @Test
    fun aFormOpenOnATaskDeletedElsewhereCloses() {
        val bank = add("Call the bank")
        val model = form()
        model.openEdit(bank)
        model.openForm()

        runBlocking { repository.deleteTask(bank.id) }

        model.state.await { it.form == null }
    }

    @Test
    fun aFormThatCannotReadTheListsSaysSoAndStillTakesWhatIsTyped() {
        database.refuseReadsOf(TaskListEntity.TABLE)
        val model = form()
        model.openNewIn(INBOX)

        assertTrue(model.state.await { it.form != null }.failed)
        model.onTitleChange("Call the bank")
        assertEquals("Call the bank", model.openForm { it.title.isNotEmpty() }.title)
        model.cancel()
        model.state.await { it.form == null }
    }

    @Test
    fun aFormWhoseWatchForADeletedTaskCannotReadTheTasksFailsNothing() {
        // An error that reaches no handler would stop the app.
        val uncaught = CopyOnWriteArrayList<Throwable>()
        val before = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { _, error -> uncaught += error }
        try {
            database.refuseReadsOf(TaskEntity.TABLE)
            val model = form()
            model.openNewIn(INBOX)
            model.onTitleChange("Call mum")
            assertEquals("Call mum", model.openForm { it.title == "Call mum" }.title)

            // The watch reads the tasks a moment later, on another thread. For a second, nothing may fail.
            val until = System.nanoTime() + 1_000_000_000L
            while (System.nanoTime() < until && uncaught.isEmpty()) Thread.sleep(20)
            assertEquals(emptyList<Throwable>(), uncaught.toList())
            assertEquals("Call mum", model.state.value.form?.title)
        } finally {
            Thread.setDefaultUncaughtExceptionHandler(before)
        }
    }

    @Test
    fun aDoneTaskSaysWhenItWasDone() {
        val bank = add("Call the bank")
        clock.setTo(monday(14, 5))
        val done = runBlocking { repository.tick(bank.id, null, Repeat.ONCE)!!.task }
        val model = form()
        model.openEdit(done)

        assertEquals(MONDAY, model.state.await { it.doneOn != null }.doneOn)
    }

    @Test
    fun aPickedDateIsFromTodayTo2100() {
        val model = form()
        model.openNewIn(INBOX)
        model.onDateChange(LocalDate.of(2001, 1, 1))
        assertEquals(MONDAY, model.openForm { it.date != null }.date)
        model.onDateChange(LocalDate.of(2200, 1, 1))
        model.openForm { it.date == LocalDate.of(2100, 12, 31) }
    }
}
