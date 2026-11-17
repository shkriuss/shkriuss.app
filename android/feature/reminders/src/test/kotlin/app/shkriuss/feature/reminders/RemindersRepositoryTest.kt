package app.shkriuss.feature.reminders

import app.shkriuss.core.data.BEFORE_FIRST_CHANGE
import app.shkriuss.core.testing.TestIdSource
import app.shkriuss.feature.reminders.data.RemindersDatabase
import java.time.LocalDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The repository on a real database in memory and a real preferences
 * file: every write is stamped and only marks deletes, every read leaves
 * deleted reminders out, and the phone-only entries follow each write as
 * the spec's table of changes says (docs/apps/reminders/spec.md, "The
 * rule").
 */
@RunWith(RobolectricTestRunner::class)
class RemindersRepositoryTest {
    private val database: RemindersDatabase = memoryDatabase()
    private val clock = clockAt(monday(9, 30, 15))
    private val book = emptyBook()
    private val changes = mutableListOf<ReminderChange>()
    private val repository = RemindersRepository(
        database,
        clock,
        TestIdSource(),
        RemindersTime(clock) { UTC },
        book,
        work = Dispatchers.Unconfined,
        onChange = { changes += it },
    )

    @After
    fun closeTheDatabase() = database.close()

    private fun live() = runBlocking { repository.reminders().first() }

    private fun add(title: String = "Pills", schedule: Schedule = pills()) = runBlocking { checkNotNull(repository.add(title, schedule)) }

    @Test
    fun aReminderIsStoredWithItsTitleAndSchedule() = runBlocking {
        val gym = repository.add("Gym", gym())!!

        assertEquals(Reminder(TestIdSource.idNumber(1), "Gym", gym(), clock.nowMillis), gym)
        val row = database.reminders().find(gym.id)!!
        assertEquals(MONDAY.toEpochDay().toInt(), row.day)
        assertEquals(18 * 60 + 30, row.minuteOfDay)
        assertEquals(2, row.repeat)
        assertEquals(1 + 4 + 16, row.weekdays)
        assertEquals(1L, row.changeNumber)
        assertEquals(listOf(gym), live())
    }

    @Test
    fun aNewReminderCountsFromTheMinuteItIsSaved() {
        val pills = add()

        assertEquals(ReminderEntry(mark = monday(9, 30)), book.entryOf(pills.id))
        assertEquals(listOf(ReminderChange(ReminderChange.Kind.ADDED, listOf(pills.id))), changes)
    }

    @Test
    fun theFormAddsNoReminderPast500() = runBlocking {
        repeat(ReminderLimits.MOST_REMINDERS - 1) { repository.add("Reminder $it", pills()) }
        val deleted = repository.add("Deleted", pills())!!
        repository.delete(listOf(deleted.id))
        assertNotNull("a deleted reminder does not count", repository.add("Number 500", pills()))

        assertNull(repository.add("Number 501", pills()))
        assertEquals(ReminderLimits.MOST_REMINDERS, live().size)

        // Undo may bring the count past the limit.
        assertEquals(1, repository.bringBack(listOf(deleted.id)).size)
        assertEquals(ReminderLimits.MOST_REMINDERS + 1, live().size)
    }

    @Test
    fun aNewTimeCountsFromNowWithNoSnoozeAndNothingOnScreen() = runBlocking {
        val pills = add()
        book.update(pills.id) { ReminderEntry(mark = monday(9), snoozeMillis = 1L, showingMillis = 2L) }
        clock.setTo(monday(10, 0, 30))
        changes.clear()

        val changed = repository.change(pills.id, "Pills", pills().copy(minuteOfDay = 10 * 60 + 30))!!

        assertEquals(10 * 60 + 30, changed.schedule.minuteOfDay)
        assertEquals(ReminderEntry(mark = monday(10)), book.entryOf(pills.id))
        assertEquals(listOf(ReminderChange(ReminderChange.Kind.NEW_TIME, listOf(pills.id))), changes)
    }

