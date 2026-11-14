package app.shkriuss.feature.water

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shkriuss.feature.water.data.DayTotal
import java.time.LocalDate
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus

/** One row of History: one day, its total and the goal it had. */
data class HistoryDay(
    /** The day. */
    val day: LocalDate,
    /** The total of the day, in millilitres. 0 for a day with no drink. */
    val totalMl: Int,
    /** The goal of the day, as it had it, in millilitres. */
    val goalMl: Int,
) {
    /** True if the goal was met: the row shows "Goal reached". */
    val goalReached: Boolean
        get() = totalMl >= goalMl
}

/** What History shows (docs/apps/water/spec.md, "History"). */
data class HistoryScreen(
    /** False until the first read of the database is in. */
    val loaded: Boolean,
    /** Today, so that the screen can say "Today" and "Yesterday". */
    val today: LocalDate,
    /** The unit amounts are shown in. */
    val unit: WaterUnit = WaterUnit.MILLILITRES,
    /** Every day from the day of the first drink to today, newest first, days with no drink too. */
    val days: List<HistoryDay> = emptyList(),
    /** The day that is open, or null. It stays open when the user switches to another destination and back. */
    val openDay: LocalDate? = null,
) {
    /** True with no drink ever: "No history yet. The drinks you log show here." */
    val isEmpty: Boolean
        get() = loaded && days.isEmpty()
}

/**
 * The ViewModel of History. The open day is shown by a [DayViewModel] of
 * its own. At midnight the list gains the new day by itself.
 */
class HistoryViewModel(
    private val repository: WaterRepository,
    private val time: WaterTime,
    private val work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    private val today = MutableStateFlow(time.today())
    private val openDay = MutableStateFlow<LocalDate?>(null)

    /** What the screen shows. */
    val state: StateFlow<HistoryScreen> = combine(
        repository.dayTotals(),
        repository.goals(),
        repository.settings(),
        today,
        openDay,
    ) { totals, goals, settings, shownToday, open ->
        HistoryScreen(
            loaded = true,
            today = shownToday,
            unit = settings.unit,
            days = rowsOf(totals, goals, shownToday),
            openDay = open,
        )
    }.stateIn(viewModelScope + work, SharingStarted.Eagerly, HistoryScreen(loaded = false, today = today.value))

    init {
        viewModelScope.launch(work) {
            while (isActive) {
                delay(time.millisToNextDay())
                checkTheDay()
            }
        }
    }

    /** The list gains the new day after midnight. The screen calls it each time it comes to the front. */
    fun checkTheDay() {
        today.value = time.today()
    }

    /** A tap on a row: that day opens. */
    fun open(day: LocalDate) {
        openDay.value = day
    }

    /** Back from an open day: the list, at the same place. */
    fun close() {
        openDay.value = null
    }

    /** The rows of History, newest first. */
    internal companion object {
        /**
         * Every day from the first day with a drink to [today], newest first,
         * with its total and its goal. With no drink ever, no row. Drinks
         * on a day after today, which only a clock set back can leave, are
         * not shown.
         */
        fun rowsOf(totals: List<DayTotal>, goals: GoalRules.Timeline, today: LocalDate): List<HistoryDay> {
            val first = totals.minOfOrNull { it.day } ?: return emptyList()
            val last = today.asWaterDay()
            val byDay = totals.associate { it.day to it.totalMl }
            return (last downTo minOf(first, last)).map { day ->
                HistoryDay(waterDayDate(day), byDay[day] ?: 0, goals.goalOf(day))
            }
        }
    }
}
