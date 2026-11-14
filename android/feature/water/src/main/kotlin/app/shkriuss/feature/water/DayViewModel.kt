package app.shkriuss.feature.water

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.time.LocalDate
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus

/**
 * What the screens Today and Day show (docs/apps/water/spec.md, "Today"
 * and "Day"). Amounts are millilitres; the screen shows them in [unit].
 */
data class DayScreen(
    /** False until the first read of the database is in. */
    val loaded: Boolean,
    /** The day shown. */
    val day: LocalDate,
    /** True if [day] is today. */
    val isToday: Boolean,
    /** The unit amounts are shown in. */
    val unit: WaterUnit = WaterUnit.MILLILITRES,
    /** The total of [day]. */
    val totalMl: Int = 0,
    /** The goal of [day], as that day had it. */
    val goalMl: Int = GoalRules.DEFAULT_GOAL_ML,
    /** The drinks of [day], newest first. */
    val drinks: List<Drink> = emptyList(),
    /** The three quick amounts of Today. */
    val quickAmountsMl: List<Int> = WaterUnit.MILLILITRES.defaultQuickAmountsMl,
    /** The sheet "Add a drink" or "Edit drink", while it is open. */
    val sheet: DrinkSheet? = null,
    /** The snackbar after a new drink or a delete, with Undo, while it shows. */
    val snackbar: DrinkSnackbar? = null,
) {
    /** The total as a share of the goal, in percent, rounded down. It can pass 100. */
    val percent: Int
        get() = Amounts.percent(totalMl, goalMl)

    /** True once the total reaches the goal: the screen shows "Goal reached". */
    val goalReached: Boolean
        get() = totalMl >= goalMl
}

/**
 * The sheet "Add a drink" ([drinkId] null) or "Edit drink"
 * (docs/apps/water/spec.md, "Add a drink and edit a drink"). It keeps what
 * the user typed while the phone is turned.
 */
data class DrinkSheet(
    /** The drink being edited, or null when a drink is added. */
    val drinkId: String?,
    /** The day of the drink. It cannot be changed. */
    val day: LocalDate,
    /** The amount field, in the unit shown. Empty at the start of "Add a drink". */
    val amountText: String,
    /** The time row, in minutes after midnight. */
    val minuteOfDay: Int,
    /** True after a Save with an amount outside 1 to 3,000 ml (1 to 101 fl oz): the field says so under it. */
    val amountError: Boolean = false,
    /** True while the time is later than now on today: the time row says "That time has not come yet." */
    val timeError: Boolean = false,
    /** What the amount field showed when the sheet opened. */
    val openedText: String = amountText,
    /** The time when the sheet opened. */
    val openedMinute: Int = minuteOfDay,
    /** The stored amount of the drink being edited, in millilitres. */
    val storedAmountMl: Int? = null,
) {
    /** True for "Edit drink", which also offers Delete. */
    val isEdit: Boolean
        get() = drinkId != null
}

/** The snackbar after a change of one drink, with Undo. */
data class DrinkSnackbar(
    /** Which change it tells of. */
    val kind: Kind,
    /** The drink that Undo changes back. */
    val drinkId: String,
    /** The amount of that drink, in millilitres, for "Added 250 ml". */
    val amountMl: Int,
) {
    /** The two snackbars of a day. */
    enum class Kind {
        /** "Added 250 ml". Undo marks the drink as deleted. */
        ADDED,

        /** "Drink deleted". Undo brings the drink back. */
        DELETED,
    }
}

