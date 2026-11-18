package app.shkriuss.feature.reminders

import android.content.Intent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.shkriuss.core.notify.NotifyState
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus

/**
 * Why notifications cannot show, as the line at the top of Upcoming says
 * it (docs/apps/reminders/spec.md, "Upcoming", point 2).
 */
enum class NotificationLine {
    /** "Reminders may not show notifications yet." The line offers **Allow**, which starts the question. */
    NOT_ASKED,

    /** "Notifications are off for Reminders. Your reminders are silent." **Open settings**: Android's notification page for Reminders. */
    DENIED,

    /** "Reminders are turned off in Android's settings. Your reminders are silent." **Open settings**: Android's page for the channel. */
    CHANNEL_OFF,
}

/** What a tap on a notification opens, until the screen has opened it. */
sealed interface TappedReminder {
    /** The form of [reminder], on Past if [past], else on Upcoming. */
    data class Open(val reminder: Reminder, val past: Boolean) : TappedReminder

    /** That reminder is deleted, or no reminder has that id: Upcoming. */
    data object Missing : TappedReminder
}

/** What the screens show about notifications. */
data class NotificationsScreen(
    /** Why notifications cannot show, or null while they can. Upcoming shows the line only while a reminder is upcoming. */
    val line: NotificationLine? = null,
    /** True while the dialog before Android's question shows: **Continue** and **Not now**. */
    val asking: Boolean = false,
    /** A tap on a notification that the screen has not opened yet. */
    val tapped: TappedReminder? = null,
)

/**
 * The ViewModel of the line about notifications, of the question for
 * notifications, and of a tap on a notification
 * (docs/apps/reminders/spec.md, "Upcoming", "As in Water", asking for
 * notifications, and "The notification", point 6).
 *
 * The question comes after every save while Android has not asked
 * (the owner's decision), and from **Allow**. The reminder is saved
 * either way. After one answer, yes or no, Reminders never asks again.
 * The state of the permission is Android's, so the screen calls [refresh]
 * every time it comes to the front.
 */
class NotificationsViewModel(
    private val alarms: RemindersAlarms,
    private val repository: RemindersRepository,
    private val time: RemindersTime,
    private val work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    private val permission = MutableStateFlow(alarms.state())
    private val asking = MutableStateFlow(false)
    private val tapped = MutableStateFlow<TappedReminder?>(null)

    /** What the screens show. */
    val state: StateFlow<NotificationsScreen> = combine(permission, asking, tapped) { state, open, tap ->
        NotificationsScreen(lineOf(state), open, tap)
    }.stateIn(viewModelScope + work, SharingStarted.Eagerly, NotificationsScreen(lineOf(permission.value)))

    /** Reads the state of notifications again. The screen calls it each time it comes to the front. */
    fun refresh() {
        permission.value = alarms.state()
    }

    /** A reminder was saved: if Android has not asked yet, the question starts. */
    fun saved() {
        refresh()
        if (permission.value == NotifyState.NotAsked) asking.value = true
    }

    /** **Allow** on the line: the question starts. */
    fun allow() {
        refresh()
        if (permission.value == NotifyState.NotAsked) asking.value = true
    }

    /** **Continue** in the dialog: it closes, and the screen starts Android's own question. */
    fun continueAsking() {
        asking.value = false
    }

    /** **Not now** in the dialog: it closes. The line says that notifications are not allowed yet. */
    fun notNow() {
        asking.value = false
    }

    /** Android's question was answered, yes or no. From now on Reminders never asks again. */
    fun answered() {
        alarms.permissionAnswered()
        refresh()
    }

    /** The page of Android's settings that **Open settings** opens. */
    fun settingsIntent(): Intent = alarms.settingsIntent()

    /**
     * A tap on the notification of the reminder [id], or on the notice of
     * `core/notify` in its place: the form of that reminder, on the list it
     * is in now, or Upcoming if it is deleted or there is none.
     */
    fun open(id: String) {
        viewModelScope.launch(work) {
            val reminder = repository.find(id)
            tapped.value = if (reminder == null) {
                TappedReminder.Missing
            } else {
                TappedReminder.Open(reminder, past = ReminderLists.alarmOf(reminder, repository.entries.value[id], time.reading()) == null)
            }
        }
    }

    /** The screen opened what the tap asked for. */
    fun tapOpened() {
        tapped.value = null
    }

    private fun lineOf(state: NotifyState): NotificationLine? = when (state) {
        NotifyState.Ready -> null
        NotifyState.NotAsked -> NotificationLine.NOT_ASKED
        NotifyState.Denied -> NotificationLine.DENIED
        NotifyState.ChannelOff -> NotificationLine.CHANNEL_OFF
    }
}
