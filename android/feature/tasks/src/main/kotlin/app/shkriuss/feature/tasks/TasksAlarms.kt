package app.shkriuss.feature.tasks

import android.content.Context
import android.content.Intent
import android.text.format.DateFormat
import app.shkriuss.core.notify.Alarm
import app.shkriuss.core.notify.AlarmHandler
import app.shkriuss.core.notify.AlarmId
import app.shkriuss.core.notify.AlarmSource
import app.shkriuss.core.notify.ButtonHandler
import app.shkriuss.core.notify.ButtonPress
import app.shkriuss.core.notify.ChannelImportance
import app.shkriuss.core.notify.Notifications
import app.shkriuss.core.notify.Notify
import app.shkriuss.core.notify.NotifyChannel
import app.shkriuss.core.notify.NotifyState
import app.shkriuss.core.notify.OnScreen
import app.shkriuss.core.notify.ShkNotification
import app.shkriuss.core.notify.ShkNotificationButton
import app.shkriuss.core.notify.ShownReview
import app.shkriuss.feature.tasks.ui.TasksFormat
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Tasks' reminders, through `core/notify` (docs/apps/tasks/spec.md,
 * "Reminders of a task" and "The notification", and
 * docs/architecture/notifications.md, "What an app does"). Each task has
 * at most one alarm and at most one notification, both named by the
 * task's `id`. A reminder follows Reminders' rules for a one-time
 * reminder, with the reminder moment as its one occurrence
 * ([TaskReminders.alarmOf]).
 *
 * - As the [AlarmSource], it names the alarm of each open task with a
 *   reminder, writes the mark of one it sees first, or whose entry was
 *   written for another reminder number, and drops the entries of a task
 *   that has no reminder: done, deleted, not stored, or with none.
 * - As the [AlarmHandler], it shows a task's reminder when its time
 *   comes, and then moves its mark.
 * - As the [ButtonHandler], it does what **Done** and **Snooze 10 min**
 *   say.
 * - As the [ShownReview], it removes at every start a notification that
 *   no longer fits its task.
 * - [afterChange] runs after every write of [repository]: it removes the
 *   notification of a task with a new due day, time or repeat, done,
 *   moved, opened again, deleted or brought back, and calls
 *   `notify.sync()`.
 *
 * The source, the handler, a press, the review and [afterChange] take
 * turns on [turns], the one lock that the repository's work on the
 * phone-only [book] takes too. [notify] gives the app's one `Notify`,
 * which is built with this object, so it is read only when it is needed.
 * [open] is the screen a tap opens: `core/notify` puts the task's `id`,
 * the key, on it as its identifier. [work] runs [afterChange] off the
 * main thread. Tests pass their own.
 */
