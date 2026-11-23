package app.shkriuss.feature.tasks

import android.database.SQLException
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.core.data.systemSqliteDatabaseBuilder
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.tasks.data.TaskEntity
import app.shkriuss.feature.tasks.data.TaskListEntity
import app.shkriuss.feature.tasks.data.TasksDatabase
import java.time.LocalDate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
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

/**
 * The repository on a real database in memory and a real preferences
 * file: every write is stamped and only marks deletes, every read leaves
 * deleted records out, the phone-only entries follow each write as the
 * spec's tables say (docs/apps/tasks/spec.md, "Reminders of a task" and
 * "Stopped between two writes"), and a write the database refuses changes
 * nothing.
 */
@RunWith(RobolectricTestRunner::class)
class TasksRepositoryTest {
    private val database: TasksDatabase = memoryDatabase()
    private val clock = clockAt(monday(9, 30, 15))
    private val time = TasksTime(clock) { UTC }
    private val book = emptyBook()
    private val changes = mutableListOf<TaskChange>()
    private val repository = TasksRepository(database, clock, TestIdSource(), time, book, work = Dispatchers.Unconfined, onChange = { changes += it })

    @After
    fun closeTheDatabase() = database.close()

    private fun now() = time.reading()

    private fun tasks() = runBlocking { repository.tasks().first() }

    private fun lists() = runBlocking { repository.lists().first() }

    private fun row(id: String): TaskEntity = runBlocking { checkNotNull(database.tasks().find(id)) }

    private fun listRow(id: String): TaskListEntity = runBlocking { checkNotNull(database.lists().find(id)) }

    private fun add(title: String = "Pills", due: Due? = null, listId: String = INBOX): Task =
        runBlocking { checkNotNull(repository.addTask(NewTask(title, listId, due))) }

    private fun addList(name: String = "Home"): TaskList = runBlocking { checkNotNull(repository.addList(name)) }

    private fun tick(task: Task): Tick? = runBlocking { repository.tick(task.id, task.due?.day, task.due?.repeatKind ?: Repeat.ONCE) }

    private fun entryOf(task: Task): TaskEntry = book.entryOf(task.id, runBlocking { repository.findTask(task.id) }?.let(TaskReminders::numberOf))

    /** No two records of the two tables share a change number. */
    private fun changeNumbersAreRight() = runBlocking {
        val numbers = database.lists().all().map { it.changeNumber } + database.tasks().all().map { it.changeNumber }
        assertEquals(numbers.size, numbers.toSet().size)
    }

    // Lists.

    @Test
    fun aListIsStoredWithItsName() {
        val home = addList()

        assertEquals(TaskList(TestIdSource.idNumber(1), "Home", clock.nowMillis), home)
        assertEquals(listOf(home), lists())
        assertEquals(TaskList(home.id, "House", clock.nowMillis), runBlocking { repository.renameList(home.id, "House") })
        assertEquals(2L, listRow(home.id).changeNumber)
        changeNumbersAreRight()
    }

    @Test
    fun newListAddsNoListPast100() = runBlocking {
        repeat(TaskLimits.MOST_LISTS - 1) { repository.addList("List $it") }
        val deleted = checkNotNull(repository.addList("Deleted"))
        repository.deleteList(deleted.id)
        assertNotNull("a deleted list does not count", repository.addList("Number 100"))

        assertNull(repository.addList("Number 101"))
        assertEquals(TaskLimits.MOST_LISTS, lists().size)
    }

    @Test
    fun aNameOutsideItsLimitsIsNeverWritten() {
        assertThrows(IllegalArgumentException::class.java) { runBlocking { repository.addList(" Home") } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { repository.addList("h".repeat(61)) } }
        assertEquals(emptyList<TaskList>(), lists())
    }

    // Adding and changing a task.

    @Test
    fun aTaskIsStoredWithEveryColumnOfTheTable() {
        val home = addList()
        val gym = add("Gym", Due(day(2), GYM, 18 * 60 + 30), home.id)

        val row = row(gym.id)
        assertEquals(home.id, row.listId)
        assertEquals("Gym", row.title)
        assertEquals(20_775, row.dueDay)
        assertEquals(Repeat.WEEKLY.code, row.repeat)
        assertEquals(1 + 4 + 16, row.weekdays)
        assertEquals(20_773, row.repeatFrom)
        assertEquals(18 * 60 + 30, row.remindMinute)
        assertNull(row.doneAt)
        assertEquals(listOf(gym), tasks())
        assertEquals(Task(gym.id, home.id, "Gym", Due(day(2), GYM, 1110), null, clock.nowMillis), gym)
    }

