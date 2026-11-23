package app.shkriuss.feature.tasks

import android.content.Intent
import android.database.SQLException
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
 * Why notifications cannot show, as the line at the top of Today says it
 * (docs/apps/tasks/spec.md, "Today", point 2, which takes the line of
 * Reminders' Upcoming).
 */
enum class NotificationLine {
    /** "Tasks may not show notifications yet." The line offers **Allow**, which starts the question. */
    NOT_ASKED,

    /** "Notifications are off for Tasks. Your reminders are silent." **Open settings**: Android's notification page for Tasks. */
    DENIED,

    /**
     * "Task reminders are turned off in Android's settings. Your reminders
     * are silent.", with the name of the channel (the owner's decision).
     * **Open settings**: Android's page for the channel.
     */
    CHANNEL_OFF,
}

/** What a tap on a notification opens, until the screen has opened it. */
sealed interface TappedTask {
    /** The form of [task], on the list [listId]: its own, or [INBOX] if it is in Inbox or its list is gone. */
    data class Open(val task: Task, val listId: String) : TappedTask

    /** That task is deleted, or no task has that id: Today. */
    data object Missing : TappedTask
}

/** What the screens show about notifications. */
data class NotificationsScreen(
    /** Why notifications cannot show, or null while they can. Today shows the line only while an open task has a reminder to come. */
    val line: NotificationLine? = null,
    /** True while the dialog before Android's question shows: **Continue** and **Not now**. */
    val asking: Boolean = false,
    /** A tap on a notification that the screen has not opened yet. */
    val tapped: TappedTask? = null,
)

/**
 * The ViewModel of the line about notifications, of the question for
 * notifications, and of a tap on a notification
 * (docs/apps/tasks/spec.md, "Today", point 2, "As in Water and
 * Reminders", asking for notifications, and "The notification", point 2).
 *
 * As in Reminders, the question comes after a save while Android has not
 * asked, also after **Not now** at an earlier save, and from **Allow**:
 * in Tasks, after a save that sets a reminder, that is a save after which
 * the task has one. The task is saved either way. After one answer, yes
 * or no, Tasks never asks again. The state of the permission is
 * Android's, so the screen calls [refresh] every time it comes to the
 * front.
 */
class NotificationsViewModel(
    private val alarms: TasksAlarms,
    private val repository: TasksRepository,
    private val work: CoroutineContext = EmptyCoroutineContext,
) : ViewModel() {
    private val permission = MutableStateFlow(alarms.state())
    private val asking = MutableStateFlow(false)
    private val tapped = MutableStateFlow<TappedTask?>(null)

    /** What the screens show. */
    val state: StateFlow<NotificationsScreen> = combine(permission, asking, tapped) { state, open, tap ->
        NotificationsScreen(lineOf(state), open, tap)
    }.stateIn(viewModelScope + work, SharingStarted.Eagerly, NotificationsScreen(lineOf(permission.value)))

    /** Reads the state of notifications again. The screen calls it each time it comes to the front. */
    fun refresh() {
        permission.value = alarms.state()
    }

    /** [task] was saved: if it has a reminder and Android has not asked yet, the question starts. */
    fun saved(task: Task) {
        if (TaskReminders.numberOf(task) == null) return
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

    /** Android's question was answered, yes or no. From now on Tasks never asks again. */
    fun answered() {
        alarms.permissionAnswered()
        refresh()
    }

    /** The page of Android's settings that **Open settings** opens. */
    fun settingsIntent(): Intent = alarms.settingsIntent()

    /**
     * A tap on the notification of the task [id], or on the notice of
     * `core/notify` in its place: the task's list, with its form open, or
     * Today if it is deleted or there is none. A task whose list is gone
     * shows in Inbox, so Inbox opens then. A read that fails opens Today.
     */
    fun open(id: String) {
        viewModelScope.launch(work) {
            tapped.value = try {
                val task = repository.findTask(id)
                when {
                    task == null -> TappedTask.Missing
                    task.listId == INBOX || repository.findList(task.listId) == null -> TappedTask.Open(task, INBOX)
                    else -> TappedTask.Open(task, task.listId)
                }
            } catch (_: SQLException) {
                TappedTask.Missing
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
