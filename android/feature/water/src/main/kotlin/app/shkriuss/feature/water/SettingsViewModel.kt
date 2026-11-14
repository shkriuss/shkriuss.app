package app.shkriuss.feature.water

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus

/**
 * What the sections "Drinking" and "Reminders" of Settings show
 * (docs/apps/water/spec.md, "Settings screen"). Step 2.4 adds the line of
 * the notification permission, and step 2.5 the sections "Backup",
 * "Security" and "About".
 */
data class SettingsScreen(
    /** False until the first read of the database is in. */
    val loaded: Boolean,
    /** The settings in use. */
    val settings: WaterSettings = WaterSettings(),
    /** The goal of today, in millilitres. */
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
 * value.
 */
class SettingsViewModel(
    private val repository: WaterRepository,
    private val time: WaterTime,
    private val work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    /** What the screen shows. */
    val state: StateFlow<SettingsScreen> = combine(repository.settings(), repository.goals()) { settings, goals ->
        SettingsScreen(loaded = true, settings = settings, goalMl = goals.goalOf(time.today().asWaterDay()))
    }.stateIn(viewModelScope + work, SharingStarted.Eagerly, SettingsScreen(loaded = false))

    private val settings: WaterSettings get() = state.value.settings

    /**
     * The daily goal dialog: [text] in the unit shown. False if it is not a
     * whole number from 500 to 10,000 ml (17 to 338 fl oz): then the field
     * says "Enter a goal from 500 to 10,000 ml." in the unit in use, and
     * nothing is written. The new goal counts from today. Past days keep
     * theirs.
     */
    fun setGoal(text: String): Boolean {
        val unit = settings.unit
        val amount = AmountInput.millilitres(text, unit, unit.goalLimits) ?: return false
        viewModelScope.launch(work) { repository.setGoal(time.today(), amount) }
        return true
    }

    /** The unit dialog. Quick amounts that are still the defaults become those of the new unit. */
    fun setUnit(unit: WaterUnit) = change { SettingsRules.withUnit(it, unit) }

    /**
     * The quick amounts dialog: three [texts] in the unit shown, first to
     * third. Returns the places (0 to 2) of the fields that are not a whole
     * number from 1 to 3,000 ml (1 to 101 fl oz). Only if it is empty are
     * the amounts written.
     */
    fun setQuickAmounts(texts: List<String>): List<Int> {
        require(texts.size == 3) { "Three quick amounts" }
        val unit = settings.unit
        val amounts = texts.map { AmountInput.millilitres(it, unit, unit.drinkLimits) }
        val wrong = amounts.indices.filter { amounts[it] == null }
        if (wrong.isEmpty()) {
            change { it.copy(cup1Ml = amounts[0]!!, cup2Ml = amounts[1]!!, cup3Ml = amounts[2]!!) }
        }
        return wrong
    }

    /** The switch "Remind me to drink". Step 2.4 adds the question for notifications. */
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
     * Writes [change] of the settings in use. The hours are checked again
     * against the stored settings, in case they changed since this screen
     * read them: a change that no longer fits keeps them as they are.
     */
    private fun change(change: (WaterSettings) -> WaterSettings) {
        viewModelScope.launch(work) { repository.changeSettings(change) }
    }
}
