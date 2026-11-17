package app.shkriuss.feature.reminders

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The phone-only file (docs/apps/reminders/spec.md, "On this phone only"):
 * its name, its three lines per reminder, ids and times only, and that a
 * new start of the app reads what the last one wrote.
 */
@RunWith(RobolectricTestRunner::class)
class ReminderBookTest {
    private val book = emptyBook()
    private val file = context.getSharedPreferences(ReminderBook.FILE, Context.MODE_PRIVATE)

    @Test
    fun theFileHoldsAMarkASnoozeAndAShowingTimeByTheReminderId() {
        assertEquals("app.shkriuss.reminders", ReminderBook.FILE)
        book.update("a") { ReminderEntry(mark = monday(9), snoozeMillis = 1_000L, showingMillis = 2_000L) }

        // Monday 16 November 2026 at 09:00 is 29,913,660 minutes after 1970-01-01 00:00.
        assertEquals(mapOf("mark.a" to 29_913_660L, "snooze.a" to 1_000L, "showing.a" to 2_000L), file.all)
        assertEquals(monday(9), ReminderBook.localOf(29_913_660L))
    }

    @Test
    fun aNewStartReadsWhatWasWritten() {
        book.update(listOf("a", "b")) { id, _ -> if (id == "a") ReminderEntry(mark = monday(9)) else ReminderEntry(snoozeMillis = 5L) }

        val again = ReminderBook(file)

        assertEquals(mapOf("a" to ReminderEntry(mark = monday(9)), "b" to ReminderEntry(snoozeMillis = 5L)), again.entries.value)
        assertEquals(ReminderEntry(), again.entryOf("c"))
    }

    @Test
    fun aRemovedEntryLeavesNoLine() {
        book.update("a") { ReminderEntry(mark = monday(9), snoozeMillis = 1L, showingMillis = 2L) }
        book.update("b") { ReminderEntry(mark = monday(10)) }

        assertTrue(book.remove(listOf("a")))

        assertEquals(mapOf("mark.b" to ReminderBook.minutesOf(monday(10))), file.all)
        assertEquals(setOf("b"), book.entries.value.keys)
    }

    @Test
    fun aChangeOfOneTimeKeepsTheOthers() {
        book.update("a") { ReminderEntry(mark = monday(9), snoozeMillis = 1L, showingMillis = 2L) }
        book.update("a") { it.copy(showingMillis = null) }

        assertEquals(ReminderEntry(mark = monday(9), snoozeMillis = 1L), ReminderBook(file).entryOf("a"))
    }

    @Test
    fun aLineThatIsNotATimeIsLeftOut() {
        check(file.edit().putString("mark.a", "09:00").putLong("snooze.b", 7L).putLong("other", 1L).putLong("mark.c", Long.MAX_VALUE).commit())

        assertEquals(mapOf("b" to ReminderEntry(snoozeMillis = 7L)), ReminderBook(file).entries.value)
    }
}