    @Test
    fun aNewTitleOnlyLeavesTheEntryAsItWas() = runBlocking {
        val pills = add()
        val entry = ReminderEntry(mark = monday(9), snoozeMillis = 1L, showingMillis = 2L)
        book.update(pills.id) { entry }
        changes.clear()

        assertEquals("Vitamins", repository.change(pills.id, "Vitamins", pills())!!.title)

        assertEquals(entry, book.entryOf(pills.id))
        assertEquals(listOf(ReminderChange(ReminderChange.Kind.NEW_TITLE, listOf(pills.id))), changes)
    }

    @Test
    fun aChangeToNothingWritesNothing() = runBlocking {
        val pills = add()
        changes.clear()

        assertEquals(pills, repository.change(pills.id, "Pills", pills()))

        assertEquals(1L, database.reminders().find(pills.id)!!.changeNumber)
        assertEquals(emptyList<ReminderChange>(), changes)
    }

    @Test
    fun aDeletedReminderCannotBeChanged() = runBlocking {
        val pills = add()
        repository.delete(listOf(pills.id))

        assertNull(repository.change(pills.id, "Vitamins", pills()))
        assertNull(repository.find(pills.id))
        assertNull(repository.change("no such id", "Vitamins", pills()))
    }

    @Test
    fun deletingOnlyMarksRemovesTheEntriesAndUndoCountsFromNow() = runBlocking {
        val pills = add()
        val gym = add("Gym", gym())
        book.update(pills.id) { ReminderEntry(mark = monday(9), snoozeMillis = 1L, showingMillis = 2L) }
        changes.clear()

        assertEquals(listOf(pills, gym), repository.delete(listOf(pills.id, gym.id, pills.id)))
        assertEquals(emptyList<Reminder>(), live())
        assertNotNull("the row stays, marked", database.reminders().find(pills.id)?.record?.deletedAt)
        assertEquals("with its title", "Pills", database.reminders().find(pills.id)?.title)
        assertEquals(emptyMap<String, ReminderEntry>(), book.entries.value)
        assertEquals(emptyList<Reminder>(), repository.delete(listOf(pills.id)))

        clock.setTo(monday(11, 0, 59))
        assertEquals(listOf(pills), repository.bringBack(listOf(pills.id)))
        assertEquals(listOf(pills), live())
        assertEquals(ReminderEntry(mark = monday(11)), book.entryOf(pills.id))
        assertEquals(emptyList<Reminder>(), repository.bringBack(listOf(pills.id)))
        assertEquals(
            listOf(
                ReminderChange(ReminderChange.Kind.DELETED, listOf(pills.id, gym.id)),
                ReminderChange(ReminderChange.Kind.BROUGHT_BACK, listOf(pills.id)),
            ),
            changes,
        )
    }

    @Test
    fun everyWriteIsAChangeAndDeletedRemindersAreAmongTheChanges() = runBlocking {
        val pills = add()
        repository.change(pills.id, "Vitamins", pills())
        repository.delete(listOf(pills.id))

        val changed = database.reminders().changedSince(BEFORE_FIRST_CHANGE, 10)
        assertEquals(listOf(3L), changed.map { it.changeNumber })
        assertNotNull(changed.single().record.deletedAt)
    }

    @Test
    fun aTitleOrAScheduleOutsideItsLimitsIsRefused() {
        val wrong = listOf(
            "" to pills(),
            " Pills" to pills(),
            "Pills " to pills(),
            "Two\nlines" to pills(),
            "x".repeat(201) to pills(),
            "Pills" to pills().copy(minuteOfDay = 1_440),
            "Pills" to pills().copy(weekdays = 1),
            "Gym" to gym().copy(weekdays = 0),
            "Gym" to gym().copy(weekdays = 128),
            "Pills" to pills(from = LocalDate.of(1969, 12, 31)),
        )
        wrong.forEach { (title, schedule) ->
            assertThrows("$title $schedule", IllegalArgumentException::class.java) { runBlocking { repository.add(title, schedule) } }
        }
        assertEquals(emptyList<Reminder>(), live())
    }

    @Test
    fun aTitleOf200CodePointsIsKept() {
        // 200 code points that each take two UTF-16 units and four UTF-8 bytes.
        val title = "🔔".repeat(200)
        assertEquals(title, add(title).title)
    }
}
