package app.shkriuss.feature.water.ui

import android.content.res.Resources
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import app.shkriuss.feature.water.R
import app.shkriuss.feature.water.WaterUnit
import java.text.NumberFormat
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Every number, amount, time and date that Water's screens show, and the
 * words TalkBack reads for them (docs/apps/water/spec.md, "Units" and
 * "TalkBack and accessibility"). Numbers are in the phone's format, such
 * as "1,250", times in its 12-hour or 24-hour format, and dates in its
 * language. Amounts are given in millilitres and shown in a unit.
 *
 * It is plain code, so the rules are tested without a screen.
 */
class WaterFormat(
    private val resources: Resources,
    private val locale: Locale,
    private val is24Hour: Boolean,
) {
    private val numbers = NumberFormat.getIntegerInstance(locale)
    private val clock = DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, if (is24Hour) "Hm" else "hm"), locale)
    private val shortDate = DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, "EEEdMMM"), locale)
    private val spokenDate = DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, "EEEEdMMMM"), locale)
    private val fullDate = DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale)

    /** [number] in the phone's format: "1,250". */
    fun number(number: Int): String = numbers.format(number.toLong())

    /** The number of [millilitres] in [unit], without the unit: "1,250", or "42" in fluid ounces. */
    fun quantity(millilitres: Int, unit: WaterUnit): String = number(unit.shown(millilitres))

    /** [millilitres] as shown, in [unit]: "1,250 ml", "8 fl oz". */
    fun amount(millilitres: Int, unit: WaterUnit): String = shownWithUnit(quantity(millilitres, unit), unit)

    /** A whole [value] typed in [unit], with the unit: "3,000 ml", for the limits in a message. */
    fun inUnit(value: Int, unit: WaterUnit): String = shownWithUnit(number(value), unit)

    /** [millilitres] as TalkBack reads it, in [unit]: "250 millilitres", "8 fluid ounces". */
    fun amountSpoken(millilitres: Int, unit: WaterUnit): String {
        val value = unit.shown(millilitres)
        val plural = when (unit) {
            WaterUnit.MILLILITRES -> R.plurals.water_amount_ml_spoken
            WaterUnit.US_FLUID_OUNCES -> R.plurals.water_amount_fl_oz_spoken
        }
        return resources.getQuantityString(plural, value, number(value))
    }

    /** The unit after a number field: "ml" or "fl oz". */
    fun unitShort(unit: WaterUnit): String = resources.getString(
        when (unit) {
            WaterUnit.MILLILITRES -> R.string.water_unit_ml
            WaterUnit.US_FLUID_OUNCES -> R.string.water_unit_fl_oz
        },
    )

    /** What TalkBack reads for the unit after a number field: "millilitres". */
    fun unitSpoken(unit: WaterUnit): String = resources.getString(
        when (unit) {
            WaterUnit.MILLILITRES -> R.string.water_unit_ml_spoken
            WaterUnit.US_FLUID_OUNCES -> R.string.water_unit_fl_oz_spoken
        },
    )

    /** The unit's name in the Unit setting: "Millilitres (ml)". */
    fun unitName(unit: WaterUnit): String = resources.getString(
        when (unit) {
            WaterUnit.MILLILITRES -> R.string.water_unit_millilitres
            WaterUnit.US_FLUID_OUNCES -> R.string.water_unit_fluid_ounces
        },
    )

    /** "of 2,000 ml · 62%", under the total. */
    fun ofGoal(goalMl: Int, percent: Int, unit: WaterUnit): String =
        resources.getString(R.string.water_of_goal, amount(goalMl, unit), number(percent))

    /** [percent] as TalkBack reads it: "62 percent". */
    fun percentSpoken(percent: Int): String = resources.getQuantityString(R.plurals.water_percent_spoken, percent, number(percent))

    /**
     * The summary as TalkBack reads it, as one item: "1,250 of 2,000
     * millilitres today, 62 percent", then "Goal reached" when it is met.
     * A day that is not today has no "today".
     */
    fun summarySpoken(totalMl: Int, goalMl: Int, percent: Int, unit: WaterUnit, isToday: Boolean, goalReached: Boolean): String {
        val words = resources.getString(
            if (isToday) R.string.water_summary_spoken_today else R.string.water_summary_spoken_day,
            quantity(totalMl, unit),
            amountSpoken(goalMl, unit),
            percentSpoken(percent),
        )
        return if (goalReached) resources.getString(R.string.water_summary_goal_reached_spoken, words) else words
    }

    /** A time of day, [minuteOfDay] minutes after midnight, in the phone's 12-hour or 24-hour format: "14:05". */
    fun time(minuteOfDay: Int): String = clock.format(LocalTime.of(minuteOfDay / MINUTES_PER_HOUR, minuteOfDay % MINUTES_PER_HOUR))

    /** One day of History: "Today", "Yesterday", or the short date, such as "Thu, 12 Nov". */
    fun dayName(day: LocalDate, today: LocalDate): String = when (day) {
        today -> resources.getString(R.string.water_today)
        today.minusDays(1) -> resources.getString(R.string.water_yesterday)
        else -> shortDate.format(day)
    }

    /** A day as TalkBack reads it in History: "Today", "Yesterday", or "Thursday 12 November". */
    fun dayNameSpoken(day: LocalDate, today: LocalDate): String = when (day) {
        today, today.minusDays(1) -> dayName(day, today)
        else -> spokenDate.format(day)
    }

    /** The title of an open day: "Today", or the full date, such as "Thursday, 12 November 2026". */
    fun dayTitle(day: LocalDate, isToday: Boolean): String =
        if (isToday) resources.getString(R.string.water_today) else fullDate.format(day)

    /** The value of the setting "Every": "1 hour". */
    fun interval(minutes: Int): String = resources.getString(
        when (minutes) {
            30 -> R.string.water_every_30
            45 -> R.string.water_every_45
            60 -> R.string.water_every_60
            90 -> R.string.water_every_90
            120 -> R.string.water_every_120
            180 -> R.string.water_every_180
            else -> error("Not one of the six intervals: $minutes")
        },
    )

    private fun shownWithUnit(number: String, unit: WaterUnit): String = resources.getString(
        when (unit) {
            WaterUnit.MILLILITRES -> R.string.water_amount_ml
            WaterUnit.US_FLUID_OUNCES -> R.string.water_amount_fl_oz
        },
        number,
    )

    private companion object {
        const val MINUTES_PER_HOUR = 60
    }
}

/** The [WaterFormat] of the screen: the phone's language and its 12-hour or 24-hour clock. */
@Composable
internal fun rememberWaterFormat(): WaterFormat {
    val resources = LocalResources.current
    val locale = LocalConfiguration.current.locales[0]
    val is24Hour = DateFormat.is24HourFormat(LocalContext.current)
    return remember(resources, locale, is24Hour) { WaterFormat(resources, locale, is24Hour) }
}
