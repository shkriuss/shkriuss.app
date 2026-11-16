package app.shkriuss.feature.water

import android.content.Intent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shkriuss.core.notify.NotifyState
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.plus

/**
 * The reminder line of Today and of Settings (docs/apps/water/spec.md,
 * "Today", the table of the reminder line). Only while reminders are on.
 */
sealed interface ReminderLine {
    /** "Next reminder at 14:30". [minuteOfDay] is the time, today. */
    data class NextAt(val minuteOfDay: Int) : ReminderLine

    /** "Goal reached. No more reminders today." */
    data object GoalReached : ReminderLine

    /** "No more reminders today.", also when no reminder fits between From and Until on any day (owner's decision in step 2.4). */
    data object NoneLeftToday : ReminderLine

    /** Android has not asked yet. The line offers **Allow**, which starts the question. */
    data object NotAsked : ReminderLine

    /** The user said no, or turned Water's notifications off. The line offers **Open settings**. */
    data object Denied : ReminderLine

    /** The channel "Drink reminders" is off. The line offers **Open settings**, on the channel's page. */
    data object ChannelOff : ReminderLine
}

/** What the reminder line shows, and whether the question for notifications is open. */
data class RemindersScreen(
    /** The line, or null while reminders are off. */
    val line: ReminderLine? = null,
    /** True while the dialog before Android's question shows: **Continue** and **Not now**. */
    val asking: Boolean = false,
)

/**
 * The ViewModel of the reminder line and of the question for
 * notifications, shared by Today and Settings, so both show the same line
 * (the owner's decision in step 2.4) and the question is asked once.
 *
 * A line about notifications comes before a line about the next reminder:
 * while reminders are silent, "Next reminder at 14:30" would hide it. The
 * state of the notification permission is Android's, so the screen calls
 * [refresh] every time it comes to the front. The line is that of the
 * date of [today], the one source of today's date, and it is read again
 * when that date changes.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RemindersViewModel(
    private val repository: WaterRepository,
    private val reminders: WaterReminders,
    private val today: WaterToday,
    work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    private val permission = MutableStateFlow(reminders.state())
    private val refreshes = MutableStateFlow(0)
    private val asking = MutableStateFlow(false)

    private val line = combine(
        repository.settings(),
        repository.dayTotals(),
        repository.goals(),
        reminders.entries,
        // A new date reads the line again, as Today moves to the new day.
        combine(permission, refreshes, today.date) { state, _, _ -> state },
    ) { settings, _, _, _, state -> settings to state }
        .mapLatest { (settings, state) -> if (settings.remindersOn) lineOf(state) else null }

    /** What the line shows. */
    val state: StateFlow<RemindersScreen> = combine(line, asking) { shown, open -> RemindersScreen(shown, open) }
        .stateIn(viewModelScope + work, SharingStarted.Eagerly, RemindersScreen())

    private suspend fun lineOf(state: NotifyState): ReminderLine = when (state) {
        NotifyState.NotAsked -> ReminderLine.NotAsked
        NotifyState.Denied -> ReminderLine.Denied
        NotifyState.ChannelOff -> ReminderLine.ChannelOff
        NotifyState.Ready -> {
            val today = today.date.value
            val next = reminders.next()
            when {
                repository.factsOf(today).goalMet -> ReminderLine.GoalReached
                next != null && next.toLocalDate() == today -> ReminderLine.NextAt(next.hour * MINUTES_PER_HOUR + next.minute)
                else -> ReminderLine.NoneLeftToday
            }
        }
    }

    /** Reads the state of notifications again, and the time. The screen calls it each time it comes to the front. */
    fun refresh() {
        permission.value = reminders.state()
        refreshes.value++
    }

    /** "Remind me to drink" was turned on: if Android has not asked yet, the question starts. */
    fun remindersTurnedOn() {
        refresh()
        if (permission.value == NotifyState.NotAsked) asking.value = true
    }

    /** **Allow** on the line: the question starts. */
    fun allow() {
        if (reminders.state() == NotifyState.NotAsked) asking.value = true
    }

    /** **Continue** in the dialog: it closes, and the screen starts Android's own question. */
    fun continueAsking() {
        asking.value = false
    }

    /** **Not now** in the dialog: it closes. Reminders stay on, and the line says notifications are not allowed yet. */
    fun notNow() {
        asking.value = false
    }

    /** Android's question was answered, yes or no. From now on Water never asks again. */
    fun answered() {
        reminders.permissionAnswered()
        refresh()
    }

    /** The page of Android's settings that **Open settings** opens. */
    fun settingsIntent(): Intent = reminders.settingsIntent()

    private companion object {
        const val MINUTES_PER_HOUR = 60
    }
}
