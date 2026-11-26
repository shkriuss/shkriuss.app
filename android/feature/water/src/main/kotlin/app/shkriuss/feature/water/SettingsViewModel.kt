package app.shkriuss.feature.water

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus

/**
 * What the sections "Drinking" and "Reminders" of Settings show
 * (docs/apps/water/spec.md, "Settings screen"). The reminder line under
 * the hours is [RemindersViewModel]'s, shared with Today. The sections
 * "Backup" and "Security" are [BackupViewModel]'s.
 */
data class SettingsScreen(
    /** False until the first read of the database is in. */
    val loaded: Boolean,
    /** The settings in use. */
    val settings: WaterSettings = WaterSettings(),
    /** The goal of today, in millilitres. It follows the date. */
    val goalMl: Int = GoalRules.DEFAULT_GOAL_ML,
) {
    /** True when no reminder fits between "From" and "Until": a line says so. It blocks nothing. */
    val noReminderFits: Boolean
        get() = !settings.reminderFits
}

/**
 * The ViewModel of Settings. A change takes effect at once: there is no
 * Save button. Each change checks what was typed first and says whether it
 * was taken, so that the dialog can name what is wrong and keep the old
 * value. The goal it shows and the goal it saves are those of the date of
 * [today], the one source of today's date.
 */
class SettingsViewModel(
    private val repository: WaterRepository,
    private val today: WaterToday,
    private val work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    /** What the screen shows. */
    val state: StateFlow<SettingsScreen> = combine(repository.settings(), repository.goals(), today.date) { settings, goals, dateToday ->
        SettingsScreen(loaded = true, settings = settings, goalMl = goals.goalOf(dateToday.asWaterDay()))
    }.stateIn(viewModelScope + work, SharingStarted.Eagerly, SettingsScreen(loaded = false))

    private val settings: WaterSettings get() = state.value.settings

    /** The write this screen started last. The next one waits for it ([inOrder]). The screen calls from the main thread only. */
    private var lastWrite: Job? = null

    /**
     * The daily goal dialog: [text] in the unit shown. False if it is not a
     * whole number from 500 to 10,000 ml (17 to 338 fl oz): then the field
     * says "Enter a goal from 500 to 10,000 ml." in the unit in use, and
     * nothing is written. The new goal counts from today. Past days keep
     * theirs.
     *
     * [openedMl] is the goal the dialog opened with. A field that still
     * shows it was not changed, and nothing is written ([amountOf]), also
     * if today's goal is another one by now, because the date changed
     * while the dialog was open.
     */
    fun setGoal(text: String, openedMl: Int): Boolean {
        val unit = settings.unit
        val amount = amountOf(text, openedMl, unit, unit.goalLimits) ?: return false
        if (amount != openedMl) {
            // The day of the press: the write can wait for one before it, and midnight can pass meanwhile.
            val day = today.date.value
            inOrder { repository.setGoal(day, amount) }
        }
        return true
    }

    /** The unit dialog. Quick amounts that are still the defaults become those of the new unit. */
    fun setUnit(unit: WaterUnit) = change { SettingsRules.withUnit(it, unit) }

    /**
     * The quick amounts dialog: three [texts] in the unit shown, first to
     * third. Returns the places (0 to 2) of the fields that are not a whole
     * number from 1 to 3,000 ml (1 to 101 fl oz). Only if it is empty are
     * the amounts written. [openedMl] are the three amounts the dialog
     * opened with. A field that still shows its amount keeps it
     * ([amountOf]).
     */
    fun setQuickAmounts(texts: List<String>, openedMl: List<Int>): List<Int> {
        require(texts.size == 3 && openedMl.size == 3) { "Three quick amounts" }
        val unit = settings.unit
        val amounts = texts.mapIndexed { place, text -> amountOf(text, openedMl[place], unit, unit.drinkLimits) }
        val wrong = amounts.indices.filter { amounts[it] == null }
        if (wrong.isEmpty()) {
            change { it.copy(cup1Ml = amounts[0]!!, cup2Ml = amounts[1]!!, cup3Ml = amounts[2]!!) }
        }
        return wrong
    }

    /**
     * The switch "Remind me to drink". It takes effect at once. Turning it
     * on may start the question for notifications, which
     * [RemindersViewModel.remindersTurnedOn] decides.
     */
    fun setRemindersOn(on: Boolean) = change { it.copy(remindersOn = on) }

    /** "Every": one of [SettingsRules.INTERVALS]. It can be changed while reminders are off. */
    fun setInterval(minutes: Int) {
        require(minutes in SettingsRules.INTERVALS) { "One of the six intervals" }
        change { it.copy(intervalMinutes = minutes) }
    }

    /**
     * "From". False if "Until" would then be less than 30 minutes after it:
     * the dialog says "Until must be at least 30 minutes after From." and
     * the old time stays, as for a change of "Until" (spec, "Settings
     * screen").
     */
    fun setFrom(minute: Int): Boolean {
        if (!SettingsRules.hoursAllowed(minute, settings.untilMinute)) return false
        change { current -> current.copy(fromMinute = minute).takeIf(SettingsRules::isValid) ?: current }
        return true
    }

    /** "Until". False if it is less than 30 minutes after "From": the old time stays. */
    fun setUntil(minute: Int): Boolean {
        if (!SettingsRules.hoursAllowed(settings.fromMinute, minute)) return false
        change { current -> current.copy(untilMinute = minute).takeIf(SettingsRules::isValid) ?: current }
        return true
    }

    /**
     * The amount in millilitres that a field of a dialog holds, or null if
     * it is refused. A field that still shows [openedMl], the stored amount
     * the dialog opened with, keeps it, as the drink sheet does. In fluid
     * ounces the text is rounded: 2,000 ml shows as 68 fl oz, and 68 fl oz
     * read anew would be 2,011 ml.
     */
    private fun amountOf(text: String, openedMl: Int, unit: WaterUnit, limits: IntRange): Int? =
        if (text.trim() == AmountInput.textOf(openedMl, unit)) openedMl else AmountInput.millilitres(text, unit, limits)

    /**
     * Writes [change] of the settings in use. The hours are checked again
     * against the stored settings, in case they changed since this screen
     * read them: a change that no longer fits keeps them as they are.
     */
    private fun change(change: (WaterSettings) -> WaterSettings) {
        inOrder { repository.changeSettings(change) }
    }

    /**
     * Starts [write] once every write this screen started before it has
     * ended. Each write is a coroutine of its own, and nothing else keeps
     * two of them in line: on a busy phone a change made an instant after
     * another could reach the database first, and the older change would
     * then be the one that stays.
     */
    private fun inOrder(write: suspend () -> Unit) {
        val before = lastWrite
        lastWrite = viewModelScope.launch(work) {
            before?.join()
            write()
        }
    }
}