    @Test
    fun aNewTaskWithAReminderCountsFromTheMinuteItIsSaved() {
        val pills = add(due = Due(day(1), PILLS, 540))
        val bank = add("Call the bank")

        assertEquals(TaskEntry.countingFrom(TaskReminders.numberOf(pills)!!, monday(9, 30)), book.storedOf(pills.id))
        assertEquals("no reminder, no entry", TaskEntry(), book.storedOf(bank.id))
        assertEquals(listOf(TaskChange(TaskChange.Kind.ADDED, listOf(pills.id)), TaskChange(TaskChange.Kind.ADDED, listOf(bank.id))), changes)
    }

    @Test
    fun theFormAddsNoTaskPast5000() = runBlocking {
        repeat(TaskLimits.MOST_TASKS - 1) { repository.addTask(NewTask("Task $it", INBOX, null)) }
        val deleted = add("Deleted")
        repository.deleteTask(deleted.id)
        assertNotNull("a deleted task does not count", repository.addTask(NewTask("Number 5000", INBOX, null)))

        assertNull(repository.addTask(NewTask("Number 5001", INBOX, null)))
        assertEquals(TaskLimits.MOST_TASKS, tasks().size)
    }

    @Test
    fun aTaskOutsideItsLimitsIsNeverWritten() {
        listOf(
            NewTask("", INBOX, null),
            NewTask("Gym", "home", null),
            NewTask("Gym", INBOX, Due(day(1), GYM)),
            NewTask("Gym", INBOX, Due(MONDAY, null, 1_440)),
        ).forEach { task -> assertThrows(IllegalArgumentException::class.java) { runBlocking { repository.addTask(task) } } }
        assertEquals(emptyList<Task>(), tasks())
    }

    @Test
    fun aNewTimeCountsFromNowAndANewTitleOrListWritesNoEntries() = runBlocking {
        val pills = add(due = Due(day(1), PILLS, 540))
        book.update(listOf(pills.id)) { _, entry -> entry.copy(snoozeMillis = 5L, showingMillis = 6L) }
        changes.clear()

        repository.changeTask(pills.id, TaskEdit(title = "Vitamins", listId = addList().id))
        assertEquals("a new title or list only: nothing more", 5L, entryOf(pills).snoozeMillis)

        clock.setTo(monday(10, 15))
        val later = repository.changeTask(pills.id, TaskEdit(due = DueEdit(Due(day(1), PILLS, 600), datesChanged = false, reminderChanged = true)))!!
        assertEquals(TaskEntry.countingFrom(TaskReminders.numberOf(later)!!, monday(10, 15)), book.storedOf(pills.id))

        repository.changeTask(pills.id, TaskEdit(due = DueEdit(Due(day(1), PILLS, null), datesChanged = false, reminderChanged = true)))
        assertEquals("Remind me turned off: the entries go", TaskEntry(), book.storedOf(pills.id))
        assertEquals(
            listOf(TaskChange.Kind.NEW_TITLE_OR_LIST, TaskChange.Kind.NEW_TIME, TaskChange.Kind.NEW_TIME),
            changes.map { it.kind },
        )
    }

    @Test
    fun aSaveWithNoChangeWritesNothing() = runBlocking {
        val pills = add(due = Due(day(1), PILLS, 540))
        val before = row(pills.id)
        changes.clear()

        repository.changeTask(pills.id, TaskEdit(title = "Pills", due = DueEdit(Due(day(1), PILLS, 540), datesChanged = true, reminderChanged = true)))

        assertEquals(before, row(pills.id))
        assertEquals(emptyList<TaskChange>(), changes)
    }

    @Test
    fun aNewTimeAloneKeepsTheDueDayThatDoneMovedWhileTheFormWasOpen() = runBlocking {
        val pills = add(due = Due(MONDAY, PILLS, 540))
        // The form opened on Monday's task; Done on the notification moved it to Tuesday.
        tick(pills)

        val saved = repository.changeTask(pills.id, TaskEdit(due = DueEdit(Due(MONDAY, PILLS, 600), datesChanged = false, reminderChanged = true)))!!

        assertEquals(Due(day(1), PILLS, 600), saved.due)
    }