/**
 * The ViewModel of Today ([fixedDay] null) and of one Day of History.
 * Today follows the phone's clock: at midnight it moves to the new day by
 * itself, and [checkTheDay] moves it when the screen comes to the front.
 *
 * Every change runs in [work] on top of the ViewModel's scope. Tests pass
 * `Dispatchers.Unconfined`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DayViewModel(
    private val repository: WaterRepository,
    private val time: WaterTime,
    private val fixedDay: LocalDate? = null,
    private val work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    private val day = MutableStateFlow(fixedDay ?: time.today())
    private val sheet = MutableStateFlow<DrinkSheet?>(null)
    private val snackbar = MutableStateFlow<DrinkSnackbar?>(null)

    /** What the screen shows. */
    val state: StateFlow<DayScreen> = combine(
        day.flatMapLatest { shown -> repository.drinksOf(shown).map { shown to it } },
        repository.settings(),
        repository.goals(),
        sheet,
        snackbar,
    ) { (shown, drinks), settings, goals, openSheet, shownSnackbar ->
        DayScreen(
            loaded = true,
            day = shown,
            isToday = shown == time.today(),
            unit = settings.unit,
            totalMl = drinks.sumOf { it.amountMl },
            goalMl = goals.goalOf(shown.asWaterDay()),
            drinks = drinks,
            quickAmountsMl = settings.quickAmountsMl,
            sheet = openSheet,
            snackbar = shownSnackbar,
        )
    }.stateIn(viewModelScope + work, SharingStarted.Eagerly, DayScreen(loaded = false, day = day.value, isToday = fixedDay == null))

    init {
        if (fixedDay == null) {
            viewModelScope.launch(work) {
                while (isActive) {
                    delay(time.millisToNextDay())
                    checkTheDay()
                }
            }
        }
    }

    /** Today moves to the new day after midnight. The screen calls it each time it comes to the front. */
    fun checkTheDay() {
        if (fixedDay == null) day.value = time.today()
    }

    /** A tap on quick amount number [index] (0 to 2): a drink of that amount, now. */
    fun addQuick(index: Int) {
        val screen = state.value
        if (!screen.loaded) return
        val amount = screen.quickAmountsMl[index]
        val now = time.now()
        add(now.toLocalDate(), now.hour * 60 + now.minute, amount)
    }

    /** "Other amount" on Today, or "Add a drink" on a Day: the sheet, empty, at now on today and at 12:00 on another day. */
    fun openAdd() {
        val shown = day.value
        val minute = if (shown == time.today()) time.minuteNow() else NOON
        sheet.value = DrinkSheet(drinkId = null, day = shown, amountText = "", minuteOfDay = minute)
    }

    /** A tap on a drink's row: the sheet, filled in with the drink. */
    fun openEdit(drink: Drink) {
        val text = AmountInput.textOf(drink.amountMl, state.value.unit)
        sheet.value = DrinkSheet(
            drinkId = drink.id,
            day = drink.day,
            amountText = text,
            minuteOfDay = drink.minuteOfDay,
            storedAmountMl = drink.amountMl,
        )
    }

    /** The user typed in the amount field. A shown error follows what is typed. */
    fun onAmountChange(text: String) {
        sheet.value = sheet.value?.let { open ->
            open.copy(amountText = text, amountError = open.amountError && amountOf(open.copy(amountText = text)) == null)
        }
    }

    /** The user picked a time. On today, a time later than now is named at once. */
    fun onTimeChange(minuteOfDay: Int) {
        sheet.value = sheet.value?.let { open ->
            open.copy(minuteOfDay = minuteOfDay, timeError = isInTheFuture(open.day, minuteOfDay))
        }
    }

    /**
     * Save in the sheet. It closes the sheet and writes the drink, unless
     * the amount or the time is refused: then it does nothing but name
     * them. With no change it closes the sheet and writes nothing.
     */
    fun save() {
        val open = sheet.value ?: return
        if (open.isEdit && open.amountText == open.openedText && open.minuteOfDay == open.openedMinute) {
            sheet.value = null
            return
        }
        val amount = amountOf(open)
        val future = isInTheFuture(open.day, open.minuteOfDay)
        if (amount == null || future) {
            sheet.value = open.copy(amountError = amount == null, timeError = future)
            return
        }
        sheet.value = null
        val id = open.drinkId
        if (id == null) {
            add(open.day, open.minuteOfDay, amount)
        } else {
            viewModelScope.launch(work) { repository.changeDrink(id, open.minuteOfDay, amount) }
        }
    }

    /** Cancel in the sheet: it closes and nothing is written. */
    fun cancel() {
        sheet.value = null
    }

    /** Delete in "Edit drink": the sheet closes, the drink is marked as deleted, and the snackbar offers Undo. */
    fun delete() {
        val id = sheet.value?.drinkId ?: return
        sheet.value = null
        viewModelScope.launch(work) {
            repository.deleteDrink(id)?.let { snackbar.value = DrinkSnackbar(DrinkSnackbar.Kind.DELETED, it.id, it.amountMl) }
        }
    }

    /** Undo in the snackbar: a new drink is marked as deleted, a deleted drink comes back. */
    fun undo() {
        val shown = snackbar.value ?: return
        snackbar.value = null
        viewModelScope.launch(work) {
            when (shown.kind) {
                DrinkSnackbar.Kind.ADDED -> repository.deleteDrink(shown.drinkId)
                DrinkSnackbar.Kind.DELETED -> repository.bringBackDrink(shown.drinkId)
            }
        }
    }

    /** The snackbar went away without Undo. */
    fun snackbarDismissed() {
        snackbar.value = null
    }

    private fun add(on: LocalDate, minuteOfDay: Int, amountMl: Int) {
        viewModelScope.launch(work) {
            val drink = repository.addDrink(on, minuteOfDay, amountMl)
            snackbar.value = DrinkSnackbar(DrinkSnackbar.Kind.ADDED, drink.id, drink.amountMl)
        }
    }

    /** The amount the sheet holds in millilitres, or null if it is refused. An edit that kept the text keeps the stored amount. */
    private fun amountOf(open: DrinkSheet): Int? {
        if (open.storedAmountMl != null && open.amountText == open.openedText) return open.storedAmountMl
        val unit = state.value.unit
        return AmountInput.millilitres(open.amountText, unit, unit.drinkLimits)
    }

    private fun isInTheFuture(on: LocalDate, minuteOfDay: Int): Boolean = on == time.today() && minuteOfDay > time.minuteNow()

    private companion object {
        /** Where the time of a drink starts on a day that is not today: 12:00. */
        const val NOON = 12 * 60
    }
}
