package app.shkriuss.feature.notes.ui

import android.content.res.Resources
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import app.shkriuss.feature.notes.NotesClock
import app.shkriuss.feature.notes.R
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.floor

/**
 * Every time, date, size and count that Notes' screens show, and the words
 * TalkBack reads for them (docs/apps/notes/spec.md, "Notes", point 3,
 * "Limits and defaults", units, and "TalkBack"). A last change shows as its
 * time when it is today, else as a short date, "Mon 16 Nov", with its year
 * when it is not this year, as in Tasks. Times are in the phone's 12-hour
 * or 24-hour format and its time zone, dates in its language. Sizes are in
 * steps of 1,000, as Android shows them: "2.4 MB", one decimal under 10.
 *
 * It is plain code, so the rules are tested without a screen.
 */
class NotesFormat(
    private val resources: Resources,
    private val locale: Locale,
    is24Hour: Boolean,
) {
    private val numbers = NumberFormat.getIntegerInstance(locale)
    private val clockTime = pattern(if (is24Hour) "Hm" else "hm")
    private val shortDate = pattern("EEEdMMM")
    private val shortDateWithYear = pattern("EEEdMMMy")
    private val spokenDate = pattern("EEEEdMMMM")
    private val spokenDateWithYear = pattern("EEEEdMMMMy")
    private val longDate = DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale)

    /** [number] in the phone's format: "5,000". */
    fun number(number: Int): String = numbers.format(number.toLong())

    /** A count of a backup in the phone's format: "5,000". */
    fun count(count: Long): String = numbers.format(count)

    /**
     * When a backup was made, [at] in the phone's time zone, in its long
     * date format and its clock, for the question before a restore:
     * "16 November 2026, 14:05".
     */
    fun madeAt(at: LocalDateTime): String = resources.getString(R.string.notes_made_at, longDate.format(at), clockTime.format(at))

    /** [fraction], from 0 to 1, as a whole percent, rounded down so that 100% means done: "40%". */
    fun percent(fraction: Float): String =
        NumberFormat.getPercentInstance(locale).format(floor(fraction.coerceIn(0f, 1f) * PERCENT) / PERCENT)

    /** A last change, [millis], as a row shows it: "14:05" today, "Mon 16 Nov" this year, else with the year. */
    fun lastChange(millis: Long, clock: NotesClock): String {
        val at = Instant.ofEpochMilli(millis).atZone(clock.zone)
        val today = clock.today
        return when {
            at.toLocalDate() == today -> clockTime.format(at)
            at.year == today.year -> shortDate.format(at)
            else -> shortDateWithYear.format(at)
        }
    }

    /** A last change as TalkBack reads it: "14:05" today, "Monday 16 November" this year, else with the year. */
    fun spokenChange(millis: Long, clock: NotesClock): String {
        val at = Instant.ofEpochMilli(millis).atZone(clock.zone)
        val today = clock.today
        return when {
            at.toLocalDate() == today -> clockTime.format(at)
            at.year == today.year -> spokenDate.format(at)
            else -> spokenDateWithYear.format(at)
        }
    }

    /** A size in bytes, as Android shows sizes, in steps of 1,000: "2.4 MB", "120 MB", "1 GB", "512 B". */
    fun size(bytes: Long): String {
        val (value, unit) = scaled(bytes)
        val shown = sizeNumber(value)
        return resources.getString(unit.shown, shown)
    }

    /** A size as TalkBack reads it: "2.4 megabytes". */
    fun spokenSize(bytes: Long): String {
        val (value, unit) = scaled(bytes)
        val shown = sizeNumber(value)
        // A whole 1 reads as one; any other number, also 1.5, as many.
        val quantity = if (value == 1.0) 1 else MANY
        return resources.getQuantityString(unit.spoken, quantity, shown)
    }

    /** [bytes] in the largest unit that keeps the value, as shown, under 1,000. */
    private fun scaled(bytes: Long): Pair<Double, SizeUnit> {
        var value = bytes.coerceAtLeast(0).toDouble()
        var unit = SizeUnit.entries.first()
        while (unit != SizeUnit.entries.last() && rounded(value) >= STEP) {
            value /= STEP
            unit = SizeUnit.entries[unit.ordinal + 1]
        }
        return rounded(value) to unit
    }

    /** [value] rounded as it shows: one decimal under 10, whole numbers from 10. */
    private fun rounded(value: Double): Double {
        val places = if (value < ONE_DECIMAL_BELOW) 1 else 0
        return value.toBigDecimal().setScale(places, RoundingMode.HALF_UP).toDouble()
    }

    private fun sizeNumber(value: Double): String = NumberFormat.getNumberInstance(locale).apply {
        maximumFractionDigits = if (value < ONE_DECIMAL_BELOW) 1 else 0
        minimumFractionDigits = 0
    }.format(value)

    private fun pattern(skeleton: String): DateTimeFormatter =
        DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, skeleton), locale)

    /** The units of a size, in steps of 1,000, with the words that show and that TalkBack reads. */
    private enum class SizeUnit(val shown: Int, val spoken: Int) {
        BYTES(R.string.notes_size_b, R.plurals.notes_size_b_spoken),
        KILOBYTES(R.string.notes_size_kb, R.plurals.notes_size_kb_spoken),
        MEGABYTES(R.string.notes_size_mb, R.plurals.notes_size_mb_spoken),
        GIGABYTES(R.string.notes_size_gb, R.plurals.notes_size_gb_spoken),
    }

    private companion object {
        const val STEP = 1_000.0
        const val ONE_DECIMAL_BELOW = 10.0
        const val PERCENT = 100.0

        /** A quantity that picks the plural for many. */
        const val MANY = 2
    }
}

/** The [NotesFormat] of the phone's language and clock, made again when they change. */
@Composable
internal fun rememberNotesFormat(): NotesFormat {
    val resources = LocalResources.current
    val configuration = LocalConfiguration.current
    val is24Hour = DateFormat.is24HourFormat(LocalContext.current)
    return remember(resources, configuration, is24Hour) { NotesFormat(resources, configuration.locales[0], is24Hour) }
}