    @Test
    fun aReminderTimeOnADueDateThatARestoreRemovedWritesTheWholeDueDateOfTheForm() = runBlocking {
        val bank = add("Call the bank")
        // The form showed Monday; meanwhile the stored task has no due day. Only the time changed in the form.
        val saved = repository.changeTask(bank.id, TaskEdit(due = DueEdit(Due(MONDAY, null, 600), datesChanged = false, reminderChanged = true)))!!
        assertEquals(Due(MONDAY, null, 600), saved.due)
    }

    @Test
    fun aSaveIntoAListDeletedInThatMomentPutsTheTaskInInbox() = runBlocking {
        // The form opened on Home, and Home was deleted before its Save.
        val home = addList()
        val bank = add("Call the bank")
        repository.deleteList(home.id)

        assertEquals(INBOX, repository.addTask(NewTask("Pay rent", home.id, null))!!.listId)
        assertEquals(INBOX, repository.changeTask(bank.id, TaskEdit(listId = home.id))!!.listId)
        // A list that was never stored too: only a restore, or later sync, makes a task whose list is gone.
        assertEquals(INBOX, repository.addTask(NewTask("Gym", "00000000-0000-4000-8000-0000000000ff", null))!!.listId)
    }

    @Test
    fun aTaskWhoseListIsGoneKeepsItsListIdWhenOnlyItsTitleChanges() = runBlocking {
        val home = addList()
        val bank = add("Call the bank", listId = home.id)
        database.deleteOnlyTheList(home.id, clock)

        assertEquals(home.id, repository.changeTask(bank.id, TaskEdit(title = "Call mum"))!!.listId)
    }

    @Test
    fun aDeletedTaskIsNotChanged() = runBlocking {
        val bank = add("Call the bank")
        repository.deleteTask(bank.id)
        assertNull(repository.changeTask(bank.id, TaskEdit(title = "Call mum")))
        assertEquals("Call the bank", row(bank.id).title)
    }

    // Ticks.

    @Test
    fun aTickMarksATaskDoneAndItsEntriesGo() {
        val bank = add("Call the bank", Due(MONDAY, null, 14 * 60))
        changes.clear()
        clock.setTo(monday(14, 5))

        val tick = tick(bank)!!

        assertNull(tick.next)
        assertEquals(clock.nowMillis, row(bank.id).doneAt)
        assertEquals(TaskEntry(), book.storedOf(bank.id))
        assertEquals(listOf(TaskChange(TaskChange.Kind.DONE, listOf(bank.id))), changes)
        assertNull("a second tick does not count", tick(bank))
    }

    @Test
    fun aTickMovesARepeatingTaskToItsNextDateAfterTodayAndItCountsFromNow() {
        // "Pills", due Mon 16 Nov, done on Thu 19 Nov: Fri 20 Nov. Monday to Thursday are skipped.
        val pills = add(due = Due(MONDAY, PILLS, 540))
        clock.setTo(MONDAY.plusDays(3).atTime(8, 0))

        val tick = tick(pills)!!

        assertEquals(day(4), tick.next)
        assertEquals(Due(day(4), PILLS, 540), tick.task.due)
        assertTrue("it stays open", tick.task.isOpen)
        assertEquals(20_773, row(pills.id).repeatFrom)
        assertEquals(TaskEntry.countingFrom(TaskReminders.numberOf(tick.task)!!, MONDAY.plusDays(3).atTime(8, 0)), book.storedOf(pills.id))
        assertEquals(TaskChange.Kind.MOVED, changes.last().kind)
    }

    @Test
    fun theSpecsExamplesOfTheNextDueDay() {
        // "Rent", due Sat 31 Oct, done that day, and each time on its due day.
        var rent = add("Rent", Due(RENT.from, RENT))
        val dues = mutableListOf<LocalDate>()
        repeat(5) {
            clock.setTo(checkNotNull(rent.due).day.atTime(12, 0))
            rent = tick(rent)!!.task
            dues += checkNotNull(rent.due).day
        }
        assertEquals(listOf("2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31").map(LocalDate::parse), dues)

        // "Gym", due Wed 18 Nov, done early, on Tue 17 Nov: Fri 20 Nov.
        clock.setTo(MONDAY.plusDays(1).atTime(12, 0))
        val gym = add("Gym", Due(day(2), GYM))
        assertEquals(day(4), tick(gym)!!.next)

        // Every year from Tue 29 Feb 2028: Wed 28 Feb 2029.
        clock.setTo(LocalDate.of(2028, 2, 29).atTime(12, 0))
        val leap = repeat(Repeat.YEARLY, LocalDate.of(2028, 2, 29))
        assertEquals(LocalDate.of(2029, 2, 28), tick(add("Birthday", Due(leap.from, leap)))!!.next)
    }