class TasksAlarms(
    private val context: Context,
    private val repository: TasksRepository,
    private val time: TasksTime,
    private val book: TaskBook,
    private val turns: Mutex,
    private val open: Intent,
    private val notify: () -> Notify,
    private val work: CoroutineContext = Dispatchers.IO,
) : AlarmSource, AlarmHandler, ButtonHandler, ShownReview {
    // As the AlarmSource.

    /**
     * One alarm for each open task with a reminder that has one by the
     * rule. A due alarm stays named, with its time in the past, until the
     * handler has moved the mark (notifications.md, rules for the app's
     * `AlarmSource`, rule 6).
     *
     * A task with no mark for its reminder number now gets the current
     * minute, and so does one whose mark lies later than now: **the mark
     * never stays later than now**. The entries of a task with no
     * reminder go: they count for nothing (spec, "Stopped between two
     * writes"). All of it is one write.
     */
    override fun alarms(): List<Alarm> = runBlocking {
        turns.withLock {
            val now = time.reading()
            val reminding = repository.liveTasks().mapNotNull { task -> TaskReminders.numberOf(task)?.let { task to it } }
            val entries = book.entries.value
            val counted = reminding.associate { (task, number) -> task.id to TaskBook.countingEntry(entries[task.id], number) }
            val marks = counted.mapValues { (_, entry) -> TaskReminders.markNow(entry.mark, now) }
            val numbers = reminding.associate { (task, number) -> task.id to number }
            val moved = marks.filter { (id, mark) -> counted.getValue(id).mark != mark }.keys
            val dropped = entries.keys - numbers.keys
            if (moved.isNotEmpty() || dropped.isNotEmpty()) {
                book.update(moved + dropped) { id, stored ->
                    val number = numbers[id] ?: return@update TaskEntry()
                    TaskBook.countingEntry(stored, number).copy(number = number, mark = marks.getValue(id))
                }
            }
            reminding.mapNotNull { (task, _) ->
                val entry = counted.getValue(task.id)
                TaskReminders.alarmOf(checkNotNull(TaskReminders.momentOf(task)), marks.getValue(task.id), entry.snoozeMillis, now)
                    ?.let { Alarm(AlarmId(task.id), it.atMillis) }
            }
        }
    }

    // As the AlarmHandler.

    /**
     * The alarm of a task at its time T reached the handler, as Reminders'
     * handler (docs/apps/reminders/spec.md, "The rule", the three steps):
     *
     * 1. It reads the task and its entry for the task's reminder number,
     *    with the mark no later than now. If the rule does not give T, it
     *    shows nothing, writes nothing, and ends: the task was deleted,
     *    done or changed in that moment. Otherwise it writes `showing` = T,
     *    so that a press on the notification counts.
     * 2. It shows the notification.
     * 3. It writes: the mark is the later of the mark and T as a local
     *    minute, and no snooze.
     *
     * Step 3 is written also when reading or showing fails, so that a
     * failure never names T again, and the error then goes on to
     * `core/notify`, which shows its notice in place of the reminder. A
     * second run for T shows nothing: the mark is already at T.
     */
    override fun onAlarm(alarm: Alarm, notifications: Notifications) = handle(alarm, notifications::show)

    /**
     * The handler of [onAlarm], with the posting of the notification as
     * [show], so that a test can look at what is stored at that moment.
     *
     * An alarm whose time T is still to come by this reading of the clock
     * shows nothing and writes nothing. That happens only if the clock
     * was set back after `core/notify` found T due: the alarm is set again
     * for T, and shows then.
     *
     * When the task cannot be read, its reminder number is not known.
     * Step 3 is then written, with `showing` = T, to the entry as it is
     * stored, for the number it was written for. So a press from an older
     * notification of the task is not current, and T is not named again.
     */
    internal fun handle(alarm: Alarm, show: (ShkNotification) -> Unit) {
        val id = alarm.id.value
        val at = alarm.atMillis
        runBlocking {
            turns.withLock {
                val now = time.reading()
                if (at > now.millis) return@withLock
                val task = try {
                    repository.findTask(id)
                } catch (failed: Exception) {
                    // The rule is not checked. A press from an older notification is then not current.
                    if (book.storedOf(id).number != null) {
                        book.update(listOf(id)) { _, stored ->
                            stored.copy(mark = laterOf(stored.mark, minuteOf(at, now)), snoozeMillis = null, showingMillis = at)
                        }
                    }
                    throw failed
                } ?: return@withLock
                val number = TaskReminders.numberOf(task) ?: return@withLock
                val moment = TaskReminders.momentOf(task) ?: return@withLock
                val entry = book.entryOf(id, number)
                val mark = TaskReminders.markNow(entry.mark, now)
                val due = TaskReminders.alarmOf(moment, mark, entry.snoozeMillis, now)
                if (due == null || due.atMillis != at) return@withLock
                write(id, number) { it.copy(showingMillis = at) }
                try {
                    show(notificationOf(task, number, due, moment, mark, now))
                } finally {
                    write(id, number) { it.copy(mark = laterOf(mark, minuteOf(at, now)), snoozeMillis = null) }
                }
            }
        }
    }

    /**
     * The notification of [task] for [alarm] (spec, "The notification"):
     * the title, and as its text "Due today" and the repeat on time,
     * "Missed: 09:00" when late, or "Snoozed. It was due at 09:00." after a
     * snooze, where 09:00 is the reminder moment when it is at or before
     * [mark]. A time on another day has its date: "Missed: Mon 16 Nov,
     * 09:00". Times are those the phone's clock showed at their moment. It
     * has no end, and the buttons **Done**, which carries [number], and
     * **Snooze 10 min**.
     */
    private fun notificationOf(
        task: Task,
        number: Long,
        alarm: TaskAlarm,
        moment: LocalDateTime,
        mark: LocalDateTime,
        now: ClockReading,
    ): ShkNotification {
        val format = format()
        val onTime = format.dueToday(task.due?.repeatKind ?: Repeat.ONCE)
        val text = when {
            alarm is TaskAlarm.Snooze -> moment.takeIf { it <= mark }
                ?.let { due -> context.getString(R.string.tasks_snoozed_was_due, format.timeOrDateTime(minuteOf(now.millisOf(due), now), now.today)) }
                ?: onTime
            now.millis - alarm.atMillis > LATE_MILLIS ->
                context.getString(R.string.tasks_missed, format.timeOrDateTime(minuteOf(alarm.atMillis, now), now.today))
            else -> onTime
        }
        val snoozeLabel = context.resources.getQuantityString(R.plurals.tasks_snooze_minutes, SNOOZE_MINUTES, format.number(SNOOZE_MINUTES))
        return ShkNotification(
            key = task.id,
            channel = CHANNEL,
            title = task.title,
            text = text,
            smallIcon = R.drawable.tasks_icon_today,
            open = open,
            atMillis = alarm.atMillis,
            buttons = listOf(
                ShkNotificationButton(context.getString(R.string.tasks_notification_done), DONE, number),
                ShkNotificationButton(snoozeLabel, SNOOZE, SNOOZE_MINUTES.toLong()),
            ),
        )
    }

    // As the ButtonHandler.

    /**
     * A press of **Done** or **Snooze 10 min** (spec, "The notification",
     * points 3 and 4). A press is current while its time is the task's
     * `showing`, for the task's reminder number now; **Done** also only
     * while the number it carries is the task's number now. A button does
     * what it did when it was shown (ADR 0034).
     *
     * - **Done** that is current does what a tick does: the task is done,
     *   or a repeating task moves to its next date and counts from now.
     *   The notification goes, and the alarm moves ([afterChange]).
     * - **Snooze 10 min** that is current, in one write: `showing` goes,
     *   the mark moves to at least the notification's time, and a snooze
     *   until 10 minutes after the press is set. The notification goes.
     *
     * A press that is not current only removes its notification, and only
     * while no other notification of that task counts: one with the same
     * key would be newer. A press of an action this version does not know
     * does nothing.
     */
    override fun onButton(press: ButtonPress, notifications: Notifications) {
        val snooze = press.action == SNOOZE && press.value == SNOOZE_MINUTES.toLong()
        if (press.action != DONE && !snooze) return
        if (!snooze && runBlocking { repository.pressDone(press.key, press.value, press.atMillis) }) return
        val counted = runBlocking {
            turns.withLock {
                val number = repository.findTask(press.key)?.let(TaskReminders::numberOf)
                val entry = book.entryOf(press.key, number)
                if (!snooze || number == null || entry.showingMillis != press.atMillis) {
                    if (entry.showingMillis == null) notifications.cancel(press.key)
                    return@withLock false
                }
                val now = time.reading()
                val mark = laterOf(TaskReminders.markNow(entry.mark, now), minuteOf(press.atMillis, now))
                val until = now.millis + SNOOZE_MINUTES * MILLIS_PER_MINUTE
                write(press.key, number) { it.copy(mark = mark, snoozeMillis = until, showingMillis = null) }
                notifications.cancel(press.key)
                true
            }
        }
        if (counted) notify().sync()
    }

    // After a change in the app.

    /**
     * Runs after every write that changed something (spec, "Reminders of
     * a task", the table of changes). A task with a new due day, time or
     * repeat, one done, moved, opened again, deleted, brought back or
     * taken from a backup loses its notification. The repository has already written its entries,
     * with nothing on screen. A new title or list only keeps it. Then the
     * alarms move.
     *
     * The repository's write and this one take their turns apart, so the
     * handler can show a reminder between them. That newer notification
     * stays: an entry with `showing` again has one that counts.
     */
    suspend fun afterChange(change: TaskChange) {
        if (change.kind in LOSE_THEIR_NOTIFICATION) {
            withContext(work) {
                turns.withLock {
                    change.ids.filter { book.storedOf(it).showingMillis == null }.forEach(notify().notifications::cancel)
                }
            }
        }
        notify().sync()
    }

    // As the ShownReview.

    /**
     * Removes a notification that no longer fits its task (spec, "The
     * notification", point 5): its task is deleted, not stored, done or
     * has no reminder; its time is not the task's `showing`; or the value
     * of its **Done** button, where it has one, is not the task's reminder
     * number. Except when its time is not `showing`, the task's `showing`
     * goes too, so a press that another app kept from that notification is
     * not current. Tasks may stop between a write and the removal of a
     * notification; then the next start takes the old title out of the
     * notification shade. A current notification stays: the handler
     * writes `showing` before it posts, and posting it again in the hidden
     * form keeps its time. The check takes its turn on [turns], as a press
     * does.
     */
    override fun review(onScreen: List<OnScreen>, notifications: Notifications, timeChanged: Boolean) = runBlocking {
        turns.withLock {
            onScreen.forEach { shown ->
                val number = repository.findTask(shown.key)?.let(TaskReminders::numberOf)
                val showing = book.entryOf(shown.key, number).showingMillis
                val doneValue = shown.buttonValues[DONE]
                when {
                    number == null || (showing == shown.atMillis && doneValue != null && doneValue != number) -> {
                        notifications.cancel(shown.key)
                        book.update(listOf(shown.key)) { _, stored -> stored.copy(showingMillis = null) }
                    }
                    showing != shown.atMillis -> notifications.cancel(shown.key)
                }
            }
        }
    }

    // For the screens.

    /** What the screens say about notifications of the channel of task reminders. */
    fun state(): NotifyState = notify().state(CHANNEL)

    /** Android's question for notifications was answered. */
    fun permissionAnswered() = notify().permissionAnswered()

    /** The page of Android's settings that the line's **Open settings** opens. */
    fun settingsIntent(): Intent = notify().settingsIntent(CHANNEL)

    /** Writes what [change] makes of the entry of the task [id] that counts for the reminder number [number]. */
    private fun write(id: String, number: Long, change: (TaskEntry) -> TaskEntry) {
        book.update(listOf(id)) { _, stored -> change(TaskBook.countingEntry(stored, number).copy(number = number)) }
    }

    /** Dates, times and repeats as the phone shows them now. */
    private fun format(): TasksFormat {
        val resources = context.resources
        return TasksFormat(resources, resources.configuration.locales[0], DateFormat.is24HourFormat(context))
    }

    /** The channel and the buttons of Tasks' notifications. */
    companion object {
        /** The channel of the task reminders (spec, "The notification", point 6). Its id never changes. */
        val CHANNEL: NotifyChannel = NotifyChannel(
            id = "tasks",
            name = R.string.tasks_channel_name,
            description = R.string.tasks_channel_description,
            importance = ChannelImportance.Urgent,
        )

        /** The action of **Done**. Its value is the task's reminder number when the notification was shown. */
        const val DONE: String = "done"

        /** The action of **Snooze 10 min**. Its value is the length of the snooze in minutes. */
        const val SNOOZE: String = "snooze"

        /** The one length of a snooze, in minutes. It is fixed, as in Reminders. */
        const val SNOOZE_MINUTES: Int = 10

        /** The changes after which a task's notification goes. After a new title or list only, or a new task, nothing shows. */
        private val LOSE_THEIR_NOTIFICATION = setOf(
            TaskChange.Kind.NEW_TIME,
            TaskChange.Kind.DONE,
            TaskChange.Kind.MOVED,
            TaskChange.Kind.OPENED_AGAIN,
            TaskChange.Kind.DELETED,
            TaskChange.Kind.BROUGHT_BACK,
            TaskChange.Kind.RESTORED,
        )

        /** A reminder shown more than this long after its moment is late (spec, "Words used on this page"). */
        private const val LATE_MILLIS = 60_000L

        private const val MILLIS_PER_MINUTE = 60_000L

        /** The local minute the phone's clock showed at [millis], in the zone of [now]. */
        private fun minuteOf(millis: Long, now: ClockReading): LocalDateTime = now.local(millis).truncatedTo(ChronoUnit.MINUTES)

        /** The later of [mark], if there is one, and [other]. */
        private fun laterOf(mark: LocalDateTime?, other: LocalDateTime): LocalDateTime = if (mark == null || mark < other) other else mark
    }
}
