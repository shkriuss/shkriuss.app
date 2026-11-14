package app.shkriuss.feature.water

import app.shkriuss.feature.water.ui.WaterFormat
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * How the screens write numbers, amounts, times and dates, and what
 * TalkBack reads for them (docs/apps/water/spec.md, "Units" and "TalkBack
 * and accessibility").
 */
@RunWith(RobolectricTestRunner::class)
class WaterFormatTest {
    private val uk = WaterFormat(context.resources, Locale.UK, is24Hour = true)
    private val us = WaterFormat(context.resources, Locale.US, is24Hour = false)
    private val ml = WaterUnit.MILLILITRES
    private val flOz = WaterUnit.US_FLUID_OUNCES

    @Test
    fun numbersAreInThePhonesFormat() {
        assertEquals("1,250", uk.number(1_250))
        assertEquals("1.250", WaterFormat(context.resources, Locale.GERMANY, is24Hour = true).number(1_250))
    }

    @Test
    fun amountsShowInTheUnitInWholeNumbers() {
        assertEquals("1,250 ml", uk.amount(1_250, ml))
        assertEquals("68 fl oz", uk.amount(2_000, flOz))
        assertEquals("8 fl oz", uk.amount(237, flOz))
        assertEquals("3,000 ml", uk.inUnit(3_000, ml))
        assertEquals("ml", uk.unitShort(ml))
        assertEquals("fl oz", uk.unitShort(flOz))
    }

    @Test
    fun talkBackReadsTheUnitInFullWords() {
        assertEquals("250 millilitres", uk.amountSpoken(250, ml))
        assertEquals("1 millilitre", uk.amountSpoken(1, ml))
        assertEquals("8 fluid ounces", uk.amountSpoken(237, flOz))
        assertEquals("1 fluid ounce", uk.amountSpoken(30, flOz))
        assertEquals("millilitres", uk.unitSpoken(ml))
        assertEquals("fluid ounces", uk.unitSpoken(flOz))
        assertEquals("62 percent", uk.percentSpoken(62))
    }

    @Test
    fun theSummaryIsOneSentenceAndSaysGoalReachedOnceMet() {
        assertEquals("of 2,000 ml · 62%", uk.ofGoal(2_000, 62, ml))
        assertEquals(
            "1,250 of 2,000 millilitres today, 62 percent",
            uk.summarySpoken(1_250, 2_000, 62, ml, isToday = true, goalReached = false),
        )
        assertEquals(
            "2,100 of 2,000 millilitres, 105 percent. Goal reached",
            uk.summarySpoken(2_100, 2_000, 105, ml, isToday = false, goalReached = true),
        )
    }

    @Test
    fun timesFollowThePhonesClock() {
        assertEquals("14:05", uk.time(14 * 60 + 5))
        assertEquals("08:00", uk.time(8 * 60))
        assertEquals("2:05 PM", us.time(14 * 60 + 5).replace(' ', ' '))
    }

    @Test
    fun aDateWithItsTimeIsInThePhonesFormat() {
        assertEquals("13 November 2026, 14:05", uk.dateTime(THE_DAY.atTime(14, 5)))
        assertEquals("November 13, 2026, 2:05 PM", us.dateTime(THE_DAY.atTime(14, 5)).replace('\u202f', ' '))
    }

    @Test
    fun aCountOfDrinksIsInThePhonesNumberFormat() {
        assertEquals("1,250", uk.count(1_250))
        assertEquals("0", uk.count(0))
    }

    @Test
    fun daysAreTodayYesterdayOrADate() {
        assertEquals("Today", uk.dayName(THE_DAY, THE_DAY))
        assertEquals("Yesterday", uk.dayName(THE_DAY.minusDays(1), THE_DAY))
        assertEquals("Wed 11 Nov", uk.dayName(THE_DAY.minusDays(2), THE_DAY))
        assertEquals("Wednesday 11 November", uk.dayNameSpoken(THE_DAY.minusDays(2), THE_DAY))
        assertEquals("Today", uk.dayTitle(THE_DAY, isToday = true))
        assertEquals("Wednesday, 11 November 2026", uk.dayTitle(THE_DAY.minusDays(2), isToday = false))
    }

    @Test
    fun theSixIntervalsHaveTheirWords() {
        assertEquals(
            listOf("30 minutes", "45 minutes", "1 hour", "1 hour 30 minutes", "2 hours", "3 hours"),
            SettingsRules.INTERVALS.map(uk::interval),
        )
    }
}
