package app.shkriuss.feature.reminders

import androidx.room3.withWriteTransaction
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.data.RecordWriter
import app.shkriuss.core.data.isDeleted
import app.shkriuss.feature.reminders.data.ReminderEntity
import app.shkriuss.feature.reminders.data.RemindersDatabase
import java.time.LocalDate
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** What a write of [RemindersRepository] changed, so that the notifications can follow it. */
data class ReminderChange(
    /** What happened. */
    val kind: Kind,
    /** The reminders it happened to. */
    val ids: List<String>,
) {
    /** The writes of docs/apps/reminders/spec.md, "The rule", the table of changes. */
    enum class Kind {
        /** A new reminder. It counts from the minute it was saved. */
        ADDED,

        /** A new date, time or repeat, perhaps with a new title. It counts from now: no snooze, and its notification goes. */
        NEW_TIME,

        /** A new title only. Nothing more: a notification on screen keeps the old title. */
        NEW_TITLE,

        /** Deleted. Its notification, snooze and entries go. */
        DELETED,

        /** Brought back by Undo. It counts from now. */
        BROUGHT_BACK,

        /** Taken from a backup. It counts from the moment of the restore: no snooze, and its notification goes. */
        RESTORED,
    }
}

/**
 * The reminders of Reminders. Every write goes through one `RecordWriter`,
 * so it is stamped, gets a change number and never removes a row
 * (docs/architecture/data.md). Every read that shows records leaves
 * deleted ones out.
 *
 * After each write, it does the work the write asks of the phone-only
 * [book] (docs/apps/reminders/spec.md, "The mark" and "The rule"): a new
 * reminder, a new date, time or repeat, and Undo count from the current
 * minute, with no snooze and nothing on screen; a delete removes the
 * entries. The current minute is that of the moment the write was asked
 * for: the clock is read once, before the write. So a save that ends in
 * the next minute never makes the mark the very time it saved. That work
 * takes its turn on [turns], the one lock that the handler of an alarm
 * and a press of a button take too, and runs in [work], off the main
 * thread. Then it calls [onChange], so that the notifications follow
 * (`RemindersAlarms.afterChange`).
 *
 * Once a write has begun, it runs to its end, from the database through
 * [onChange], also when its caller is cancelled: a screen that goes away
 * in the middle of a save must not leave a stored reminder with no mark,
 * no alarm, or the notification of its old time. A stop of the process
 * between the database write and the entry is not covered: the reminder
 * then counts from when Reminders next sees it (spec, "The mark", point
 * 2).
 */
