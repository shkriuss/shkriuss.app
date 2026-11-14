package app.shkriuss.feature.water

import kotlin.math.roundToInt

/**
 * The two units of Water (docs/apps/water/spec.md, "Units"). Every amount
 * is stored in whole millilitres. The unit changes only what is shown and
 * how amounts are typed.
 */
enum class WaterUnit(
    /** The value stored in `settings.unit` and in a backup. */
    val code: Int,
    /** The three quick amounts that are the defaults in this unit, in millilitres. */
    val defaultQuickAmountsMl: List<Int>,
) {
    /** Millilitres (ml), the default. */
    MILLILITRES(0, listOf(150, 250, 500)),

    /** US fluid ounces (fl oz): 5, 8 and 16 fl oz. */
    US_FLUID_OUNCES(1, listOf(148, 237, 473)),
    ;

    /** [millilitres] as a whole number in this unit, rounded to the nearest: 2,000 ml is 68 fl oz. */
    fun shown(millilitres: Int): Int = when (this) {
        MILLILITRES -> millilitres
        US_FLUID_OUNCES -> (millilitres / MILLILITRES_PER_US_FLUID_OUNCE).roundToInt()
    }

    /** A whole [amount] typed in this unit, in whole millilitres, rounded to the nearest: 8 fl oz is 237 ml. */
    fun toMillilitres(amount: Int): Int = when (this) {
        MILLILITRES -> amount
        US_FLUID_OUNCES -> (amount * MILLILITRES_PER_US_FLUID_OUNCE).roundToInt()
    }

    /** What may be typed for one drink or one quick amount, in this unit: 1 to 3,000 ml, or 1 to 101 fl oz. */
    val drinkLimits: IntRange
        get() = limitsOf(Amounts.DRINK_ML)

    /** What may be typed for the daily goal, in this unit: 500 to 10,000 ml, or 17 to 338 fl oz. */
    val goalLimits: IntRange
        get() = limitsOf(Amounts.GOAL_ML)

    /** The whole amounts in this unit that turn into millilitres inside [millilitres]. */
    private fun limitsOf(millilitres: IntRange): IntRange = when (this) {
        MILLILITRES -> millilitres
        US_FLUID_OUNCES -> {
            var low = shown(millilitres.first)
            if (toMillilitres(low) < millilitres.first) low++
            var high = shown(millilitres.last)
            if (toMillilitres(high) > millilitres.last) high--
            low..high
        }
    }

    /** The unit of a stored code. */
    companion object {
        /** 1 US fluid ounce in millilitres, exactly. */
        const val MILLILITRES_PER_US_FLUID_OUNCE: Double = 29.5735295625

        /** The unit with [code], or null for a code that is not 0 or 1. */
        fun ofCode(code: Int): WaterUnit? = entries.firstOrNull { it.code == code }
    }
}

/** The limits of the stored amounts, in millilitres (spec, "Data model"). */
object Amounts {
    /** One drink and one quick amount. */
    val DRINK_ML: IntRange = 1..3_000

    /** The daily goal. */
    val GOAL_ML: IntRange = 500..10_000

    /**
     * The share of [goalMl] that [totalMl] is, in percent, rounded down. It
     * can pass 100: 1,250 of 2,000 ml is 62.
     */
    fun percent(totalMl: Int, goalMl: Int): Int = (totalMl.toLong() * 100 / goalMl).toInt()
}

/**
 * Reads what the user typed into an amount field. Whole numbers only. The
 * limits are those of the unit shown, so the field's message names them
 * in that unit.
 */
object AmountInput {
    /**
     * The amount in millilitres that [text] holds in [unit], or null if it
     * is empty, not a whole number, or outside [limits] (in [unit]).
     */
    fun millilitres(text: String, unit: WaterUnit, limits: IntRange): Int? {
        val amount = text.trim().takeIf { typed -> typed.isNotEmpty() && typed.all { it in '0'..'9' } }
            ?.toIntOrNull() ?: return null
        return if (amount in limits) unit.toMillilitres(amount) else null
    }

    /** What an amount field shows for [millilitres] in [unit], as the user would type it. */
    fun textOf(millilitres: Int, unit: WaterUnit): String = unit.shown(millilitres).toString()
}