    @Test
    fun aRepeatingTaskWithNoDateLeftUpTo9999IsDoneInstead() {
        val last = add("Last", Due(TaskLimits.LAST_DAY, repeat(Repeat.DAILY, TaskLimits.LAST_DAY)))
        val tick = tick(last)!!
        assertNull(tick.next)
        assertEquals(clock.nowMillis, tick.task.doneAt)
    }

    @Test
    fun aTickCountsOnlyWhileTheTaskIsOpenWithTheDueDayAndRepeatItsRowShowed() = runBlocking {
        val pills = add(due = Due(MONDAY, PILLS))
        tick(pills)!!
        // The second tick carries Monday, the day its row showed: the task moved one date only.
        assertNull(tick(pills))
        assertEquals(day(1), row(pills.id).dueDay?.let { LocalDate.ofEpochDay(it.toLong()) })
        assertNull("another repeat", repository.tick(pills.id, day(1), Repeat.WEEKLY))

        val bank = add("Call the bank")
        repository.deleteTask(bank.id)
        assertNull("a task deleted in that moment", tick(bank))
        assertNull("no such task", repository.tick("00000000-0000-4000-8000-0000000000ff", null, Repeat.ONCE))
    }

    @Test
    fun undoOfATickPutsBackTheDueDayAndTheDoneTimeAndCountsFromNow() = runBlocking {
        val pills = add(due = Due(MONDAY, PILLS, 540))
        val bank = add("Call the bank")
        val moved = tick(pills)!!
        val done = tick(bank)!!
        clock.setTo(monday(9, 45))

        assertEquals(1, repository.undo(moved.undo).size)
        assertEquals(1, repository.undo(done.undo).size)

        assertEquals(Due(MONDAY, PILLS, 540), repository.findTask(pills.id)!!.due)
        assertNull(repository.findTask(bank.id)!!.doneAt)
        assertEquals(TaskEntry.countingFrom(TaskReminders.numberOf(pills)!!, monday(9, 45)), book.storedOf(pills.id))
        changeNumbersAreRight()
    }

    // Opening a done task again.

    @Test
    fun aDoneTaskOpenedAgainCountsFromNowForTheNumberItWillHave() = runBlocking {
        val bank = add("Call the bank", Due(day(1), null, 600))
        tick(bank)
        clock.setTo(monday(11, 0))

        val opened = repository.reopen(bank.id)!!

        assertTrue(opened.isOpen)
        assertEquals(TaskEntry.countingFrom(TaskReminders.numberOf(opened)!!, monday(11, 0)), book.storedOf(bank.id))
        assertEquals(TaskChange.Kind.OPENED_AGAIN, changes.last().kind)
        assertNull("a cleared tick twice opens it once", repository.reopen(bank.id))
    }

