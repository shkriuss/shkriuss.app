package app.shkriuss.feature.tasks

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Which tasks each screen shows, and in which order
 * (docs/apps/tasks/spec.md, "Today", "Lists" and "A list"), and that a
 * task of a list that is deleted or not stored shows in Inbox.
 */
class TaskOrderTest {
    private val home = TaskList("00000000-0000-4000-8000-0000000000a1", "Home", createdAt = 1)
    private val work = TaskList("00000000-0000-4000-8000-0000000000a2", "work", createdAt = 2)
    private val gone = "00000000-0000-4000-8000-0000000000a9"

    private fun task(id: String, due: Due?, listId: String = INBOX, createdAt: Long = 0, doneAt: Long? = null) =
        Task("00000000-0000-4000-8000-0000000000$id", listId, "Task $id", due, doneAt, createdAt)

    @Test
    fun todayHasOverdueOldestFirstAndThenTodayWithRemindersFirstByTime() {
        val lateNoTime = task("01", Due(day(-1)), createdAt = 1)
        val lateAt8 = task("02", Due(day(-1), null, 8 * 60), createdAt = 9)
        val older = task("03", Due(day(-3)), createdAt = 9)
        val at10 = task("04", Due(MONDAY, null, 10 * 60))
        val at9 = task("05", Due(MONDAY, null, 9 * 60), createdAt = 5)
        val noTimeNew = task("06", Due(MONDAY), createdAt = 7)
        val noTimeOld = task("07", Due(MONDAY), createdAt = 3)
        val sameTimeSameMoment = task("08", Due(MONDAY, null, 9 * 60), createdAt = 5)
        val tomorrow = task("09", Due(day(1)))
        val done = task("10", Due(MONDAY), doneAt = 1)
        val noDueDay = task("11", null)

        val sections = TaskOrder.today(
            listOf(noDueDay, done, tomorrow, sameTimeSameMoment, noTimeOld, noTimeNew, at9, at10, older, lateAt8, lateNoTime),
            emptyList(),
            MONDAY,
        )

        assertEquals(listOf(older, lateAt8, lateNoTime), sections.overdue.map { it.task })
        assertEquals(listOf(at9, sameTimeSameMoment, at10, noTimeOld, noTimeNew), sections.dueToday.map { it.task })
    }

    @Test
    fun aRowNamesItsListOrInboxAlsoForAListThatIsGone() {
        val inHome = task("01", Due(MONDAY), home.id)
        val inGone = task("02", Due(MONDAY), gone, createdAt = 1)
        val inInbox = task("03", Due(MONDAY), createdAt = 2)

        val rows = TaskOrder.today(listOf(inHome, inGone, inInbox), listOf(home), MONDAY).dueToday

        assertEquals(listOf("Home", null, null), rows.map { it.listName })
    }

    @Test
    fun aListHasItsOpenTasksByDueDayThenThoseWithNoneAndItsDoneTasksLastDoneFirst() {
        val noDue = task("01", null, home.id, createdAt = 1)
        val noDueOlder = task("02", null, home.id, createdAt = 0)
        val tuesdayNoTime = task("03", Due(day(1)), home.id)
        val tuesdayAt9 = task("04", Due(day(1), null, 540), home.id, createdAt = 5)
        val monday = task("05", Due(MONDAY), home.id, createdAt = 9)
        val doneFirst = task("06", null, home.id, doneAt = 100)
        val doneLast = task("07", Due(MONDAY), home.id, doneAt = 200)
        val elsewhere = task("08", null, work.id)

        val sections = TaskOrder.inList(
            listOf(elsewhere, doneFirst, doneLast, monday, tuesdayAt9, tuesdayNoTime, noDueOlder, noDue),
            listOf(home, work),
            home.id,
        )

        assertEquals(listOf(monday, tuesdayAt9, tuesdayNoTime, noDueOlder, noDue), sections.open.map { it.task })
        assertEquals(listOf(doneLast, doneFirst), sections.done.map { it.task })
    }

    @Test
    fun inboxHoldsTheTasksOfNoListAndOfAListThatIsGone() {
        val inInbox = task("01", null)
        val inGone = task("02", null, gone, createdAt = 1)
        val inHome = task("03", null, home.id)

        assertEquals(listOf(inInbox, inGone), TaskOrder.inList(listOf(inHome, inGone, inInbox), listOf(home), INBOX).open.map { it.task })
    }

    @Test
    fun listsAreInboxFirstThenByNameInTheLanguageOrderWithTheirOpenCounts() {
        val apples = TaskList("00000000-0000-4000-8000-0000000000a3", "apples", createdAt = 3)
        val twin = TaskList("00000000-0000-4000-8000-0000000000a0", "Home", createdAt = 9)
        val tasks = listOf(
            task("01", null, home.id),
            task("02", null, home.id),
            task("03", null, home.id, doneAt = 1),
            task("04", null, gone),
            task("05", null),
            task("06", null, work.id, doneAt = 1),
        )

        val rows = TaskOrder.lists(tasks, listOf(work, twin, home, apples), Locale.ENGLISH)

        // In English order "apples" comes before "Home", and "Home" before "work", whatever the case. Two lists named
        // Home: the one created first comes first.
        assertEquals(listOf(null, apples, home, twin, work), rows.map { it.list })
        assertEquals(listOf(2, 0, 2, 0, 0), rows.map { it.openCount })
        assertEquals(INBOX, rows.first().listId)
    }
}
