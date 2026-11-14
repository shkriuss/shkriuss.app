package app.shkriuss.feature.water

import app.shkriuss.feature.water.data.SettingsEntity

/**
 * The settings of Water that are part of the user's data
 * (docs/apps/water/spec.md, "Table settings" and "Settings"). Times are
 * minutes after midnight. Amounts are millilitres.
 */
data class WaterSettings(
    /** The unit amounts are shown and typed in. */
    val unit: WaterUnit = WaterUnit.MILLILITRES,
    /** The first quick amount. A reminder's Drank button adds it. */
    val cup1Ml: Int = WaterUnit.MILLILITRES.defaultQuickAmountsMl[0],
    /** The second quick amount. */
    val cup2Ml: Int = WaterUnit.MILLILITRES.defaultQuickAmountsMl[1],
    /** The third quick amount. */
    val cup3Ml: Int = WaterUnit.MILLILITRES.defaultQuickAmountsMl[2],
    /** "Remind me to drink". */
    val remindersOn: Boolean = false,
    /** "Every": one of [SettingsRules.INTERVALS]. */
    val intervalMinutes: Int = 60,
    /** "From": 08:00. */
    val fromMinute: Int = 8 * 60,
    /** "Until": 22:00. */
    val untilMinute: Int = 22 * 60,
) {
    /** The three quick amounts, first to third. */
    val quickAmountsMl: List<Int>
        get() = listOf(cup1Ml, cup2Ml, cup3Ml)

    /** False when "From" + 1 interval is after "Until": then no reminder fits on any day, and Settings says so. */
    val reminderFits: Boolean
        get() = fromMinute + intervalMinutes <= untilMinute
}

/**
 * Which settings are in use, and the rules of a change
 * (docs/apps/water/spec.md, "The settings in use", ADR 0036).
 */
object SettingsRules {
    /** The six choices of "Every", in minutes. */
    val INTERVALS: List<Int> = listOf(30, 45, 60, 90, 120, 180)

    /** The reminder hours are at least this long: "Until" is at least 30 minutes after "From". */
    const val SHORTEST_HOURS_MINUTES: Int = 30

    /** The last minute of a day, 23:59. */
    const val LAST_MINUTE: Int = 24 * 60 - 1

    /** The latest "From": 23:29. */
    const val LATEST_FROM: Int = LAST_MINUTE - SHORTEST_HOURS_MINUTES

    /**
     * The settings record in use: not deleted, with the latest `updatedAt`.
     * Of two with the same `updatedAt`, which only a restore or sync can
     * bring, the larger `id` counts until step 5.1 decides (spec, "Open",
     * item 7). Null if there is none: then the defaults count.
     */
    fun inUse(records: List<SettingsEntity>): SettingsEntity? =
        records.filter { it.record.deletedAt == null }
            .maxWithOrNull(compareBy<SettingsEntity>({ it.record.updatedAt }, { it.record.id }))

    /** The settings that [record] holds, or the defaults for null. */
    fun settingsOf(record: SettingsEntity?): WaterSettings = record?.let {
        WaterSettings(
            unit = WaterUnit.ofCode(it.unit) ?: WaterUnit.MILLILITRES,
            cup1Ml = it.cup1Ml,
            cup2Ml = it.cup2Ml,
            cup3Ml = it.cup3Ml,
            remindersOn = it.remindersOn,
            intervalMinutes = it.intervalMinutes,
            fromMinute = it.fromMinute,
            untilMinute = it.untilMinute,
        )
    } ?: WaterSettings()

    /** [record] with the values of [settings]. Its record fields and change number stay. */
    fun recordWith(record: SettingsEntity, settings: WaterSettings): SettingsEntity = record.copy(
        unit = settings.unit.code,
        cup1Ml = settings.cup1Ml,
        cup2Ml = settings.cup2Ml,
        cup3Ml = settings.cup3Ml,
        remindersOn = settings.remindersOn,
        intervalMinutes = settings.intervalMinutes,
        fromMinute = settings.fromMinute,
        untilMinute = settings.untilMinute,
    )

    /**
     * [settings] in [unit]. When all three quick amounts are still the
     * defaults of the old unit, they become the defaults of the new one.
     * Amounts the user chose stay as they are (spec, "Units", point 9).
     */
    fun withUnit(settings: WaterSettings, unit: WaterUnit): WaterSettings {
        if (unit == settings.unit) return settings
        val amounts = if (settings.quickAmountsMl == settings.unit.defaultQuickAmountsMl) {
            unit.defaultQuickAmountsMl
        } else {
            settings.quickAmountsMl
        }
        return settings.copy(unit = unit, cup1Ml = amounts[0], cup2Ml = amounts[1], cup3Ml = amounts[2])
    }

    /** True if "From" at [fromMinute] and "Until" at [untilMinute] may be stored: Until is at least 30 minutes after From, on the same day. */
    fun hoursAllowed(fromMinute: Int, untilMinute: Int): Boolean =
        fromMinute in 0..LATEST_FROM && untilMinute in (fromMinute + SHORTEST_HOURS_MINUTES)..LAST_MINUTE

    /** True if every value of [settings] is inside its limits. */
    fun isValid(settings: WaterSettings): Boolean =
        settings.quickAmountsMl.all { it in Amounts.DRINK_ML } &&
            settings.intervalMinutes in INTERVALS &&
            hoursAllowed(settings.fromMinute, settings.untilMinute)
}
