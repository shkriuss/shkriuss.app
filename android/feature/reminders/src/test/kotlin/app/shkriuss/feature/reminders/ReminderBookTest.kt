package app.shkriuss.feature.reminders

import android.content.Context
import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    fun afterARefusedWriteTheBookKeepsTheChangeAndTheNextWriteCatchesTheFileUp() {
        val disk = RefusingPreferences()
        val book = ReminderBook(disk)
        assertTrue(book.update("a") { ReminderEntry(mark = monday(9), snoozeMillis = 1L) })
        assertTrue(book.update("gone") { ReminderEntry(mark = monday(8)) })

        disk.refuse = true
        assertFalse(book.update("a") { ReminderEntry(mark = monday(10)) })
        assertFalse(book.remove(listOf("gone")))
        assertEquals("the book holds the change", ReminderEntry(mark = monday(10)), book.entryOf("a"))
        assertEquals("the file does not", ReminderEntry(mark = monday(9), snoozeMillis = 1L), ReminderBook(disk).entryOf("a"))

        disk.refuse = false
        assertTrue(book.update("b") { ReminderEntry(showingMillis = 3L) })

        assertEquals(
            mapOf("a" to ReminderEntry(mark = monday(10)), "b" to ReminderEntry(showingMillis = 3L)),
            ReminderBook(disk).entries.value,
        )
        assertEquals(setOf("mark.a", "showing.b"), disk.all.keys)
    }

    @Test
    fun aLineThatIsNotATimeIsLeftOut() {
        check(file.edit().putString("mark.a", "09:00").putLong("snooze.b", 7L).putLong("other", 1L).putLong("mark.c", Long.MAX_VALUE).commit())

        assertEquals(mapOf("b" to ReminderEntry(snoozeMillis = 7L)), ReminderBook(file).entries.value)
    }
}

/**
 * Preferences in memory whose writes the test can make fail, as when the
 * disk is full. Only what `ReminderBook` uses works.
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