    @Test
    fun aClearedTickTwiceKeepsTheMarkOfThePressThatCounted() {
        // A database in a file, so that a read can run while a write is open, as in the app.
        context.deleteDatabase(FILE_DATABASE)
        val fileDatabase = systemSqliteDatabaseBuilder<TasksDatabase>(context, FILE_DATABASE).build()
        val inWrite = CompletableDeferred<Unit>()
        val mayCommit = CompletableDeferred<Unit>()
        // The first reopen's write waits, inside its transaction, until the test lets it commit.
        val holdingClock = object : Clock {
            @Volatile var hold = false

            override fun nowMillis(): Long {
                if (hold) {
                    hold = false
                    inWrite.complete(Unit)
                    runBlocking { mayCommit.await() }
                }
                return clock.nowMillis
            }
        }
        val fileRepository = TasksRepository(fileDatabase, holdingClock, TestIdSource(), time, book, work = Dispatchers.Unconfined)
        try {
            runBlocking {
                val bank = checkNotNull(fileRepository.addTask(NewTask("Call the bank", INBOX, Due(MONDAY, null, 10 * 60))))
                checkNotNull(fileRepository.tick(bank.id, MONDAY, Repeat.ONCE))
                holdingClock.hold = true

                val first = async(Dispatchers.IO) { fileRepository.reopen(bank.id, readingAt(monday(9, 59, 50))) }
                inWrite.await()
                // The second press, a minute later, comes while the first is writing.
                val second = async(Dispatchers.IO) { fileRepository.reopen(bank.id, readingAt(monday(10, 0, 5))) }
                delay(300)
                mayCommit.complete(Unit)

                assertNotNull(first.await())
                assertNull(second.await())
                assertEquals("the mark of the press that counted", monday(9, 59), book.entryOf(bank.id, TaskReminders.numberOf(bank)).mark)
            }
        } finally {
            mayCommit.complete(Unit)
            fileDatabase.close()
            context.deleteDatabase(FILE_DATABASE)
        }
    }

    @Test
    fun aClearedTickThatComesWhileATickFinishesKeepsItsMark() {
        val work = HoldingDispatcher()
        val held = TasksRepository(database, clock, TestIdSource(), time, book, work = work)
        val bank = runBlocking { checkNotNull(held.addTask(NewTask("Call the bank", INBOX, Due(MONDAY, null, 10 * 60)))) }

        // The tick's next turn on the lock waits. Another screen clears the tick meanwhile.
        work.holdNext = true
        val tick = thread { runBlocking { held.tick(bank.id, MONDAY, Repeat.ONCE, readingAt(monday(9, 40))) } }
        work.holding.await(5, TimeUnit.SECONDS)
        runBlocking { held.reopen(bank.id, readingAt(monday(9, 41))) }
        work.release.countDown()
        tick.join(5_000)

        // Either the reopen came first and found the task open, or it came after the tick and counts from its press.
        val task = checkNotNull(runBlocking { held.findTask(bank.id) })
        val entry = book.entryOf(task.id, TaskReminders.numberOf(task))
        if (task.isOpen) assertEquals(monday(9, 41), entry.mark) else assertEquals(TaskEntry(), book.storedOf(bank.id))
    }

    @Test
    fun theEntriesOfAnOpeningAgainThatTheDatabaseRefusedCountForNothing() = runBlocking {
        val bank = add("Call the bank", Due(day(1), null, 600))
        tick(bank)
        database.refuseWritesTo(TaskEntity.TABLE)

        assertThrows(SQLException::class.java) { runBlocking { repository.reopen(bank.id) } }

        assertEquals("the task stays done", clock.nowMillis, row(bank.id).doneAt)
        // The entries were written first, for the number the task would have. A done task has none, so they count for nothing.
        assertEquals(TaskReminders.numberOf(Due(day(1), null, 600)), book.storedOf(bank.id).number)
        assertEquals(TaskEntry(), entryOf(bank))
    }

    // Deletes and Undo.

    @Test
    fun aDeleteOnlyMarksTheTaskAndItsEntriesGo() = runBlocking {
        val pills = add(due = Due(day(1), PILLS, 540))

        val undo = repository.deleteTask(pills.id)!!

        assertNotNull(row(pills.id).record.deletedAt)
        assertEquals("Pills", row(pills.id).title)
        assertEquals(emptyList<Task>(), tasks())
        assertEquals(TaskEntry(), book.storedOf(pills.id))
        assertNull("deleted twice", repository.deleteTask(pills.id))

        clock.setTo(monday(9, 50))
        assertEquals(listOf(pills.id), repository.undo(undo).map { it.id })
        assertEquals(TaskEntry.countingFrom(TaskReminders.numberOf(pills)!!, monday(9, 50)), book.storedOf(pills.id))
    }

    @Test
    fun deletingAListDeletesItsTasksOpenAndDoneAndUndoBringsAllBack() = runBlocking {
        val home = addList()
        val work = addList("Work")
        val dishes = add("Dishes", listId = home.id)
        val bins = add("Bins", listId = home.id)
        tick(bins)
        val report = add("Report", listId = work.id)

        val undo = repository.deleteList(home.id)!!

        assertEquals(listOf(work), lists())
        assertEquals(listOf(report.id), tasks().map { it.id })
        assertEquals(2, undo.taskCount)
        assertEquals(TaskChange.Kind.DELETED, changes.last().kind)
        assertEquals(setOf(dishes.id, bins.id), changes.last().ids.toSet())

        repository.undo(undo)

        assertEquals(setOf(home, work), lists().toSet())
        assertEquals(setOf(dishes.id, bins.id, report.id), tasks().map { it.id }.toSet())
        assertNotNull("the done task comes back done", repository.findTask(bins.id)!!.doneAt)
        changeNumbersAreRight()
    }

