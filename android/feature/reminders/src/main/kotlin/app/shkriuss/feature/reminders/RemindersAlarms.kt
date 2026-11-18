package app.shkriuss.feature.reminders

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
import app.shkriuss.core.notify.ShkNotification
import app.shkriuss.core.notify.ShkNotificationButton
import app.shkriuss.feature.reminders.ui.RemindersFormat
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Reminders' notifications, through `core/notify`
 * (docs/apps/reminders/spec.md, "When a reminder shows" and "The
 * notification", and docs/architecture/notifications.md, "What an app
 * does"). Each reminder has at most one alarm and at most one
 * notification, both named by the reminder's `id`.
 *
 * - As the [AlarmSource], it names the alarm of each upcoming reminder,
 *   at the time of [ReminderRule], and writes the mark of a reminder it
 *   sees first, or one that lies later than now.
 * - As the [AlarmHandler], it shows a reminder when its time comes, and
 *   then moves its mark.
 * - As the [ButtonHandler], it does what **Done** and **Snooze 10 min**
 *   say.
 * - [afterChange] runs after every write of [repository]: it removes the
 *   notification of a reminder with a new time or deleted, and calls
 *   `notify.sync()`.
 *
 * The source, the handler, a press and [afterChange] take turns on
 * [turns], the one lock that the repository's work on the phone-only
 * [book] takes too. [notify] gives the app's one `Notify`, which is built
 * with this object, so it is read only when it is needed. [open] is the
 * screen a tap opens: `core/notify` puts the reminder's `id`, the key, on
 * it as its identifier. [work] runs [afterChange] off the main thread.
 * Tests pass their own.
 */
class RemindersAlarms(
    private val context: Context,
    private val repository: RemindersRepository,
    private val time: RemindersTime,
    private val book: ReminderBook,
    private val turns: Mutex,
    private val open: Intent,
    private val notify: () -> Notify,
    private val work: CoroutineContext = Dispatchers.IO,
) : AlarmSource, AlarmHandler, ButtonHandler {
    // As the AlarmSource.

    /**
     * One alarm for each upcoming reminder, at the time of the rule. A
     * due alarm stays named, with its time in the past, until the handler
     * has moved the mark (notifications.md, rules for the app's
     * `AlarmSource`, rule 6).
     *
     * A reminder with no mark gets the current minute, and so does one
     * whose mark lies later than now: **the mark never stays later than
     * now** (spec, "The mark", point 3). Both are written in one write.
     */
    override fun alarms(): List<Alarm> = runBlocking {
        turns.withLock {
            val reminders = repository.live()
            val now = time.reading()
            val entries = book.entries.value
            val marks = reminders.associate { it.id to ReminderRule.markNow(entries[it.id]?.mark, now) }
            val moved = marks.filter { (id, mark) -> entries[id]?.mark != mark }
            if (moved.isNotEmpty()) book.update(moved.keys) { id, entry -> entry.copy(mark = moved.getValue(id)) }
            reminders.mapNotNull { reminder ->
                ReminderRule.alarmOf(reminder.schedule, marks.getValue(reminder.id), entries[reminder.id]?.snoozeMillis, now)
                    ?.let { Alarm(AlarmId(reminder.id), it.atMillis) }
            }
        }
    }

    // As the AlarmHandler.

    /**
     * The alarm of a reminder at its time T reached the handler (spec, "The
     * rule", the three steps):
     *
     * 1. It reads the reminder and its entry, with the mark no later than
     *    now. If the rule does not give T, it shows nothing, writes
     *    nothing, and ends: the reminder was deleted or changed in that
     *    moment, or a later occurrence is due. Otherwise it writes
     *    `showing` = T, so that a press on the notification counts.
     * 2. It shows the notification.
     * 3. It writes: the mark is the later of the mark and T as a local
     *    minute, and no snooze.
     *
     * Step 3 is written also when reading or showing fails, so that a
     * failure never names T again, and the error then goes on to
     * `core/notify`, which shows its notice in place of the reminder. A
     * second run for T shows nothing: the mark is already at T.
     */
    override fun onAlarm(alarm: Alarm, notifications: Notifications) {
        val id = alarm.id.value
        val at = alarm.atMillis
        runBlocking {
            turns.withLock {
                val now = time.reading()
                val entry = book.entryOf(id)
                val reminder = try {
                    repository.find(id)
                } catch (failed: Exception) {
                    // The rule is not checked. A press from an older notification is then not current.
                    book.update(id) { it.copy(mark = laterOf(it.mark, minuteOf(at, now)), snoozeMillis = null, showingMillis = at) }
                    throw failed
                } ?: return@withLock
                val mark = ReminderRule.markNow(entry.mark, now)
                val due = ReminderRule.alarmOf(reminder.schedule, mark, entry.snoozeMillis, now)
                if (due == null || due.atMillis != at) return@withLock
                book.update(id) { it.copy(showingMillis = at) }
                try {
                    notifications.show(notificationOf(reminder, due, mark, now))
                } finally {
                    book.update(id) { it.copy(mark = laterOf(mark, minuteOf(at, now)), snoozeMillis = null) }
                }
            }
        }
    }

    /**
     * The notification of [reminder] for [alarm] (spec, "The notification"):
     * the title, and as its text the repeat on time, "Missed: 09:00" when
     * late, or "Snoozed. It was due at 09:00." after a snooze, where 09:00
     * is the latest occurrence at or before [mark]. A time on another day
     * has its date: "Missed: Mon 16 Nov, 09:00" (the owner's decision for
     * the snooze). Times are those the phone's clock showed at their
     * moment. It has no end, and the buttons **Done** and **Snooze 10
     * min**.
     */
    private fun notificationOf(reminder: Reminder, alarm: ReminderAlarm, mark: LocalDateTime, now: ClockReading): ShkNotification {
        val format = format()
        val onTime = format.repeatOfNotification(reminder.schedule)
        val text = when {
            alarm is ReminderAlarm.Snooze -> Occurrences.latestAtOrBefore(reminder.schedule, mark)
                ?.let { due -> context.getString(R.string.reminders_snoozed_was_due, format.timeOrDateTime(minuteOf(now.millisOf(due), now), now.today)) }
                ?: onTime
            now.millis - alarm.atMillis > LATE_MILLIS ->
                context.getString(R.string.reminders_missed, format.timeOrDateTime(minuteOf(alarm.atMillis, now), now.today))
            else -> onTime
        }
        val snoozeLabel = context.resources.getQuantityString(R.plurals.reminders_snooze_minutes, SNOOZE_MINUTES, format.number(SNOOZE_MINUTES))
        return ShkNotification(
            key = reminder.id,
            channel = CHANNEL,
            title = reminder.title,
            text = text,
            smallIcon = R.drawable.reminders_icon_upcoming,
            open = open,
            atMillis = alarm.atMillis,
            buttons = listOf(
                ShkNotificationButton(context.getString(R.string.reminders_done), DONE),
                ShkNotificationButton(snoozeLabel, SNOOZE, SNOOZE_MINUTES.toLong()),
            ),
        )
    }

    // As the ButtonHandler.

    /**
     * A press of **Done** or **Snooze 10 min** (spec, "The notification").
     * It counts once, and only while it is current: while its time is the
     * reminder's `showing`. Then, in one write, `showing` goes and the mark
     * moves to at least the notification's time. **Done** also ends a
     * snooze; **Snooze 10 min** sets one until 10 minutes after the press.
     * The notification goes, and the alarm moves.
     *
     * A press that is not current only removes its notification, and only
     * while no other notification of that reminder shows: one with the
     * same key would be newer. A press of an action this version does not
     * know does nothing.
     */
    override fun onButton(press: ButtonPress, notifications: Notifications) {
        val snooze = press.action == SNOOZE && press.value == SNOOZE_MINUTES.toLong()
        if (press.action != DONE && !snooze) return
        val counted = runBlocking {
            turns.withLock {
                val entry = book.entryOf(press.key)
                if (entry.showingMillis != press.atMillis) {
                    if (entry.showingMillis == null) notifications.cancel(press.key)
                    return@withLock false
                }
                val now = time.reading()
                val mark = laterOf(ReminderRule.markNow(entry.mark, now), minuteOf(press.atMillis, now))
                val until = if (snooze) now.millis + SNOOZE_MINUTES * MILLIS_PER_MINUTE else null
                book.update(press.key) { it.copy(mark = mark, snoozeMillis = until, showingMillis = null) }
                notifications.cancel(press.key)
                true
            }
        }
        if (counted) notify().sync()
    }

    // After a change in the app.

    /**
     * Runs after every write that changed something (spec, "The rule", the
     * table of changes). A reminder with a new date, time or repeat, and a
     * deleted one, lose their notification. The repository has already
     * written their entries. Then the alarms move.
     */
    suspend fun afterChange(change: ReminderChange) {
        if (change.kind == ReminderChange.Kind.NEW_TIME || change.kind == ReminderChange.Kind.DELETED) {
            withContext(work) {
                turns.withLock { change.ids.forEach(notify().notifications::cancel) }
            }
        }
        notify().sync()
    }

    // For the screens.

    /** What the screens say about notifications of the channel of reminders. */
    fun state(): NotifyState = notify().state(CHANNEL)

    /** Android's question for notifications was answered. */
    fun permissionAnswered() = notify().permissionAnswered()

    /** The page of Android's settings that the line's **Open settings** opens. */
    fun settingsIntent(): Intent = notify().settingsIntent(CHANNEL)

    /** Dates, times and repeats as the phone shows them now. */
    private fun format(): RemindersFormat {
        val resources = context.resources
        return RemindersFormat(resources, resources.configuration.locales[0], DateFormat.is24HourFormat(context))
    }

    /** The channel and the buttons of Reminders' notifications. */
    companion object {
        /** The channel of the reminders (spec, "The notification"). Its id never changes. */
        val CHANNEL: NotifyChannel = NotifyChannel(
            id = "reminders",
            name = R.string.reminders_channel_name,
            description = R.string.reminders_channel_description,
            importance = ChannelImportance.Urgent,
        )

        /** The action of **Done**. */
        const val DONE: String = "done"

        /** The action of **Snooze 10 min**. Its value is the length of the snooze in minutes. */
        const val SNOOZE: String = "snooze"

        /** The one length of a snooze, in minutes. It is fixed (spec, "Decided by the owner", point 4). */
        const val SNOOZE_MINUTES: Int = 10

        /** A reminder shown more than this long after its moment is late (spec, "Words used on this page"). */
        private const val LATE_MILLIS = 60_000L

        private const val MILLIS_PER_MINUTE = 60_000L

        /** The local minute the phone's clock showed at [millis], in the zone of [now]. */
        private fun minuteOf(millis: Long, now: ClockReading): LocalDateTime = now.local(millis).truncatedTo(ChronoUnit.MINUTES)

        /** The later of [mark], if there is one, and [other]. */
        private fun laterOf(mark: LocalDateTime?, other: LocalDateTime): LocalDateTime = if (mark == null || mark < other) other else mark
    }
}
