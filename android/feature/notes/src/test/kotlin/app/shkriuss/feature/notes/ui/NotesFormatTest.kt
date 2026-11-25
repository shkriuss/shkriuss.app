package app.shkriuss.feature.notes.ui

import androidx.test.core.app.ApplicationProvider
import android.app.Application
import app.shkriuss.feature.notes.NotesClock
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * How Notes' screens write times, dates, sizes and percents, and what
 * TalkBack reads for them (docs/apps/notes/spec.md, "Notes", point 3,
 * "Limits and defaults", units, "The clock or the time zone changes" and
 * "TalkBack"), in English with the 24-hour clock of the spec's examples.
 */
@RunWith(RobolectricTestRunner::class)
class NotesFormatTest {
    private val format = NotesFormat(ApplicationProvider.getApplicationContext<Application>().resources, Locale.US, is24Hour = true)

    /** Tuesday 24 November 2026 at 09:30 UTC, in UTC. */
    private val now = NotesClock(at(2026, 11, 24, 9, 30), ZoneOffset.UTC)

    @Test
    fun aLastChangeShowsItsTimeTodayItsDayThisYearAndItsYearBefore() {
        assertEquals("14:05", format.lastChange(at(2026, 11, 24, 14, 5), now))
        assertEquals("00:00", format.lastChange(at(2026, 11, 24, 0, 0), now))
        assertEquals("Mon, Nov 16", format.lastChange(at(2026, 11, 16, 14, 5), now))
        assertEquals("Tue, Dec 30, 2025", format.lastChange(at(2025, 12, 30, 18, 0), now))
    }

    @Test
    fun talkBackReadsTheDayInFull() {
        assertEquals("14:05", format.spokenChange(at(2026, 11, 24, 14, 5), now))
        assertEquals("Monday, November 16", format.spokenChange(at(2026, 11, 16, 14, 5), now))
        assertEquals("Tuesday, December 30, 2025", format.spokenChange(at(2025, 12, 30, 18, 0), now))
    }

    @Test
    fun aLastChangeShowsInTheZoneThePhoneIsInNowAndTheDayChangesAtItsMidnight() {
        val change = at(2026, 11, 24, 1, 30)
        assertEquals("01:30", format.lastChange(change, now))
        // In New York it was still Monday evening, and it is Tuesday morning there too only from its own midnight.
        val newYork = ZoneId.of("America/New_York")
        assertEquals("Mon, Nov 23", format.lastChange(change, NotesClock(at(2026, 11, 24, 9, 30), newYork)))
        assertEquals("20:30", format.lastChange(change, NotesClock(at(2026, 11, 24, 3, 0), newYork)))
        // From midnight, a time of yesterday shows as its day.
        assertEquals("Tue, Nov 24", format.lastChange(at(2026, 11, 24, 23, 59), NotesClock(at(2026, 11, 25, 0, 0), ZoneOffset.UTC)))
    }

    @Test
    fun sizesAreInStepsOfOneThousandWithOneDecimalUnderTen() {
        assertEquals("0 B", format.size(0))
        assertEquals("999 B", format.size(999))
        assertEquals("1 kB", format.size(1_000))
        assertEquals("1.1 kB", format.size(1_149))
        assertEquals("2.4 MB", format.size(2_400_000))
        assertEquals("25 MB", format.size(25_000_000))
        assertEquals("120 MB", format.size(120_000_000))
        // Rounded up to the next unit, not "1,000 kB".
        assertEquals("1 MB", format.size(999_999))
        assertEquals("1 GB", format.size(1_000_000_000))
        assertEquals("1.2 GB", format.size(1_234_000_000))
    }

    @Test
    fun talkBackReadsSizesInWords() {
        assertEquals("2.4 megabytes", format.spokenSize(2_400_000))
        assertEquals("1 megabyte", format.spokenSize(1_000_000))
        assertEquals("1 byte", format.spokenSize(1))
        assertEquals("120 megabytes", format.spokenSize(120_000_000))
    }

    @Test
    fun aPercentIsWholeAndRoundedDown() {
        assertEquals("40%", format.percent(0.404f))
        assertEquals("99%", format.percent(0.999f))
        assertEquals("100%", format.percent(1f))
        assertEquals("0%", format.percent(-1f))
    }

    @Test
    fun countsAreInThePhonesNumberFormat() {
        assertEquals("5,000", format.number(5_000))
    }

    private fun at(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long =
        LocalDateTime.of(year, month, day, hour, minute).toInstant(ZoneOffset.UTC).toEpochMilli()
}
