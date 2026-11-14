package app.shkriuss.feature.water

import androidx.room3.withWriteTransaction
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.feature.water.data.DayTotal
import app.shkriuss.feature.water.data.GoalEntity
import app.shkriuss.feature.water.data.IntakeEntity
import app.shkriuss.feature.water.data.SettingsEntity
import app.shkriuss.feature.water.data.WaterDatabase
import java.time.LocalDate
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/** One drink, as the screens show it. */
data class Drink(
    /** The record's ID. */
    val id: String,
    /** The day of the drink. It never changes. */
    val day: LocalDate,
    /** The time, in minutes after midnight. */
    val minuteOfDay: Int,
    /** The amount, in millilitres. */
    val amountMl: Int,
)

/** What one day holds: its total, its goal, and the time of its latest drink. */
data class DayFacts(
    /** The total of the day's drinks that are not deleted, in millilitres. */
    val totalMl: Int,
    /** The goal of the day, in millilitres. */
    val goalMl: Int,
    /** The latest time among the day's drinks, in minutes after midnight, or null with no drink. */
    val latestDrinkMinute: Int?,
) {
    /** True once the total reaches the goal. */
    val goalMet: Boolean
        get() = totalMl >= goalMl
}

/**
 * The drinks, the goals and the settings of Water. Every write goes
 * through one `RecordWriter` per table, so it is stamped, gets a change
 * number and never removes a row (docs/architecture/data.md). Every read
 * that shows records leaves deleted ones out.
 *
 * Step 2.4 calls `notify.sync()` after every write here that can move the
 * alarm.
 */
class WaterRepository(private val database: WaterDatabase, clock: Clock, ids: IdSource) {
    private val intake = database.intake()
    private val goals = database.goals()
    private val settings = database.settings()
    private val drinkWriter = RecordWriter(database, intake, clock, ids)
    private val goalWriter = RecordWriter(database, goals, clock, ids)
    private val settingsWriter = RecordWriter(database, settings, clock, ids)

    /** The drinks of [day], newest first. */
    fun drinksOf(day: LocalDate): Flow<List<Drink>> =
        intake.observeDay(day.asWaterDay()).map { rows -> rows.map(::drinkOf) }

    /** The total of every day that has a drink. Days without one are not in it. */
    fun dayTotals(): Flow<List<DayTotal>> = intake.observeTotals()

    /** The goals that are not deleted, ready to give the goal of any day. */
    fun goals(): Flow<GoalRules.Timeline> = goals.observeLive().map(GoalRules::Timeline)

    /** The settings in use: those of the newest settings record, or the defaults. */
    fun settings(): Flow<WaterSettings> =
        settings.observeLive().map { SettingsRules.settingsOf(SettingsRules.inUse(it)) }.distinctUntilChanged()

    /** The total, the goal and the latest drink of [day], read once. For the rule of the next reminder. */
    suspend fun factsOf(day: LocalDate): DayFacts {
        val number = day.asWaterDay()
        return DayFacts(
            totalMl = intake.totalOf(number),
            goalMl = GoalRules.goalOf(number, goals.live()),
            latestDrinkMinute = intake.latestMinuteOf(number),
        )
    }

    /** Logs a drink of [amountMl] on [day] at [minuteOfDay]. */
    suspend fun addDrink(day: LocalDate, minuteOfDay: Int, amountMl: Int): Drink {
        requireDrink(minuteOfDay, amountMl)
        val stored = drinkWriter.create { fields, number ->
            IntakeEntity(fields, number, amountMl = amountMl, day = day.asWaterDay(), minuteOfDay = minuteOfDay)
        }
        return drinkOf(stored)
    }

    /**
     * Changes the time and the amount of the drink with [id]. Its day never
     * changes. Nothing is written if both are as they were. Null if there is
     * no such drink, or it is deleted.
     */
    suspend fun changeDrink(id: String, minuteOfDay: Int, amountMl: Int): Drink? {
        requireDrink(minuteOfDay, amountMl)
        return drinkWriter.update(id) { it.copy(minuteOfDay = minuteOfDay, amountMl = amountMl) }?.let(::drinkOf)
    }

    /** Marks the drink with [id] as deleted. The row stays. Null if there is none to delete. */
    suspend fun deleteDrink(id: String): Drink? = drinkWriter.markDeleted(id)?.let(::drinkOf)

    /** Brings back the deleted drink with [id], as Undo does. Null if there is none to bring back. */
    suspend fun bringBackDrink(id: String): Drink? = drinkWriter.restore(id)?.let(::drinkOf)

    /**
     * Sets the daily goal to [amountMl] from [today] on. Past days keep
     * theirs ([GoalRules.change]).
     */
    suspend fun setGoal(today: LocalDate, amountMl: Int) {
        require(amountMl in Amounts.GOAL_ML) { "A goal is from 500 to 10,000 ml" }
        val day = today.asWaterDay()
        database.withWriteTransaction {
            when (val change = GoalRules.change(day, amountMl, goals.live())) {
                GoalChange.NoChange -> Unit
                is GoalChange.Update -> goalWriter.update(change.id) { it.copy(amountMl = amountMl) }
                GoalChange.Create -> goalWriter.create { fields, number ->
                    GoalEntity(fields, number, amountMl = amountMl, fromDay = day)
                }
            }
        }
    }

    /**
     * Changes the settings in use with [change], and returns them. The first
     * change creates the settings record, with the defaults and that change.
     * Every later change updates the record in use. Water never deletes one
     * (spec, "The settings in use").
     */
    suspend fun changeSettings(change: (WaterSettings) -> WaterSettings): WaterSettings =
        database.withWriteTransaction {
            val record = SettingsRules.inUse(settings.live())
            val current = SettingsRules.settingsOf(record)
            val next = change(current)
            require(SettingsRules.isValid(next)) { "A setting is outside its limits" }
            when {
                next == current -> Unit
                record == null -> settingsWriter.create { fields, number ->
                    SettingsRules.recordWith(SettingsEntity(fields, number, 0, 0, 0, 0, false, 0, 0, 0), next)
                }
                else -> settingsWriter.update(record.record.id) { SettingsRules.recordWith(it, next) }
            }
            next
        }

    private fun requireDrink(minuteOfDay: Int, amountMl: Int) {
        require(amountMl in Amounts.DRINK_ML) { "A drink is from 1 to 3,000 ml" }
        require(minuteOfDay in 0..SettingsRules.LAST_MINUTE) { "A time is a minute of the day" }
    }

    private fun drinkOf(row: IntakeEntity) = Drink(row.record.id, waterDayDate(row.day), row.minuteOfDay, row.amountMl)
}
