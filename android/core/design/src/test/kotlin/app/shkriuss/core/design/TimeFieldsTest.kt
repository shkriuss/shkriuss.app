package app.shkriuss.core.design

import java.time.LocalTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Checks the rules of [ShkTimePicker]'s fields, without drawing anything:
 * which hours each clock takes, which minutes, the time the fields make,
 * and what may be typed.
 */
class TimeFieldsTest {
    @Test
    fun theTwelveHourClockTakesHoursFrom1To12() {
        assertEquals(LocalTime.of(9, 30), fields("09", "30", pm = false).time)
        assertEquals(LocalTime.of(21, 30), fields("9", "30", pm = true).time)
        assertEquals("12 AM is midnight", LocalTime.of(0, 0), fields("12", "00", pm = false).time)
        assertEquals("12 PM is noon", LocalTime.of(12, 0), fields("12", "00", pm = true).time)
        listOf("0", "00", "13", "99").forEach { hour ->
            assertTrue("$hour is no hour on the 12-hour clock", fields(hour, "30").hourIsWrong)
            assertNull(fields(hour, "30").time)
        }
    }

    @Test
    fun theTwentyFourHourClockTakesHoursFrom0To23() {
        assertEquals(LocalTime.of(0, 5), fields("0", "05", is24Hour = true).time)
        assertEquals(LocalTime.of(23, 59), fields("23", "59", is24Hour = true).time)
        assertEquals("PM means nothing on the 24-hour clock", LocalTime.of(9, 0), fields("09", "00", pm = true, is24Hour = true).time)
        listOf("24", "25", "99").forEach { hour ->
            assertTrue("$hour is no hour on the 24-hour clock", fields(hour, "30", is24Hour = true).hourIsWrong)
        }
    }

    @Test
    fun minutesGoFrom0To59() {
        assertEquals(LocalTime.of(9, 0), fields("9", "0").time)
        assertEquals(LocalTime.of(9, 59), fields("9", "59").time)
        listOf("60", "75", "99").forEach { minute ->
            assertTrue("$minute is no minute", fields("9", minute).minuteIsWrong)
            assertNull(fields("9", minute).time)
        }
    }

    @Test
    fun anEmptyFieldIsNoErrorButMakesNoTime() {
        val empty = fields("", "")
        assertFalse(empty.hourIsWrong)
        assertFalse(empty.minuteIsWrong)
        assertNull(empty.time)
        assertNull(fields("9", "").time)
    }

    @Test
    fun onlyUpToTwoDigitsCanBeTyped() {
        assertEquals("1", TimeFields.accept(current = "", typed = "1"))
        assertEquals("12", TimeFields.accept(current = "1", typed = "12"))
        assertEquals("", TimeFields.accept(current = "1", typed = ""))
        assertEquals("A third digit is refused", "12", TimeFields.accept(current = "12", typed = "123"))
        assertEquals("Letters are refused", "12", TimeFields.accept(current = "12", typed = "1a"))
        assertEquals("Signs are refused", "1", TimeFields.accept(current = "1", typed = "-1"))
    }

    @Test
    fun digitsOfOtherScriptsCount() {
        // Arabic-Indic one and two, as an Arabic number keyboard types them.
        assertEquals("١٢", TimeFields.accept(current = "", typed = "١٢"))
        assertEquals(LocalTime.of(12, 30), fields("١٢", "30", pm = true).time)
    }

    private fun fields(hour: String, minute: String, pm: Boolean = false, is24Hour: Boolean = false) =
        TimeFields(hour = hour, minute = minute, pm = pm, is24Hour = is24Hour)
}