class RemindersRepository(
    private val database: RemindersDatabase,
    clock: Clock,
    ids: IdSource,
    private val time: RemindersTime,
    private val book: ReminderBook,
    private val turns: Mutex = Mutex(),
    private val work: CoroutineContext = Dispatchers.IO,
    private val onChange: suspend (ReminderChange) -> Unit = {},
) {
    private val reminders = database.reminders()
    private val writer = RecordWriter(database, reminders, clock, ids)

    /** The reminders that are not deleted, in no order. */
    fun reminders(): Flow<List<Reminder>> = reminders.observeLive().map { rows -> rows.map(::reminderOf) }

    /** The phone-only entries, by reminder `id`. They change after every write, and when an alarm or a button changes them. */
    val entries: StateFlow<Map<String, ReminderEntry>> = book.entries

    /** The reminders that are not deleted, as stored now, in no order. The alarms are read from them. */
    suspend fun live(): List<Reminder> = reminders.live().map(::reminderOf)

    /** The reminder with [id], or null if there is none or it is deleted. */
    suspend fun find(id: String): Reminder? = reminders.find(id)?.takeUnless { it.record.isDeleted }?.let(::reminderOf)

    /**
     * Adds a reminder with [title] and [schedule], unless
     * [ReminderLimits.MOST_REMINDERS] are kept: then it adds none and
     * returns null. Its mark is the current minute of [now], the moment of
     * the save, so a daily 09:00 saved at 09:30 starts tomorrow.
     */
    suspend fun add(title: String, schedule: Schedule, now: ClockReading = time.reading()): Reminder? =
        withContext(NonCancellable) { addWhole(title, schedule, now) }

    private suspend fun addWhole(title: String, schedule: Schedule, now: ClockReading): Reminder? {
        requireStored(title, schedule)
        val created: ReminderEntity? = database.withWriteTransaction {
            if (reminders.liveCount() >= ReminderLimits.MOST_REMINDERS) {
                null
            } else {
                writer.create { fields, number -> entityOf(fields, number, title, schedule) }
            }
        }
        val stored = created ?: return null
        val added = listOf(stored.record.id)
        countFrom(now, added)
        onChange(ReminderChange(ReminderChange.Kind.ADDED, added))
        return reminderOf(stored)
    }

    /**
     * Gives the reminder with [id] the [title] and the [schedule]. With a
     * new schedule, it counts from the current minute of [now], the moment
     * of the save: no snooze, nothing on screen. With a new title only,
     * nothing more changes. Nothing is written if both are as they were.
     * Null if there is no such reminder, or it is deleted.
     */
    suspend fun change(id: String, title: String, schedule: Schedule, now: ClockReading = time.reading()): Reminder? =
        withContext(NonCancellable) { changeWhole(id, title, schedule, now) }

    /**
     * Gives the reminder with [id] the [schedule], and keeps its title as
     * it is stored now. A form whose title is unchanged saves with this, so
     * it never puts back a title that another form changed while it was
     * open. Otherwise as [change].
     */
    suspend fun changeSchedule(id: String, schedule: Schedule, now: ClockReading = time.reading()): Reminder? =
        withContext(NonCancellable) { changeWhole(id, title = null, schedule, now) }

    /** [change], or [changeSchedule] with a [title] of null: the stored title stays. */
    private suspend fun changeWhole(id: String, title: String?, schedule: Schedule, now: ClockReading): Reminder? {
        requireStored(title, schedule)
        val written: Pair<ReminderEntity, ReminderEntity>? = database.withWriteTransaction {
            val before = reminders.find(id)?.takeUnless { it.record.isDeleted }
            val after = before?.let {
                writer.update(id) { stored -> entityOf(stored.record, stored.changeNumber, title ?: stored.title, schedule) }
            }
            if (before == null || after == null) null else before to after
        }
        val (before, after) = written ?: return null
        val kind = when {
            scheduleOf(before) != schedule -> ReminderChange.Kind.NEW_TIME
            before.title != after.title -> ReminderChange.Kind.NEW_TITLE
            else -> return reminderOf(after)
        }
        if (kind == ReminderChange.Kind.NEW_TIME) countFrom(now, listOf(id))
        onChange(ReminderChange(kind, listOf(id)))
        return reminderOf(after)
    }

    /**
     * Gives the reminder with [id] the [title], and keeps its schedule as
     * it is stored now. A form whose date, time and repeat are unchanged
     * saves with this, so it never puts back a schedule that another form
     * changed while it was open. Nothing more changes: a notification on
     * screen keeps the old title. Nothing is written if the title is as it
     * was. Null if there is no such reminder, or it is deleted.
     */
    suspend fun changeTitle(id: String, title: String): Reminder? = withContext(NonCancellable) { changeTitleWhole(id, title) }

    private suspend fun changeTitleWhole(id: String, title: String): Reminder? {
        require(TitleRules.isStored(title)) { "A title is 1 to 200 code points on one line, without spaces at either end" }
        val written: Pair<ReminderEntity, ReminderEntity>? = database.withWriteTransaction {
            val before = reminders.find(id)?.takeUnless { it.record.isDeleted }
            val after = before?.let { writer.update(id) { stored -> stored.copy(title = title) } }
            if (before == null || after == null) null else before to after
        }
        val (before, after) = written ?: return null
        if (before.title != title) onChange(ReminderChange(ReminderChange.Kind.NEW_TITLE, listOf(id)))
        return reminderOf(after)
    }

    /**
     * Marks the reminders [ids] as deleted, in one write. The rows stay,
     * with their content. Their entries go. Returns those that were
     * deleted now: not one that was already deleted or never stored.
     */
    suspend fun delete(ids: List<String>): List<Reminder> = withContext(NonCancellable) { deleteWhole(ids) }

    private suspend fun deleteWhole(ids: List<String>): List<Reminder> {
        val deleted = database.withWriteTransaction { ids.distinct().mapNotNull { writer.markDeleted(it) } }
        if (deleted.isEmpty()) return emptyList()
        val deletedIds = deleted.map { it.record.id }
        withContext(work) { turns.withLock { book.remove(deletedIds) } }
        onChange(ReminderChange(ReminderChange.Kind.DELETED, deletedIds))
        return deleted.map(::reminderOf)
    }

    /**
     * Deletes those of the reminders [ids] that are past now, as **Delete
     * all** does: the rule gives them no alarm, with this phone's entries.
     * One that is upcoming again by now stays, for example after **Snooze
     * 10 min** on its notification while the question was open. The check
     * and the write take their turn on [turns], as a press of a button
     * does, so no press comes between them. Returns those that were
     * deleted now.
     */
    suspend fun deletePast(ids: List<String>): List<Reminder> = withContext(NonCancellable) { deletePastWhole(ids.toSet()) }

    private suspend fun deletePastWhole(ids: Set<String>): List<Reminder> {
        val deleted = withContext(work) {
            turns.withLock {
                val now = time.reading()
                val entries = book.entries.value
                // Read and written in one transaction: a save from another form cannot come between them.
                val marked = database.withWriteTransaction {
                    reminders.live()
                        .filter { it.record.id in ids && ReminderLists.alarmOf(reminderOf(it), entries[it.record.id], now) == null }
                        .mapNotNull { writer.markDeleted(it.record.id) }
                }
                book.remove(marked.map { it.record.id })
                marked
            }
        }
        if (deleted.isEmpty()) return emptyList()
        onChange(ReminderChange(ReminderChange.Kind.DELETED, deleted.map { it.record.id }))
        return deleted.map(::reminderOf)
    }

    /**
     * Brings back the deleted reminders [ids], as Undo does, in one
     * write. Each counts from the current minute of [now], the moment of
     * Undo. Returns those that came back. Undo may bring the count over
     * the limit of the form.
     */
    suspend fun bringBack(ids: List<String>, now: ClockReading = time.reading()): List<Reminder> =
        withContext(NonCancellable) { bringBackWhole(ids, now) }

    private suspend fun bringBackWhole(ids: List<String>, now: ClockReading): List<Reminder> {
        val back = database.withWriteTransaction { ids.distinct().mapNotNull { writer.restore(it) } }
        if (back.isEmpty()) return emptyList()
        val backIds = back.map { it.record.id }
        countFrom(now, backIds)
        onChange(ReminderChange(ReminderChange.Kind.BROUGHT_BACK, backIds))
        return back.map(::reminderOf)
    }

    /**
     * Runs after a restore, with the reminders it took, [taken]
     * (docs/apps/reminders/spec.md, "Backup contents", point 3). The
     * restore wrote them past this repository. Each one that is not
     * deleted counts from the current minute of [now], the moment after
     * the restore: its snooze ends, and its notification goes. One that
     * came back deleted loses its entries, as a delete does. Then the
     * notifications follow, also when the restore took none. Like every
     * write here, it runs to its end once it has begun.
     */
    suspend fun afterRestore(taken: List<String>, now: ClockReading = time.reading()) =
        withContext(NonCancellable) { afterRestoreWhole(taken.distinct(), now) }

    private suspend fun afterRestoreWhole(taken: List<String>, now: ClockReading) {
        if (taken.isNotEmpty()) {
            val live = reminders.live().mapTo(HashSet()) { it.record.id }
            withContext(work) {
                turns.withLock {
                    book.update(taken) { id, _ -> if (id in live) ReminderEntry(mark = now.currentMinute) else ReminderEntry() }
                }
            }
        }
        onChange(ReminderChange(ReminderChange.Kind.RESTORED, taken))
    }

    /** The reminders [ids] count from the current minute of [now]: that is their mark, with no snooze and nothing on screen. */
    private suspend fun countFrom(now: ClockReading, ids: List<String>) = withContext(work) {
        turns.withLock { book.update(ids) { _, _ -> ReminderEntry(mark = now.currentMinute) } }
    }

    private fun requireStored(title: String?, schedule: Schedule) {
        require(title == null || TitleRules.isStored(title)) {
            "A title is 1 to 200 code points on one line, without spaces at either end"
        }
        require(ScheduleRules.isValid(schedule)) { "A date, a time or the days of the week are outside their limits" }
    }

    private fun entityOf(fields: RecordFields, number: Long, title: String, schedule: Schedule) = ReminderEntity(
        fields,
        number,
        title = title,
        day = Math.toIntExact(schedule.date.toEpochDay()),
        minuteOfDay = schedule.minuteOfDay,
        repeat = schedule.repeat.code,
        weekdays = schedule.weekdays,
    )

    /** How the screens see a row. */
    internal companion object {
        /** The schedule of a stored row. */
        fun scheduleOf(row: ReminderEntity): Schedule = Schedule(
            repeat = checkNotNull(Repeat.ofCode(row.repeat)) { "A stored reminder has a repeat this version knows" },
            date = LocalDate.ofEpochDay(row.day.toLong()),
            minuteOfDay = row.minuteOfDay,
            weekdays = row.weekdays,
        )

        /** A stored row as a [Reminder]. */
        fun reminderOf(row: ReminderEntity): Reminder = Reminder(row.record.id, row.title, scheduleOf(row), row.record.createdAt)
    }
}
