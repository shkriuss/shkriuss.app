package app.shkriuss.feature.tasks

import android.content.Context
import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The phone-only file (docs/apps/tasks/spec.md, "On this phone only"):
 * its name, its four lines per task, ids, times and numbers only, the
 * reminder number the entries count for, the limits of each value, and
 * that a new start of the app reads what the last one wrote.
 */
@RunWith(RobolectricTestRunner::class)
class TaskBookTest {
    private val book = emptyBook()
    private val file = context.getSharedPreferences(TaskBook.FILE, Context.MODE_PRIVATE)

    @Test
    fun theFileHoldsANumberAMarkASnoozeAndAShowingTimeByTheTaskId() {
        assertEquals("app.shkriuss.tasks", TaskBook.FILE)
        book.update(listOf("a")) { _, _ -> TaskEntry(239_306_940L, monday(9), 1_000L, 2_000L) }

        // Monday 16 November 2026 at 09:00 is 29,913,660 minutes after 1970-01-01 00:00.
        assertEquals(mapOf("for.a" to 239_306_940L, "mark.a" to 29_913_660L, "snooze.a" to 1_000L, "showing.a" to 2_000L), file.all)
        assertEquals(TaskEntry(239_306_940L, monday(9), 1_000L, 2_000L), TaskBook(file).storedOf("a"))
    }

    @Test
    fun theEntriesCountOnlyForTheReminderNumberTheyWereWrittenFor() {
        book.update(listOf("a")) { _, _ -> TaskEntry.countingFrom(7L, monday(9)) }

        assertEquals(TaskEntry(7L, monday(9)), book.entryOf("a", 7L))
        assertEquals("another number", TaskEntry(), book.entryOf("a", 8L))
        assertEquals("a task with no reminder", TaskEntry(), book.entryOf("a", null))
        assertEquals("no entry", TaskEntry(), book.entryOf("b", 7L))
    }

    @Test
    fun everyWriteOfAMarkASnoozeOrAShowingTimeWritesTheNumberToo() {
        assertThrows(IllegalArgumentException::class.java) { TaskEntry(mark = monday(9)) }
        assertThrows(IllegalArgumentException::class.java) { TaskEntry(snoozeMillis = 1L) }
        assertThrows(IllegalArgumentException::class.java) { TaskEntry(showingMillis = 1L) }
    }

    @Test
    fun aRemovedEntryLeavesNoLine() {
        book.update(listOf("a", "b")) { id, _ -> TaskEntry(if (id == "a") 1L else 2L, monday(9), 1L, 2L) }

        assertTrue(book.remove(listOf("a")))

        assertEquals(setOf("for.b", "mark.b", "snooze.b", "showing.b"), file.all.keys)
        assertEquals(setOf("b"), book.entries.value.keys)
    }

    @Test
    fun aValueThatCannotBeReadOrIsOutsideItsLimitsCountsAsMissing() {
        check(
            file.edit()
                .putLong("for.a", 1L).putString("mark.a", "09:00").putLong("snooze.a", -1L).putLong("showing.a", 253_402_300_800_000L)
                .putLong("for.b", 2L).putLong("mark.b", TaskBook.MOST_MARK_MINUTES + 1)
                .putLong("for.c", TaskReminders.MOST_NUMBER + 1).putLong("mark.c", 5L)
                .putLong("mark.d", 5L)
                .putLong("for.e", TaskReminders.MOST_NUMBER).putLong("mark.e", TaskBook.MOST_MARK_MINUTES).putLong("snooze.e", 0L)
                .putLong("other", 1L)
                .commit(),
        )

        assertEquals(
            mapOf(
                "a" to TaskEntry(1L),
                "b" to TaskEntry(2L),
                // c has no number that can be read, and d none at all: their marks count for nothing.
                "e" to TaskEntry(TaskReminders.MOST_NUMBER, TaskBook.localOf(TaskBook.MOST_MARK_MINUTES), 0L),
            ),
            TaskBook(file).entries.value,
        )
        assertEquals(java.time.LocalDateTime.of(9999, 12, 31, 23, 59), TaskBook.localOf(TaskBook.MOST_MARK_MINUTES))
    }

    @Test
    fun afterARefusedWriteTheBookKeepsTheChangeAndTheNextWriteCatchesTheFileUp() {
        val disk = RefusingPreferences()
        val book = TaskBook(disk)
        assertTrue(book.update(listOf("a")) { _, _ -> TaskEntry(1L, monday(9), 1L) })
        assertTrue(book.update(listOf("gone")) { _, _ -> TaskEntry(2L, monday(8)) })

        disk.refuse = true
        assertFalse(book.update(listOf("a")) { _, _ -> TaskEntry(3L, monday(10)) })
        assertFalse(book.remove(listOf("gone")))
        assertEquals("the book holds the change", TaskEntry(3L, monday(10)), book.storedOf("a"))
        assertEquals("the file does not", TaskEntry(1L, monday(9), 1L), TaskBook(disk).storedOf("a"))

        disk.refuse = false
        assertTrue(book.update(listOf("b")) { _, _ -> TaskEntry(4L, showingMillis = 3L) })

        assertEquals(mapOf("a" to TaskEntry(3L, monday(10)), "b" to TaskEntry(4L, showingMillis = 3L)), TaskBook(disk).entries.value)
        assertEquals(setOf("for.a", "mark.a", "for.b", "showing.b"), disk.all.keys)
    }
}

/**
 * Preferences in memory whose writes the test can make fail, as when the
 * disk is full. Only what `TaskBook` uses works.
 */
private class RefusingPreferences : SharedPreferences {
    /** While true, every commit fails and changes nothing. */
    var refuse = false
    private val values = mutableMapOf<String, Any?>()

    override fun getAll(): Map<String, *> = values.toMap()

    override fun contains(key: String): Boolean = key in values

    override fun getLong(key: String, defValue: Long): Long = values[key] as? Long ?: defValue

    override fun getString(key: String, defValue: String?): String? = error("not used")

    override fun getStringSet(key: String, defValues: Set<String>?): Set<String>? = error("not used")

    override fun getInt(key: String, defValue: Int): Int = error("not used")

    override fun getFloat(key: String, defValue: Float): Float = error("not used")

    override fun getBoolean(key: String, defValue: Boolean): Boolean = error("not used")

    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) = error("not used")

    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) = error("not used")

    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
        private var clear = false
        private val puts = mutableMapOf<String, Long>()
        private val removes = mutableSetOf<String>()

        override fun putLong(key: String, value: Long) = apply { puts[key] = value }

        override fun remove(key: String) = apply { removes += key }

        override fun clear() = apply { clear = true }

        override fun commit(): Boolean {
            if (refuse) return false
            if (clear) values.clear()
            removes.forEach { values.remove(it) }
            values.putAll(puts)
            return true
        }

        override fun apply() = error("not used")

        override fun putString(key: String, value: String?) = error("not used")

        override fun putStringSet(key: String, values: Set<String>?) = error("not used")

        override fun putInt(key: String, value: Int) = error("not used")

        override fun putFloat(key: String, value: Float) = error("not used")

        override fun putBoolean(key: String, value: Boolean) = error("not used")
    }
}
