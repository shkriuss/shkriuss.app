package app.shkriuss.feature.water

import app.shkriuss.feature.water.WaterUnit.MILLILITRES
import app.shkriuss.feature.water.WaterUnit.US_FLUID_OUNCES
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Units, rounding, limits and the percentage (docs/apps/water/spec.md, "Units"). */
class UnitsTest {
    @Test
    fun millilitresAreShownAsTheyAreStored() {
        assertEquals(1_250, MILLILITRES.shown(1_250))
        assertEquals(1_250, MILLILITRES.toMillilitres(1_250))
    }

    @Test
    fun fluidOuncesAreRoundedToTheNearestWholeUnitBothWays() {
        // 2,000 ml shows as 68 fl oz. 8 fl oz is stored as 237 ml, and shows as 8 fl oz again.
        assertEquals(68, US_FLUID_OUNCES.shown(2_000))
        assertEquals(237, US_FLUID_OUNCES.toMillilitres(8))
        assertEquals(8, US_FLUID_OUNCES.shown(237))
        assertEquals(250, MILLILITRES.shown(US_FLUID_OUNCES.toMillilitres(8) + 13))
    }

    @Test
    fun everyAmountTypedInFluidOuncesShowsAsTypedAgain() {
        for (ounces in 1..338) assertEquals(ounces, US_FLUID_OUNCES.shown(US_FLUID_OUNCES.toMillilitres(ounces)))
    }

    @Test
    fun theLimitsInEachUnitAreThoseOfTheSpec() {
        assertEquals(1..3_000, MILLILITRES.drinkLimits)
        assertEquals(500..10_000, MILLILITRES.goalLimits)
        assertEquals(1..101, US_FLUID_OUNCES.drinkLimits)
        assertEquals(17..338, US_FLUID_OUNCES.goalLimits)
        // Every amount inside the limits in fluid ounces is inside the stored limits in millilitres.
        assertEquals(true, US_FLUID_OUNCES.drinkLimits.all { US_FLUID_OUNCES.toMillilitres(it) in Amounts.DRINK_ML })
        assertEquals(true, US_FLUID_OUNCES.goalLimits.all { US_FLUID_OUNCES.toMillilitres(it) in Amounts.GOAL_ML })
    }

    @Test
    fun theDefaultQuickAmountsAreThoseOfTheSpec() {
        assertEquals(listOf(150, 250, 500), MILLILITRES.defaultQuickAmountsMl)
        assertEquals(listOf(148, 237, 473), US_FLUID_OUNCES.defaultQuickAmountsMl)
        assertEquals(listOf(5, 8, 16), US_FLUID_OUNCES.defaultQuickAmountsMl.map(US_FLUID_OUNCES::shown))
    }

    @Test
    fun theStoredCodesAreZeroAndOne() {
        assertEquals(MILLILITRES, WaterUnit.ofCode(0))
        assertEquals(US_FLUID_OUNCES, WaterUnit.ofCode(1))
        assertNull(WaterUnit.ofCode(2))
    }

    @Test
    fun thePercentageIsRoundedDownAndCanPassOneHundred() {
        assertEquals(62, Amounts.percent(1_250, 2_000))
        assertEquals(99, Amounts.percent(1_999, 2_000))
        assertEquals(100, Amounts.percent(2_000, 2_000))
        assertEquals(150, Amounts.percent(3_000, 2_000))
        assertEquals(0, Amounts.percent(0, 2_000))
    }

    @Test
    fun anAmountFieldTakesWholeNumbersInsideTheLimitsOfTheUnitShown() {
        val drink = MILLILITRES.drinkLimits
        assertEquals(250, AmountInput.millilitres("250", MILLILITRES, drink))
        assertEquals(250, AmountInput.millilitres(" 250 ", MILLILITRES, drink))
        assertNull(AmountInput.millilitres("", MILLILITRES, drink))
        assertNull(AmountInput.millilitres("0", MILLILITRES, drink))
        assertNull(AmountInput.millilitres("3001", MILLILITRES, drink))
        assertNull(AmountInput.millilitres("2.5", MILLILITRES, drink))
        assertNull(AmountInput.millilitres("-5", MILLILITRES, drink))
        assertNull(AmountInput.millilitres("1,000", MILLILITRES, drink))
        assertNull(AmountInput.millilitres("99999999999", MILLILITRES, drink))
        assertEquals(237, AmountInput.millilitres("8", US_FLUID_OUNCES, US_FLUID_OUNCES.drinkLimits))
        assertNull(AmountInput.millilitres("102", US_FLUID_OUNCES, US_FLUID_OUNCES.drinkLimits))
        assertEquals("8", AmountInput.textOf(237, US_FLUID_OUNCES))
        assertEquals("237", AmountInput.textOf(237, MILLILITRES))
    }
}
