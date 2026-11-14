package app.shkriuss.feature.water

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The bookkeeping of reminders on this phone (docs/apps/water/spec.md,
 * "On this phone only"): one file of Android's preferences, times only,
 * read again after a new start.
 */
@RunWith(RobolectricTestRunner::class)
class ReminderBookTest {
    private val file = context.getSharedPreferences(ReminderBook.FILE, Context.MODE_PRIVATE)

    private val everything = ReminderEntries(lastShown = 1, lastLater = 2, snooze = 3, showing = 4, named = 5, lastAlarm = 6)

    @Test
    fun aNewBookHoldsNothing() {
        assertEquals(ReminderEntries(), ReminderBook.of(context).entries.value)
    }

    @Test
    fun whatIsWrittenIsInTheFileAndANewStartReadsItAgain() {
        ReminderBook.of(context).update { everything }

        assertEquals(everything, ReminderBook.of(context).entries.value)
        assertEquals("app.shkriuss.water", ReminderBook.FILE)
    }

    @Test
    fun theFileHoldsTimesOnly() {
        ReminderBook.of(context).update { everything }

        assertEquals(setOf("last-shown", "last-later", "snooze", "showing", "named", "last-alarm"), file.all.keys)
        assertTrue(file.all.values.toString(), file.all.values.all { it is Long })
    }

    @Test
    fun aTimeThatIsGoneIsRemovedFromTheFile() {
        val book = ReminderBook.of(context)
        book.update { everything }

        book.update { it.copy(showing = null, snooze = null) }

        assertFalse(file.contains("showing"))
        assertFalse(file.contains("snooze"))
        assertNull(ReminderBook.of(context).entries.value.showing)
    }

    @Test
    fun theEntriesFollowEveryUpdate() {
        val book = ReminderBook.of(context)

        val written = book.update { it.copy(lastShown = 10) }

        assertEquals(ReminderEntries(lastShown = 10), written)
        assertEquals(written, book.entries.value)
    }

    @Test
    fun theAlarmSetLastIsPendingUntilItReachesTheHandler() {
        assertNull(ReminderEntries().pending)
        assertEquals(10L, ReminderEntries(named = 10).pending)
        assertNull(ReminderEntries(named = 10, lastAlarm = 10).pending)
        assertEquals(20L, ReminderEntries(named = 20, lastAlarm = 10).pending)
    }
}