    @Test
    fun deleteDoneTasksDeletesThoseThatAreStillDone() = runBlocking {
        val dishes = add("Dishes")
        val bins = add("Bins")
        val open = add("Open")
        tick(dishes)
        tick(bins)
        repository.reopen(bins.id)

        val undo = repository.deleteDone(listOf(dishes.id, bins.id, open.id))!!

        assertEquals(1, undo.taskCount)
        assertEquals(setOf(bins.id, open.id), tasks().map { it.id }.toSet())
        assertNull("none is done", repository.deleteDone(listOf(open.id)))
    }

    @Test
    fun undoActsOnlyOnRecordsThatDidNotChangeSince() = runBlocking {
        val home = addList()
        val dishes = add("Dishes", listId = home.id)
        val bins = add("Bins", listId = home.id)
        val undo = repository.deleteList(home.id)!!
        // Before Undo, a restore brings Bins back, and an edit changes it.
        RecordWriter(database, database.tasks(), clock, TestIdSource()).restore(bins.id)
        repository.changeTask(bins.id, TaskEdit(title = "Bins out"))

        val back = repository.undo(undo)

        assertEquals("only the task that did not change since", listOf(dishes.id), back.map { it.id })
        assertEquals("Bins out", row(bins.id).title)
        assertEquals("the list did not change since, and comes back", listOf(home), lists())
        // A tick undone twice acts once.
        val tick = tick(repository.findTask(dishes.id)!!)!!
        assertEquals(1, repository.undo(tick.undo).size)
        assertEquals(0, repository.undo(tick.undo).size)
    }

    @Test
    fun aWriteTheDatabaseRefusesChangesNothing() = runBlocking {
        val home = addList()
        val pills = add(due = Due(MONDAY, PILLS, 540), listId = home.id)
        val tasksBefore = tasks()
        val entriesBefore = book.entries.value
        changes.clear()
        database.refuseWritesTo(TaskEntity.TABLE)

        listOf<suspend () -> Any?>(
            { repository.addTask(NewTask("Gym", INBOX, null)) },
            { repository.changeTask(pills.id, TaskEdit(title = "Vitamins")) },
            { repository.tick(pills.id, MONDAY, Repeat.DAILY) },
            { repository.deleteTask(pills.id) },
            { repository.deleteList(home.id) },
        ).forEach { write -> assertThrows(SQLException::class.java) { runBlocking { write() } } }

        assertEquals(tasksBefore, tasks())
        assertEquals(listOf(home), lists())
        assertEquals(entriesBefore, book.entries.value)
        assertEquals(emptyList<TaskChange>(), changes)

        database.acceptWritesTo(TaskEntity.TABLE)
        database.refuseWritesTo(TaskListEntity.TABLE)
        assertThrows(SQLException::class.java) { runBlocking { repository.addList("Work") } }
        assertThrows(SQLException::class.java) { runBlocking { repository.renameList(home.id, "House") } }
        assertEquals(listOf(home), lists())
    }

    private companion object {
        /** The file of the database of the test that needs two connections. */
        const val FILE_DATABASE = "tasks-test.db"
    }
}

/**
 * Runs work at once on the thread that asks, except the next piece after
 * [holdNext] is set: that one waits on a thread of its own until
 * [release], and [holding] tells the test it is waiting.
 */
private class HoldingDispatcher : CoroutineDispatcher() {
    /** When true, the next piece of work waits. */
    @Volatile var holdNext = false

    /** Counts down when a piece of work is waiting. */
    val holding = CountDownLatch(1)

    /** Lets the waiting piece of work run. */
    val release = CountDownLatch(1)

    override fun dispatch(context: CoroutineContext, block: Runnable) {
        if (holdNext) {
            holdNext = false
            holding.countDown()
            thread { release.await(); block.run() }
        } else {
            block.run()
        }
    }
}
