package app.shkriuss.feature.water

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.time.LocalDate
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.launch

/**
 * What the screens Today and Day show (docs/apps/water/spec.md, "Today"
 * and "Day"). Amounts are millilitres; the screen shows them in [unit].
 */
data class DayScreen(
    /**
     * False until the drinks of [day] are read: at the start, and again
     * from the moment the day changes until the new day's drinks are in.
     * So a screen never shows one day with another day's numbers.
     */
    val loaded: Boolean,
    /** The day shown. */
    val day: LocalDate,
    /** True if [day] is today. It follows the date, also while [day] stays the same. */
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
 * The ViewModel of Today ([fixedDay] null) and of the open Day of History.
 * Today shows the date of [today], the one source of today's date: it
 * moves to the new day when that date changes. The open Day starts at
 * [fixedDay], and [show] moves it to the day that History opens, so one
 * ViewModel serves every day opened. Its day stays the one opened, and
 * only whether it is today follows [today].
 *
 * Every change runs in [work] on top of the ViewModel's scope. Tests pass
 * `Dispatchers.Unconfined`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DayViewModel(
    private val repository: WaterRepository,
    private val time: WaterTime,
    private val today: WaterToday,
    private val fixedDay: LocalDate? = null,
    private val work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    private val day = MutableStateFlow(fixedDay ?: today.date.value)
    private val sheet = MutableStateFlow<DrinkSheet?>(null)
    private val snackbar = MutableStateFlow<DrinkSnackbar?>(null)
    private val screen = MutableStateFlow(notLoaded(day.value))

    /** Guards [day] and [screen] together, so a late result of another day never replaces the one shown. */
    private val dayLock = Any()

    /**
     * What the screen shows. It is always of the day asked for last: from
     * the moment that day changes until its drinks are read, it is that day,
     * not loaded.
     */
    val state: StateFlow<DayScreen> = screen.asStateFlow()

    /** Every state of the database for the day asked for, in the order Room gives them. */
    private val fromTheDatabase = combine(
        // A new day starts with no drinks read, so the day before is never shown in its place.
        day.flatMapLatest { shown ->
            repository.drinksOf(shown)
                .map<List<Drink>, DrinksOfDay> { DrinksOfDay(shown, it) }
                .onStart { emit(DrinksOfDay(shown, drinks = null)) }
        },
        repository.settings(),
        repository.goals(),
        combine(sheet, snackbar, ::Pair),
        today.date,
    ) { ofDay, settings, goals, (openSheet, shownSnackbar), dateToday ->
        val shown = ofDay.day
        val drinks = ofDay.drinks
        DayScreen(
            loaded = drinks != null,
            day = shown,
            isToday = isToday(shown, dateToday),
            unit = settings.unit,
            totalMl = drinks.orEmpty().sumOf { it.amountMl },
            goalMl = goals.goalOf(shown.asWaterDay()),
            drinks = drinks.orEmpty(),
            quickAmountsMl = settings.quickAmountsMl,
            sheet = openSheet,
            snackbar = shownSnackbar,
        )
    }

    init {
        viewModelScope.launch(work) {
            fromTheDatabase.collect { next ->
                // A result for a day asked for before is late: it is dropped.
                synchronized(dayLock) { if (next.day == day.value) screen.value = next }
            }
        }
        // Today moves to the new day when the date changes: at midnight, or after a change of the clock or the time zone.
        if (fixedDay == null) viewModelScope.launch(work) { today.date.collect { day.value = it } }
    }

    /** Today's screen is today by what it is. An open Day is today while the date is its day. */
    private fun isToday(shown: LocalDate, dateToday: LocalDate): Boolean = fixedDay == null || shown == dateToday

    /**
     * The open Day of History shows [shown] from now on. Until its drinks
     * are read, the state is not loaded: nothing of the day before shows
     * in its place. The sheet and the snackbar of the day before close.
     * Today follows the phone's clock, so it refuses this.
     */
    fun show(shown: LocalDate) {
        check(fixedDay != null) { "Today follows the phone's clock" }
        synchronized(dayLock) {
            if (day.value == shown) return
            sheet.value = null
            snackbar.value = null
            day.value = shown
            // Unless the new day already shows, it shows as not loaded from now on.
            if (screen.value.day != shown) screen.value = notLoaded(shown, screen.value)
        }
    }

    /** [shown] with none of its drinks read yet, in the unit and with the quick amounts of [before]. */
    private fun notLoaded(shown: LocalDate, before: DayScreen? = null) = DayScreen(
        loaded = false,
        day = shown,
        isToday = isToday(shown, today.date.value),
        unit = before?.unit ?: WaterUnit.MILLILITRES,
        quickAmountsMl = before?.quickAmountsMl ?: WaterUnit.MILLILITRES.defaultQuickAmountsMl,
    )

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

    /** The drinks of [day], or null while they are not read yet. */
    private data class DrinksOfDay(val day: LocalDate, val drinks: List<Drink>?)

    private companion object {
        /** Where the time of a drink starts on a day that is not today: 12:00. */
        const val NOON = 12 * 60
    }
}
